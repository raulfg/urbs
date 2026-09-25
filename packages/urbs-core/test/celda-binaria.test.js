import test from 'node:test';
import assert from 'node:assert/strict';

import { crearCelda, pasoFloat32 } from '../src/dominio/celda.js';
import {
  MAGIA_URBSCELL,
  VERSION_FORMATO,
  BYTES_CABECERA,
  ALINEACION_SECCION,
  MARGEN_EN_LADOS_POR_DEFECTO,
  AUSENTE_ENTERO,
  margenPorDefecto,
  codificarCelda,
  decodificarCelda,
  leerCabecera,
} from '../src/formato/celda-binaria.js';

const LADO = 250;
const EPSG = 25829;
// Coruna en EPSG:25829. El origen de esta celda es exactamente {547000, 4800500}.
const CELDA = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });

const PROCEDENCIA_OSM = { proveedor: 'osm-edificios', confianza: 'declarado', nota: null };
const PROCEDENCIA_ESTIMADA = {
  proveedor: 'osm-viario',
  confianza: 'estimado',
  nota: 'anchura derivada de lanes',
};

const EDIFICIO_CON_HUECO = {
  id: 'way/1001',
  anillos: [
    [
      [100.5, 100.25],
      [110.5, 100.25],
      [110.5, 110.25],
      [100.5, 110.25],
      [100.5, 100.25],
    ],
    [
      [103, 103],
      [107, 103],
      [107, 107],
      [103, 107],
      [103, 103],
    ],
  ],
  ancla: { este: 105.5, norte: 105.25 },
  alturaMetros: 18.75,
  plantas: 6,
  uso: 'residencial',
  procedencia: PROCEDENCIA_OSM,
};

const EDIFICIO_SIN_DATOS = {
  id: 'way/1002',
  anillos: [
    [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 10],
    ],
  ],
  ancla: { este: 16.25, norte: 13.125 },
  alturaMetros: null,
  plantas: null,
  uso: 'desconocido',
  procedencia: PROCEDENCIA_OSM,
};

const TRAMO_INTERIOR = {
  id: 'way/2001',
  eje: [
    [10, 10],
    [125, 125],
    [240, 240],
  ],
  ancla: { este: 125, norte: 125 },
  tipo: 'residencial',
  anchuraMetros: 6,
  carriles: 2,
  sentidoUnico: true,
  nombre: 'Rua da Franxa',
  procedencia: PROCEDENCIA_ESTIMADA,
};

// Una calle larga sobresale de su celda por los dos lados: se asigna por
// centroide y NO se recorta, asi que sus vertices salen del rango [0, lado).
const TRAMO_QUE_SOBRESALE = {
  id: 'way/2002',
  eje: [
    [-120, 40],
    [380, 40],
  ],
  ancla: { este: 130, norte: 40 },
  tipo: 'primaria',
  anchuraMetros: 12,
  carriles: null,
  sentidoUnico: false,
  nombre: null,
  procedencia: PROCEDENCIA_ESTIMADA,
};

const CONTENIDO = {
  celda: CELDA,
  epsg: EPSG,
  edificios: [EDIFICIO_CON_HUECO, EDIFICIO_SIN_DATOS],
  tramos: [TRAMO_INTERIOR, TRAMO_QUE_SOBRESALE],
};

/**
 * Compara dos coordenadas locales admitiendo solo el error que el formato
 * declara: el escalon de float32 a esa magnitud.
 */
function igualEnFloat32(recibido, esperado, etiqueta) {
  const tolerancia = pasoFloat32(esperado);
  assert.ok(
    Math.abs(recibido - esperado) <= tolerancia,
    `${etiqueta}: esperaba ${esperado} +-${tolerancia}, recibido ${recibido}`,
  );
}

test('la magia, la version y el tamano de cabecera son constantes del formato', () => {
  assert.equal(MAGIA_URBSCELL, 'URBSCELL');
  assert.equal(VERSION_FORMATO, 1);
  assert.equal(BYTES_CABECERA, 72);
  assert.equal(ALINEACION_SECCION, 8);
  assert.equal(AUSENTE_ENTERO, -1);
});

test('el margen por defecto se deriva del lado de celda, no es un numero magico', () => {
  assert.equal(margenPorDefecto(LADO), LADO * MARGEN_EN_LADOS_POR_DEFECTO);
  assert.equal(margenPorDefecto(500), 500 * MARGEN_EN_LADOS_POR_DEFECTO);
});

