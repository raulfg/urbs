import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Confianza,
  TipoVia,
  UsoEdificio,
  crearArea,
  crearEdificio,
  crearProcedencia,
  crearTerritorio,
  crearTramo,
  codificarCelda,
  decodificarCelda,
  margenPorDefecto,
} from 'urbs-core';

import { crearReproyectorDeTerritorio } from '../src/reproyeccion.js';
import {
  centroideDeAnillo,
  centroideDePolilinea,
  trocear,
} from '../src/troceado.js';

const LADO = 250;

/**
 * Reproyector de mentira: trata los grados de entrada como si ya fueran metros
 * proyectados. Sirve para probar el troceado sin meter la aritmetica de UTM de
 * por medio; la cadena real con proj4 se prueba al final de este archivo.
 */
const REPROYECTOR_IDENTIDAD = Object.freeze({
  epsg: 25829,
  aProyectado: ({ lon, lat }) => ({ este: lon, norte: lat }),
});

const PROCEDENCIA = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });

/**
 * @param {string} id
 * @param {Array<Array<[number, number]>>} huella
 * @param {Object} [extra]
 */
function edificio(id, huella, extra = {}) {
  return crearEdificio({ id, huella, procedencia: PROCEDENCIA, ...extra });
}

/**
 * @param {string} id
 * @param {Array<[number, number]>} eje
 * @param {Object} [extra]
 */
function tramo(id, eje, extra = {}) {
  return crearTramo({
    id,
    eje,
    tipo: TipoVia.RESIDENCIAL,
    anchuraMetros: 6,
    procedencia: PROCEDENCIA,
    ...extra,
  });
}

/**
 * @param {number} este
 * @param {number} norte
 * @param {number} tamano
 * @returns {Array<[number, number]>}
 */
function cuadrado(este, norte, tamano) {
  return [
    [este, norte],
    [este + tamano, norte],
    [este + tamano, norte + tamano],
    [este, norte + tamano],
    [este, norte],
  ];
}

const cerca = (valor, esperado, tolerancia = 1e-9) =>
  assert.ok(
    Math.abs(valor - esperado) <= tolerancia,
    `esperaba ${esperado} +-${tolerancia}, recibido ${valor}`,
  );

test('el centroide de un cuadrado es su centro', () => {
  const centro = centroideDeAnillo(cuadrado(100, 200, 10));

  cerca(centro.este, 105);
  cerca(centro.norte, 205);
});

test('el centroide de un anillo pesa por area, no por numero de vertices', () => {
  // Una L: el rectangulo de abajo (200 m2) pesa el doble que el de arriba (100 m2).
  const ele = [
    [0, 0],
    [20, 0],
    [20, 10],
    [10, 10],
    [10, 20],
    [0, 20],
    [0, 0],
  ];
  const centro = centroideDeAnillo(ele);

  cerca(centro.este, 25 / 3, 1e-9);
  cerca(centro.norte, 25 / 3, 1e-9);
  // La media de vertices daria (10, 10): el area manda, no el recuento.
  assert.notEqual(centro.este, 10);
});

test('un anillo degenerado cae a la media de vertices en vez de devolver NaN', () => {
  // Catastro produce anillos colineales; un area de cero no puede dividir.
  const centro = centroideDeAnillo([
    [0, 0],
    [10, 0],
    [20, 0],
    [0, 0],
  ]);

  cerca(centro.este, 10);
  cerca(centro.norte, 0);
});

test('el centroide de una polilinea pesa por longitud, no por vertices', () => {
  // Tres vertices amontonados al principio y un tramo largo al final.
  const centro = centroideDePolilinea([
    [0, 0],
    [1, 0],
    [2, 0],
    [100, 0],
  ]);

  // Por longitud: 50. Por media de vertices seria 25,75.
  cerca(centro.este, 50, 1e-9);
  cerca(centro.norte, 0);
});

test('una polilinea de longitud cero cae a la media de vertices', () => {
  const centro = centroideDePolilinea([
    [3, 4],
    [3, 4],
  ]);

  cerca(centro.este, 3);
  cerca(centro.norte, 4);
});

