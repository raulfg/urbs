import test from 'node:test';
import assert from 'node:assert/strict';

import { EXTENSION_CELDA } from '../src/generar.js';
import { VERSION_INDICE, construirIndice } from '../src/indice.js';

/** Informe minimo con la forma exacta que devuelve `generarCeldas`. */
const INFORME = Object.freeze({
  territorio: {
    id: 'marineda-casco-historico',
    nombre: 'Marineda',
    epsg: 25829,
    ladoCeldaMetros: 250,
    area: { lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 },
  },
  directorioSalida: 'datos/celdas/marineda-casco-historico',
  margenMetros: 1000,
  capas: { edificios: 'osm-edificios', viario: 'osm-viario', relieve: null, suelo: null },
  sinCobertura: ['relieve', 'suelo'],
  atribuciones: [
    { fuente: 'OpenStreetMap', licencia: 'ODbL 1.0', texto: '(c) colaboradores de OpenStreetMap' },
  ],
  celdas: [
    {
      clave: 'x2188z19202',
      indice: { x: 2188, z: 19202 },
      origen: { este: 547000, norte: 4800500 },
      edificios: 12,
      tramos: 4,
      bytes: 3096,
      ruta: 'datos/celdas/marineda-casco-historico/x2188z19202.urbscell',
    },
    {
      clave: 'x2189z19202',
      indice: { x: 2189, z: 19202 },
      origen: { este: 547250, norte: 4800500 },
      edificios: 3,
      tramos: 7,
      bytes: 1024,
      ruta: 'datos/celdas/marineda-casco-historico/x2189z19202.urbscell',
    },
  ],
  totales: { celdas: 2, edificios: 15, tramos: 11, bytes: 4120 },
});

const AHORA = () => new Date('2026-09-25T15:00:00.000Z');

test('el indice declara su version para que un lector viejo pueda negarse', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });
  assert.equal(indice.version, VERSION_INDICE);
});

test('el indice lleva el territorio entero: sin el, el visor no sabe donde esta', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });

  assert.deepEqual(indice.territorio, INFORME.territorio);
  assert.equal(indice.margenMetros, 1000);
});

test('cada celda se cita por nombre de archivo relativo, no por ruta del disco que la genero', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });

  assert.deepEqual(
    indice.celdas.map((celda) => celda.archivo),
    [`x2188z19202${EXTENSION_CELDA}`, `x2189z19202${EXTENSION_CELDA}`],
  );
  for (const celda of indice.celdas) {
    assert.equal(celda.ruta, undefined, 'la ruta del pipeline no le sirve a un navegador');
    assert.ok(!celda.archivo.includes('/'), 'el archivo vive junto al indice');
  }
});

test('cada celda conserva indice, origen y conteos: el visor decide que cargar sin abrir un byte', () => {
  const [primera] = construirIndice(INFORME, { ahora: AHORA }).celdas;

  assert.deepEqual(primera.indice, { x: 2188, z: 19202 });
  assert.deepEqual(primera.origen, { este: 547000, norte: 4800500 });
  assert.equal(primera.edificios, 12);
  assert.equal(primera.tramos, 4);
  assert.equal(primera.bytes, 3096);
  assert.equal(primera.clave, 'x2188z19202');
});

test('las celdas salen ordenadas por clave, no en el orden en que se escribieron', () => {
  const desordenado = { ...INFORME, celdas: [...INFORME.celdas].reverse() };
  const indice = construirIndice(desordenado, { ahora: AHORA });

  assert.deepEqual(
    indice.celdas.map((celda) => celda.clave),
    ['x2188z19202', 'x2189z19202'],
  );
});

test('las atribuciones y la degradacion viajan en el indice: los creditos salen del dato', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });

  assert.deepEqual(indice.atribuciones, INFORME.atribuciones);
  assert.deepEqual(indice.capas, INFORME.capas);
  assert.deepEqual(indice.sinCobertura, ['relieve', 'suelo']);
});

test('los totales se recalculan desde las celdas, no se copian a ciegas', () => {
  const mentiroso = { ...INFORME, totales: { celdas: 999, edificios: 0, tramos: 0, bytes: 0 } };
  const indice = construirIndice(mentiroso, { ahora: AHORA });

  assert.deepEqual(indice.totales, { celdas: 2, edificios: 15, tramos: 11, bytes: 4120 });
});

test('la extension del territorio en celdas sale del indice de cada celda', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });

  assert.deepEqual(indice.limites, { xMin: 2188, xMax: 2189, zMin: 19202, zMax: 19202 });
});

test('un territorio sin celdas da limites nulos en vez de Infinity', () => {
  const vacio = { ...INFORME, celdas: [], totales: { celdas: 0, edificios: 0, tramos: 0, bytes: 0 } };
  const indice = construirIndice(vacio, { ahora: AHORA });

  assert.equal(indice.limites, null);
  assert.deepEqual(indice.totales, { celdas: 0, edificios: 0, tramos: 0, bytes: 0 });
});

test('la marca de tiempo es inyectable y se serializa en ISO', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });
  assert.equal(indice.generadoEn, '2026-09-25T15:00:00.000Z');
});

test('el indice es serializable tal cual y sobrevive al viaje por JSON', () => {
  const indice = construirIndice(INFORME, { ahora: AHORA });
  assert.deepEqual(JSON.parse(JSON.stringify(indice)), indice);
});
