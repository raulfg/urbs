import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Capa,
  Confianza,
  TipoVia,
  UsoEdificio,
  crearArea,
  crearEdificio,
  crearProcedencia,
  crearRegistro,
  crearTerritorio,
  crearTramo,
  decodificarCelda,
  leerCabecera,
} from 'urbs-core';

import { DIRECTORIO_CELDAS_POR_DEFECTO, generarCeldas } from '../src/generar.js';

const AREA = crearArea({ lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 });
const TERRITORIO = crearTerritorio({ id: 'coruna-centro', nombre: 'A Coruna centro', area: AREA });

const PROCEDENCIA = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });

const ATRIBUCION_OSM = Object.freeze({
  fuente: 'OpenStreetMap',
  licencia: 'ODbL',
  texto: '(c) colaboradores de OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
});

/**
 * Cuadrado de `tamano` grados con la esquina suroeste en (lon, lat). En estas
 * latitudes un grado son decenas de kilometros, asi que tamanos de 0,0002
 * dejan edificios de unos 20 m.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {number} tamano
 */
function cuadrado(lon, lat, tamano) {
  return [
    [lon, lat],
    [lon + tamano, lat],
    [lon + tamano, lat + tamano],
    [lon, lat + tamano],
    [lon, lat],
  ];
}

const EDIFICIOS = [
  crearEdificio({
    id: 'way/1',
    huella: [cuadrado(-8.4156, 43.3662, 0.0002)],
    alturaMetros: 18,
    plantas: 6,
    uso: UsoEdificio.RESIDENCIAL,
    procedencia: PROCEDENCIA,
  }),
  // Lejos del primero: cae en otra celda.
  crearEdificio({
    id: 'way/2',
    huella: [cuadrado(-8.3956, 43.3762, 0.0002)],
    uso: UsoEdificio.COMERCIAL,
    procedencia: PROCEDENCIA,
  }),
];

const TRAMOS = [
  crearTramo({
    id: 'way/9',
    eje: [
      [-8.4156, 43.3662],
      [-8.4152, 43.3664],
    ],
    tipo: TipoVia.RESIDENCIAL,
    anchuraMetros: 6,
    nombre: 'Rua de proba',
    procedencia: PROCEDENCIA,
  }),
];

/**
 * @param {Object} datos
 */
function proveedorFalso({ id, capa, metodo, resultado, cubre = () => true }) {
  return {
    id,
    capa,
    prioridad: 10,
    cubre,
    atribucion: () => ATRIBUCION_OSM,
    [metodo]: async () => resultado,
  };
}

/**
 * @param {Object} [opciones]
 */
function registroFalso({ conEdificios = true, conViario = true } = {}) {
  const registro = crearRegistro();
  if (conEdificios) {
    registro.registrar(
      proveedorFalso({
        id: 'osm-edificios',
        capa: Capa.EDIFICIOS,
        metodo: 'obtenerEdificios',
        resultado: EDIFICIOS,
      }),
    );
  }
  if (conViario) {
    registro.registrar(
      proveedorFalso({
        id: 'osm-viario',
        capa: Capa.VIARIO,
        metodo: 'obtenerViario',
        resultado: TRAMOS,
      }),
    );
  }
  return registro;
}

/** Escritor de mentira: guarda en memoria en vez de tocar el disco. */
function escritorEnMemoria() {
  const archivos = new Map();
  return {
    archivos,
    /**
     * @param {string} ruta
     * @param {Uint8Array} bytes
     */
    async escribir(ruta, bytes) {
      archivos.set(ruta, bytes);
    },
  };
}

test('el directorio de salida por defecto es el que ignora git', () => {
  assert.equal(DIRECTORIO_CELDAS_POR_DEFECTO, 'datos/celdas');
});

test('se escribe un archivo .urbscell por celda, bajo el id del territorio', async () => {
  const escritor = escritorEnMemoria();
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso(),
    directorioSalida: 'salida',
    escribir: escritor.escribir,
  });

  assert.equal(escritor.archivos.size, informe.totales.celdas);
  for (const celda of informe.celdas) {
    assert.equal(celda.ruta, join('salida', 'coruna-centro', `${celda.clave}.urbscell`));
    assert.ok(escritor.archivos.has(celda.ruta));
  }
});

test('lo escrito se vuelve a leer y trae la geometria y la semantica', async () => {
  const escritor = escritorEnMemoria();
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso(),
    directorioSalida: 'salida',
    escribir: escritor.escribir,
  });

  const celdaConTramo = informe.celdas.find((celda) => celda.tramos > 0);
  const contenido = decodificarCelda(escritor.archivos.get(celdaConTramo.ruta));

  assert.equal(contenido.epsg, TERRITORIO.epsg);
  assert.equal(contenido.celda.ladoCeldaMetros, TERRITORIO.ladoCeldaMetros);
  assert.equal(contenido.tramos[0].nombre, 'Rua de proba');
  assert.equal(contenido.edificios[0].plantas, 6);
  assert.equal(contenido.edificios[0].uso, UsoEdificio.RESIDENCIAL);
});