test('el archivo empieza por los ocho bytes de magia en ASCII', () => {
  const bytes = codificarCelda(CONTENIDO);
  assert.ok(bytes instanceof Uint8Array);
  const magia = new TextDecoder().decode(bytes.subarray(0, 8));
  assert.equal(magia, MAGIA_URBSCELL);
});

test('la cabecera se puede leer sin decodificar las secciones', () => {
  const bytes = codificarCelda(CONTENIDO);
  const cabecera = leerCabecera(bytes);

  assert.equal(cabecera.version, VERSION_FORMATO);
  assert.deepEqual(cabecera.indice, { x: 2188, z: 19202 });
  assert.equal(cabecera.epsg, EPSG);
  assert.equal(cabecera.ladoCeldaMetros, LADO);
  assert.equal(cabecera.numeroEdificios, 2);
  assert.equal(cabecera.numeroTramos, 2);
});

test('el origen absoluto viaja una sola vez, en float64 y exacto', () => {
  const bytes = codificarCelda(CONTENIDO);
  const cabecera = leerCabecera(bytes);

  // Sin perdida: 4.800.500 en float32 se iria a un escalon de medio metro.
  assert.equal(cabecera.origen.este, 547000);
  assert.equal(cabecera.origen.norte, 4800500);
});

test('un edificio vuelve entero del binario, con sus huecos y su semantica', () => {
  const celda = decodificarCelda(codificarCelda(CONTENIDO));
  const edificio = celda.edificios[0];

  assert.equal(edificio.id, 'way/1001');
  assert.equal(edificio.uso, 'residencial');
  assert.equal(edificio.plantas, 6);
  igualEnFloat32(edificio.alturaMetros, 18.75, 'alturaMetros');
  assert.equal(edificio.anillos.length, 2, 'exterior mas un hueco');
  assert.equal(edificio.anillos[0].length, 5);
  assert.equal(edificio.anillos[1].length, 5);

  for (const [indiceAnillo, anillo] of EDIFICIO_CON_HUECO.anillos.entries()) {
    for (const [indiceVertice, [este, norte]] of anillo.entries()) {
      const vuelto = edificio.anillos[indiceAnillo][indiceVertice];
      igualEnFloat32(vuelto[0], este, `anillo ${indiceAnillo} vertice ${indiceVertice} este`);
      igualEnFloat32(vuelto[1], norte, `anillo ${indiceAnillo} vertice ${indiceVertice} norte`);
    }
  }

  igualEnFloat32(edificio.ancla.este, 105.5, 'ancla.este');
  igualEnFloat32(edificio.ancla.norte, 105.25, 'ancla.norte');
});

test('un valor ausente vuelve como null, nunca como cero disfrazado', () => {
  const celda = decodificarCelda(codificarCelda(CONTENIDO));

  assert.equal(celda.edificios[1].alturaMetros, null);
  assert.equal(celda.edificios[1].plantas, null);
  assert.equal(celda.tramos[1].carriles, null);
  assert.equal(celda.tramos[1].nombre, null);
  assert.equal(celda.edificios[0].procedencia.nota, null);
});

test('un tramo vuelve entero, con nombre, sentido y anchura', () => {
  const celda = decodificarCelda(codificarCelda(CONTENIDO));
  const tramo = celda.tramos[0];

  assert.equal(tramo.id, 'way/2001');
  assert.equal(tramo.tipo, 'residencial');
  assert.equal(tramo.nombre, 'Rua da Franxa');
  assert.equal(tramo.sentidoUnico, true);
  assert.equal(tramo.carriles, 2);
  igualEnFloat32(tramo.anchuraMetros, 6, 'anchuraMetros');
  assert.equal(tramo.eje.length, 3);
  assert.equal(celda.tramos[1].sentidoUnico, false);
});

test('la geometria que sobresale de la celda se conserva entera, sin recortar', () => {
  const celda = decodificarCelda(codificarCelda(CONTENIDO));
  const tramo = celda.tramos[1];

  igualEnFloat32(tramo.eje[0][0], -120, 'vertice al oeste de la celda');
  igualEnFloat32(tramo.eje[1][0], 380, 'vertice al este de la celda');
});

test('la celda decodificada trae su Celda reconstruida del indice', () => {
  const celda = decodificarCelda(codificarCelda(CONTENIDO));

  assert.equal(celda.celda.clave, 'x2188z19202');
  assert.deepEqual(celda.celda.origen, { este: 547000, norte: 4800500 });
  assert.equal(celda.celda.ladoCeldaMetros, LADO);
  assert.equal(celda.epsg, EPSG);
});

