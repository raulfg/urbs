import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Confianza,
  TipoVia,
  codificarCelda,
  crearProcedencia,
  crearTramo,
  decodificarCelda,
} from 'urbs-core';

import { crearReproyector } from '../src/reproyeccion.js';
import { trocear } from '../src/troceado.js';

const EPSG = 25829;
const LADO = 250;
const MARGEN = 1000;

const PROCEDENCIA = crearProcedencia({ proveedor: 'osm-viario', confianza: Confianza.ESTIMADO });

/**
 * Polilinea recta de `metros` a lo largo del paralelo, partiendo de A Coruna.
 * En grados, porque es lo que entra al troceado.
 *
 * @param {number} metros
 * @param {number} vertices
 */
function paseoDe(metros, vertices) {
  const lon0 = -8.41;
  const lat = 43.371;
  const metrosPorGrado = 111320 * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: vertices }, (_, i) => [
    lon0 + (metros * i) / (vertices - 1) / metrosPorGrado,
    lat,
  ]);
}

/**
 * @param {string} id
 * @param {Array<[number, number]>} eje
 */
function tramo(id, eje) {
  return crearTramo({
    id,
    eje,
    tipo: TipoVia.PEATONAL,
    anchuraMetros: 4,
    procedencia: PROCEDENCIA,
  });
}

const reproyector = crearReproyector(EPSG);

test('un vial corto conserva su id intacto: partir es la excepcion, no la norma', () => {
  const celdas = trocear({
    tramos: [tramo('way/1', paseoDe(120, 4))],
    reproyector,
    ladoCeldaMetros: LADO,
    margenMetros: MARGEN,
  });

  const ids = [...celdas.values()].flatMap((celda) => celda.tramos.map((t) => t.id));
  assert.deepEqual(ids, ['way/1']);
});

test('el Paseo Maritimo, 2.212 m en un solo way de OSM, se parte en piezas trazables', () => {
  const celdas = trocear({
    tramos: [tramo('way/363361335', paseoDe(2212, 178))],
    reproyector,
    ladoCeldaMetros: LADO,
    margenMetros: MARGEN,
  });

  const ids = [...celdas.values()].flatMap((celda) => celda.tramos.map((t) => t.id));
  assert.ok(ids.length > 1, `se esperaba mas de una pieza, hubo ${ids.length}`);
  for (const id of ids) {
    assert.match(id, /^way\/363361335#\d+$/, 'la pieza debe seguir apuntando a su way de origen');
  }
  assert.equal(new Set(ids).size, ids.length, 'dos piezas comparten id');
});

test('las piezas de un vial largo caben en el formato: esto es lo que antes reventaba', () => {
  const celdas = trocear({
    tramos: [tramo('way/363361335', paseoDe(2212, 178))],
    reproyector,
    ladoCeldaMetros: LADO,
    margenMetros: MARGEN,
  });

  for (const contenido of celdas.values()) {
    assert.doesNotThrow(() => codificarCelda(contenido), `la celda ${contenido.celda.clave} no cabe`);
  }
});

test('la geometria sobrevive al viaje: las piezas recompuestas cubren el paseo entero', () => {
  const eje = paseoDe(2212, 178);
  const celdas = trocear({
    tramos: [tramo('way/363361335', eje)],
    reproyector,
    ladoCeldaMetros: LADO,
    margenMetros: MARGEN,
  });

  /** @type {Array<[number, number]>} Vertices absolutos reconstruidos desde el disco */
  const absolutos = [];
  for (const contenido of celdas.values()) {
    const leida = decodificarCelda(codificarCelda(contenido));
    for (const pieza of leida.tramos) {
      for (const [este, norte] of pieza.eje) {
        absolutos.push([este + leida.celda.origen.este, norte + leida.celda.origen.norte]);
      }
    }
  }

  const extremos = eje.map(([lon, lat]) => reproyector.aProyectado({ lon, lat }));
  const esteMin = Math.min(...extremos.map((p) => p.este));
  const esteMax = Math.max(...extremos.map((p) => p.este));

  // Los extremos del paseo tienen que seguir ahi, con la tolerancia del float32
  // a estas magnitudes locales (micras, no metros).
  assert.ok(Math.min(...absolutos.map((p) => p[0])) - esteMin < 0.01);
  assert.ok(esteMax - Math.max(...absolutos.map((p) => p[0])) < 0.01);
});

test('las piezas reparten el vial entre varias celdas, que es el objetivo del streaming', () => {
  const celdas = trocear({
    tramos: [tramo('way/363361335', paseoDe(2212, 178))],
    reproyector,
    ladoCeldaMetros: LADO,
    margenMetros: MARGEN,
  });

  const conTramos = [...celdas.values()].filter((celda) => celda.tramos.length > 0);
  assert.ok(conTramos.length > 1, 'el vial deberia tocar varias celdas, no una sola');
});
