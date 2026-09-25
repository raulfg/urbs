import test from 'node:test';
import assert from 'node:assert/strict';

import { celdasEnRadio, distanciaACelda, planDeCarga } from '../src/streaming.js';

const LADO = 250;

/** Rejilla de 3x3 celdas alrededor de (2188, 19202). */
const CELDAS = Object.freeze(
  [-1, 0, 1].flatMap((dz) =>
    [-1, 0, 1].map((dx) => ({
      clave: `x${2188 + dx}z${19202 + dz}`,
      indice: { x: 2188 + dx, z: 19202 + dz },
      origen: { este: (2188 + dx) * LADO, norte: (19202 + dz) * LADO },
    })),
  ),
);

const CENTRO = Object.freeze({ este: 2188 * LADO + 125, norte: 19202 * LADO + 125 });

test('estar dentro de una celda da distancia cero, no la distancia a su centro', () => {
  // Si se midiese al centro, la celda que pisas competiria con sus vecinas.
  assert.equal(distanciaACelda(CENTRO, CELDAS[4], LADO), 0);
});

test('la distancia se mide a la caja de la celda, no a su esquina', () => {
  const celda = { origen: { este: 0, norte: 0 } };
  // Justo al este de la celda [0,250]x[0,250], a la altura de su mitad.
  assert.equal(distanciaACelda({ este: 350, norte: 125 }, celda, LADO), 100);
  // En diagonal desde la esquina noreste.
  assert.ok(Math.abs(distanciaACelda({ este: 550, norte: 650 }, celda, LADO) - 500) < 1e-9);
});

test('un radio corto solo trae la celda que pisas', () => {
  assert.deepEqual(celdasEnRadio(CELDAS, CENTRO, 50, LADO), ['x2188z19202']);
});

test('un radio mayor trae las vecinas, y las trae ordenadas por cercania', () => {
  // Desde el centro de una celda de 250 m: las de al lado estan a 125 m y las
  // diagonales a 176,8. Un radio de 150 separa las dos cosas.
  const claves = celdasEnRadio(CELDAS, CENTRO, 150, LADO);

  assert.equal(claves[0], 'x2188z19202', 'la celda que pisas se carga primero');
  assert.equal(claves.length, 5, 'las cuatro en cruz entran; las diagonales no');
  assert.ok(claves.includes('x2187z19202'));
  assert.ok(!claves.includes('x2187z19201'), 'la diagonal esta a 176,8 m, fuera de 150');
});

test('un radio enorme trae todo el territorio sin duplicar nada', () => {
  const claves = celdasEnRadio(CELDAS, CENTRO, 100000, LADO);
  assert.equal(claves.length, CELDAS.length);
  assert.equal(new Set(claves).size, claves.length);
});

test('el orden por cercania es el que decide que se ve antes al aterrizar', () => {
  const claves = celdasEnRadio(CELDAS, CENTRO, 100000, LADO);
  const distancias = claves.map((clave) =>
    distanciaACelda(CENTRO, CELDAS.find((celda) => celda.clave === clave), LADO),
  );
  for (let i = 1; i < distancias.length; i += 1) {
    assert.ok(distancias[i] >= distancias[i - 1], 'las celdas no salen ordenadas');
  }
});

test('el plan de carga pide solo lo que falta', () => {
  const plan = planDeCarga(['a', 'b', 'c'], new Set(['b']));
  assert.deepEqual(plan.cargar, ['a', 'c']);
  assert.deepEqual(plan.descargar, []);
});

test('el plan de descarga suelta solo lo que sobra', () => {
  const plan = planDeCarga(['a'], new Set(['a', 'b', 'c']));
  assert.deepEqual(plan.cargar, []);
  assert.deepEqual([...plan.descargar].sort(), ['b', 'c']);
});

test('sin cambios, el plan no mueve nada: un fotograma estable no toca la GPU', () => {
  const plan = planDeCarga(['a', 'b'], new Set(['a', 'b']));
  assert.deepEqual(plan.cargar, []);
  assert.deepEqual(plan.descargar, []);
});

test('el plan conserva el orden de cercania en lo que hay que cargar', () => {
  const plan = planDeCarga(['cerca', 'media', 'lejos'], new Set(['media']));
  assert.deepEqual(plan.cargar, ['cerca', 'lejos']);
});

test('un radio no positivo se rechaza en vez de dejar la escena vacia sin explicacion', () => {
  for (const basura of [0, -1, Number.NaN]) {
    assert.throws(() => celdasEnRadio(CELDAS, CENTRO, basura, LADO), /radio/);
  }
});