test('las procedencias se guardan una sola vez y se comparten al decodificar', () => {
  const celda = decodificarCelda(codificarCelda(CONTENIDO));

  assert.equal(celda.edificios[0].procedencia, celda.edificios[1].procedencia);
  assert.equal(celda.tramos[0].procedencia, celda.tramos[1].procedencia);
  assert.notEqual(celda.edificios[0].procedencia, celda.tramos[0].procedencia);
  assert.equal(celda.tramos[0].procedencia.nota, 'anchura derivada de lanes');
});

test('una celda vacia tambien es un archivo valido', () => {
  const bytes = codificarCelda({ celda: CELDA, epsg: EPSG, edificios: [], tramos: [] });
  const celda = decodificarCelda(bytes);

  assert.deepEqual(celda.edificios, []);
  assert.deepEqual(celda.tramos, []);
  assert.equal(leerCabecera(bytes).numeroEdificios, 0);
});

test('el resultado es estable byte a byte: dos codificaciones iguales dan el mismo archivo', () => {
  assert.deepEqual(codificarCelda(CONTENIDO), codificarCelda(CONTENIDO));
});

test('un ancla en UTM absoluto revienta en vez de cuantizar la geometria', () => {
  const contenido = {
    ...CONTENIDO,
    edificios: [{ ...EDIFICIO_SIN_DATOS, ancla: { este: 547016.25, norte: 4800513.125 } }],
    tramos: [],
  };

  assert.throws(() => codificarCelda(contenido), (error) => {
    assert.ok(error instanceof RangeError);
    assert.match(error.message, /exigirCoordenadasLocales/);
    assert.match(error.message, /aLocal/);
    return true;
  });
});

test('un vertice mas alla del margen revienta: esa geometria no es de esta celda', () => {
  const contenido = {
    celda: CELDA,
    epsg: EPSG,
    edificios: [],
    tramos: [
      {
        ...TRAMO_QUE_SOBRESALE,
        eje: [
          [-120, 40],
          [547380, 40],
        ],
      },
    ],
  };

  assert.throws(() => codificarCelda(contenido), (error) => {
    assert.ok(error instanceof RangeError);
    assert.match(error.message, /margen/);
    assert.match(error.message, /way\/2002/);
    return true;
  });
});

test('el margen admitido se puede ampliar y viaja en la cabecera', () => {
  const margenMetros = 4000;
  const bytes = codificarCelda({
    celda: CELDA,
    epsg: EPSG,
    edificios: [],
    tramos: [
      {
        ...TRAMO_QUE_SOBRESALE,
        eje: [
          [-3000, 40],
          [3000, 40],
        ],
      },
    ],
    margenMetros,
  });

  assert.equal(leerCabecera(bytes).margenMetros, margenMetros);
  igualEnFloat32(decodificarCelda(bytes).tramos[0].eje[0][0], -3000, 'vertice lejano');
});

test('un margen que rompe la precision de float32 se rechaza con la cuenta hecha', () => {
  assert.throws(
    () =>
      codificarCelda({
        celda: CELDA,
        epsg: EPSG,
        edificios: [],
        tramos: [],
        margenMetros: 1_000_000,
      }),
    /float32/,
  );
});

test('un archivo sin la magia no se decodifica', () => {
  const bytes = codificarCelda(CONTENIDO);
  bytes[0] = 0x47;

  assert.throws(() => decodificarCelda(bytes), /URBSCELL/);
});

test('una version desconocida no se decodifica a ciegas', () => {
  const bytes = codificarCelda(CONTENIDO);
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, 99, true);

  assert.throws(() => decodificarCelda(bytes), /version 99/);
});

test('un archivo truncado se detecta en vez de devolver geometria inventada', () => {
  const bytes = codificarCelda(CONTENIDO);

  assert.throws(() => decodificarCelda(bytes.subarray(0, bytes.length - 16)), RangeError);
});

test('la celda es obligatoria y el error dice como construirla', () => {
  assert.throws(
    () => codificarCelda({ epsg: EPSG, edificios: [], tramos: [] }),
    /crearCelda/,
  );
});

test('el epsg es obligatorio: una celda sin sistema de referencia no se puede situar', () => {
  assert.throws(
    () => codificarCelda({ celda: CELDA, edificios: [], tramos: [] }),
    /epsg/,
  );
});

test('un anillo con menos de cuatro posiciones no es un poligono cerrado', () => {
  assert.throws(
    () =>
      codificarCelda({
        celda: CELDA,
        epsg: EPSG,
        tramos: [],
        edificios: [
          {
            ...EDIFICIO_SIN_DATOS,
            anillos: [
              [
                [10, 10],
                [20, 10],
                [10, 10],
              ],
            ],
          },
        ],
      }),
    /4 posiciones/,
  );
});