test('cada edificio cae en la celda de su centroide', () => {
  const celdas = trocear({
    edificios: [edificio('a', [cuadrado(10, 10, 20)]), edificio('b', [cuadrado(300, 600, 20)])],
    tramos: [],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  assert.deepEqual([...celdas.keys()], ['x0z0', 'x1z2']);
  assert.deepEqual(
    celdas.get('x0z0').edificios.map((e) => e.id),
    ['a'],
  );
  assert.deepEqual(
    celdas.get('x1z2').edificios.map((e) => e.id),
    ['b'],
  );
});

test('la geometria se guarda local a la celda, no en absoluto', () => {
  const celdas = trocear({
    edificios: [edificio('b', [cuadrado(300, 600, 20)])],
    tramos: [],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  const contenido = celdas.get('x1z2');
  assert.deepEqual(contenido.celda.origen, { este: 250, norte: 500 });
  // 300 - 250 = 50 y 600 - 500 = 100.
  assert.deepEqual(contenido.edificios[0].anillos[0][0], [50, 100]);
  cerca(contenido.edificios[0].ancla.este, 60);
  cerca(contenido.edificios[0].ancla.norte, 110);
});

test('un edificio a caballo entre dos celdas va entero a la de su centroide', () => {
  // Centroide en (245, 100): celda x0z0. La esquina derecha se mete en x1z0.
  const celdas = trocear({
    edificios: [edificio('a-caballo', [cuadrado(235, 90, 20)])],
    tramos: [],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  assert.equal(celdas.size, 1, 'no se duplica en la celda vecina');
  const anillo = celdas.get('x0z0').edificios[0].anillos[0];
  // Sigue entero: el vertice que se sale de la celda se guarda por encima del lado.
  assert.deepEqual(anillo[1], [255, 90]);
  assert.ok(anillo[1][0] > LADO, 'no se recorta en el borde de la celda');
});

test('una calle larga se asigna por su centroide y conserva sus dos extremos', () => {
  const celdas = trocear({
    edificios: [],
    tramos: [
      tramo('via', [
        [-120, 40],
        [380, 40],
      ]),
    ],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  assert.deepEqual([...celdas.keys()], ['x0z0']);
  const eje = celdas.get('x0z0').tramos[0].eje;
  assert.deepEqual(eje, [
    [-120, 40],
    [380, 40],
  ]);
  cerca(celdas.get('x0z0').tramos[0].ancla.este, 130);
});

test('edificios y tramos de la misma zona comparten celda', () => {
  const celdas = trocear({
    edificios: [edificio('a', [cuadrado(10, 10, 20)])],
    tramos: [
      tramo('v', [
        [10, 10],
        [30, 30],
      ]),
    ],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  assert.equal(celdas.size, 1);
  assert.equal(celdas.get('x0z0').edificios.length, 1);
  assert.equal(celdas.get('x0z0').tramos.length, 1);
});

test('la semantica del dominio llega intacta al contenido de la celda', () => {
  const celdas = trocear({
    edificios: [
      edificio('con-datos', [cuadrado(10, 10, 20)], {
        alturaMetros: 18.5,
        plantas: 6,
        uso: UsoEdificio.COMERCIAL,
      }),
      edificio('sin-datos', [cuadrado(50, 50, 20)]),
    ],
    tramos: [
      tramo(
        'con-nombre',
        [
          [10, 10],
          [30, 30],
        ],
        { nombre: 'Rua Real', sentidoUnico: true, carriles: 2, tipo: TipoVia.PRIMARIA },
      ),
    ],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  const contenido = celdas.get('x0z0');
  const [conDatos, sinDatos] = contenido.edificios;

  assert.equal(conDatos.alturaMetros, 18.5);
  assert.equal(conDatos.plantas, 6);
  assert.equal(conDatos.uso, UsoEdificio.COMERCIAL);
  assert.equal(conDatos.procedencia.proveedor, 'osm');
  assert.equal(sinDatos.alturaMetros, null);
  assert.equal(sinDatos.plantas, null);
  assert.equal(sinDatos.uso, UsoEdificio.DESCONOCIDO);

  const [via] = contenido.tramos;
  assert.equal(via.nombre, 'Rua Real');
  assert.equal(via.sentidoUnico, true);
  assert.equal(via.carriles, 2);
  assert.equal(via.tipo, TipoVia.PRIMARIA);
  assert.equal(via.anchuraMetros, 6);
});

test('el contenido de la celda trae el epsg y el margen que necesita el codec', () => {
  const celdas = trocear({
    edificios: [edificio('a', [cuadrado(10, 10, 20)])],
    tramos: [],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  const contenido = celdas.get('x0z0');
  assert.equal(contenido.epsg, 25829);
  assert.equal(contenido.margenMetros, margenPorDefecto(LADO));
});

test('sin elementos no se genera ninguna celda: no se escriben celdas vacias', () => {
  const celdas = trocear({
    edificios: [],
    tramos: [],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  assert.equal(celdas.size, 0);
});

test('el orden de las celdas es estable: primero por fila, luego por columna', () => {
  const celdas = trocear({
    edificios: [
      edificio('norte', [cuadrado(10, 600, 10)]),
      edificio('este', [cuadrado(600, 10, 10)]),
      edificio('origen', [cuadrado(10, 10, 10)]),
    ],
    tramos: [],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  assert.deepEqual([...celdas.keys()], ['x0z0', 'x2z0', 'x0z2']);
});

test('lo que sale del troceado entra en el codec sin tocar nada', () => {
  const celdas = trocear({
    edificios: [edificio('a', [cuadrado(235, 90, 20)], { alturaMetros: 12, plantas: 4 })],
    tramos: [
      tramo('v', [
        [-120, 40],
        [380, 40],
      ]),
    ],
    reproyector: REPROYECTOR_IDENTIDAD,
    ladoCeldaMetros: LADO,
  });

  const vuelta = decodificarCelda(codificarCelda(celdas.get('x0z0')));

  assert.equal(vuelta.celda.clave, 'x0z0');
  assert.equal(vuelta.epsg, 25829);
  assert.equal(vuelta.edificios[0].id, 'a');
  assert.equal(vuelta.edificios[0].plantas, 4);
  assert.equal(vuelta.tramos[0].eje.length, 2);
});

test('la cadena real: grados de A Coruna, proj4 y celdas de 250 m', () => {
  const area = crearArea({ lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 });
  const territorio = crearTerritorio({ id: 'coruna', nombre: 'A Coruna', area });
  const reproyector = crearReproyectorDeTerritorio(territorio);

  const celdas = trocear({
    edificios: [
      edificio('way/1', [
        [
          [-8.4056, 43.3712],
          [-8.4054, 43.3712],
          [-8.4054, 43.3714],
          [-8.4056, 43.3714],
          [-8.4056, 43.3712],
        ],
      ]),
    ],
    tramos: [],
    reproyector,
    ladoCeldaMetros: territorio.ladoCeldaMetros,
  });

  assert.equal(celdas.size, 1);
  const [contenido] = [...celdas.values()];

  assert.equal(contenido.epsg, 25829);
  // El origen es multiplo exacto del lado y esta donde tiene que estar.
  assert.equal(contenido.celda.origen.este % 250, 0);
  assert.equal(contenido.celda.origen.norte % 250, 0);
  assert.ok(contenido.celda.origen.norte > 4790000 && contenido.celda.origen.norte < 4810000);

  // Y sobre todo: nada de UTM absoluto en la geometria.
  for (const [este, norte] of contenido.edificios[0].anillos[0]) {
    assert.ok(este >= 0 && este < 250, `este local fuera de la celda: ${este}`);
    assert.ok(norte >= 0 && norte < 250, `norte local fuera de la celda: ${norte}`);
  }

  // Y el archivo binario se escribe sin que salte ninguna guarda.
  assert.ok(codificarCelda(contenido).length > 0);
});