test('el informe cuadra: celdas, elementos y bytes', async () => {
  const escritor = escritorEnMemoria();
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso(),
    directorioSalida: 'salida',
    escribir: escritor.escribir,
  });

  assert.equal(informe.territorio.id, 'coruna-centro');
  assert.equal(informe.territorio.epsg, 25829);
  assert.equal(informe.totales.celdas, informe.celdas.length);
  assert.equal(
    informe.totales.edificios,
    informe.celdas.reduce((suma, celda) => suma + celda.edificios, 0),
  );
  assert.equal(informe.totales.edificios, EDIFICIOS.length);
  assert.equal(informe.totales.tramos, TRAMOS.length);
  assert.equal(
    informe.totales.bytes,
    [...escritor.archivos.values()].reduce((suma, bytes) => suma + bytes.length, 0),
  );
});

test('el informe dice que fuente sirvio cada capa', async () => {
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso(),
    escribir: escritorEnMemoria().escribir,
  });

  assert.equal(informe.capas.edificios, 'osm-edificios');
  assert.equal(informe.capas.viario, 'osm-viario');
  assert.equal(informe.capas.relieve, null);
});

test('el informe trae las atribuciones legales de lo que se ha usado', async () => {
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso(),
    escribir: escritorEnMemoria().escribir,
  });

  assert.deepEqual(informe.atribuciones, [ATRIBUCION_OSM]);
});

test('una capa sin cobertura no tumba la generacion: se anota y se sigue', async () => {
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso({ conViario: false }),
    escribir: escritorEnMemoria().escribir,
  });

  assert.deepEqual(informe.sinCobertura, [Capa.VIARIO]);
  assert.equal(informe.totales.tramos, 0);
  assert.equal(informe.totales.edificios, EDIFICIOS.length);
});

test('sin ninguna fuente no se escribe nada, y el informe lo dice claro', async () => {
  const escritor = escritorEnMemoria();
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso({ conEdificios: false, conViario: false }),
    escribir: escritor.escribir,
  });

  assert.equal(escritor.archivos.size, 0);
  assert.equal(informe.totales.celdas, 0);
  assert.deepEqual(informe.sinCobertura, [Capa.EDIFICIOS, Capa.VIARIO]);
  assert.deepEqual(informe.atribuciones, []);
});

test('que un proveedor reviente no es degradacion: el error sube', async () => {
  const registro = crearRegistro();
  registro.registrar({
    id: 'roto',
    capa: Capa.EDIFICIOS,
    prioridad: 10,
    cubre: () => true,
    atribucion: () => ATRIBUCION_OSM,
    obtenerEdificios: async () => {
      throw new Error('Overpass ha devuelto un 429');
    },
  });

  await assert.rejects(
    () => generarCeldas({ territorio: TERRITORIO, registro, escribir: escritorEnMemoria().escribir }),
    /429/,
  );
});

test('el margen se puede ajustar y llega hasta la cabecera del archivo', async () => {
  const escritor = escritorEnMemoria();
  const informe = await generarCeldas({
    territorio: TERRITORIO,
    registro: registroFalso(),
    escribir: escritor.escribir,
    margenMetros: 750,
  });

  const cabecera = leerCabecera(escritor.archivos.get(informe.celdas[0].ruta));
  assert.equal(cabecera.margenMetros, 750);
});

test('el territorio y el registro son obligatorios', async () => {
  await assert.rejects(() => generarCeldas({ registro: registroFalso() }), /territorio/);
  await assert.rejects(() => generarCeldas({ territorio: TERRITORIO }), /registro/);
});

test('sobre disco de verdad: los archivos quedan donde dice el informe', async () => {
  const directorio = await mkdtemp(join(tmpdir(), 'urbs-celdas-'));
  try {
    const informe = await generarCeldas({
      territorio: TERRITORIO,
      registro: registroFalso(),
      directorioSalida: directorio,
    });

    assert.ok(informe.celdas.length > 0);
    for (const celda of informe.celdas) {
      const bytes = new Uint8Array(await readFile(celda.ruta));
      assert.equal(bytes.length, celda.bytes);
      assert.equal(leerCabecera(bytes).epsg, TERRITORIO.epsg);
    }
  } finally {
    await rm(directorio, { recursive: true, force: true });
  }
});
