import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALTURA_PERSECUCION,
  DISTANCIA_PERSECUCION,
  factorDeSuavizado,
  puntoDePersecucion,
} from '../src/camara-persecucion.js';

const ORIGEN = Object.freeze({ x: 0, y: 0, z: 0 });

// --- Donde se pone la camara

test('con guinada cero, el coche mira al norte y la camara se queda al sur', () => {
  // Convencion de ejes: el norte es -Z, asi que "detras" con guinada cero es +Z.
  const punto = puntoDePersecucion(ORIGEN, 0);

  assert.ok(Math.abs(punto.x) < 1e-6);
  assert.ok(Math.abs(punto.z - DISTANCIA_PERSECUCION) < 1e-6);
  assert.ok(Math.abs(punto.y - ALTURA_PERSECUCION) < 1e-6);
});

test('girando el coche un cuarto de vuelta, la camara gira con el', () => {
  // Guinada de +90 grados: el coche mira al este (+X), la camara al oeste.
  const punto = puntoDePersecucion(ORIGEN, Math.PI / 2);

  assert.ok(Math.abs(punto.x + DISTANCIA_PERSECUCION) < 1e-6);
  assert.ok(Math.abs(punto.z) < 1e-6);
});

test('la camara siempre esta a la misma distancia del coche en el plano', () => {
  for (const guinada of [0, 0.7, Math.PI, -2.4, 5.9]) {
    const punto = puntoDePersecucion({ x: 120, y: 3, z: -80 }, guinada);
    const plano = Math.hypot(punto.x - 120, punto.z + 80);
    assert.ok(Math.abs(plano - DISTANCIA_PERSECUCION) < 1e-6, `guinada ${guinada}`);
  }
});

test('la camara sube sobre el coche, no sobre el suelo', () => {
  const punto = puntoDePersecucion({ x: 0, y: 30, z: 0 }, 0);
  assert.ok(Math.abs(punto.y - (30 + ALTURA_PERSECUCION)) < 1e-6);
});

test('la distancia y la altura se pueden pedir a medida', () => {
  const punto = puntoDePersecucion(ORIGEN, 0, { distancia: 4, altura: 1.5 });

  assert.ok(Math.abs(punto.z - 4) < 1e-6);
  assert.ok(Math.abs(punto.y - 1.5) < 1e-6);
});

// --- Suavizado

test('el suavizado no se pasa nunca de largo', () => {
  for (const segundos of [1 / 240, 1 / 60, 0.1, 5]) {
    const factor = factorDeSuavizado(segundos, 0.2);
    assert.ok(factor >= 0 && factor <= 1, `con ${segundos} s el factor fue ${factor}`);
  }
});

test('un fotograma de cero segundos no mueve la camara', () => {
  assert.equal(factorDeSuavizado(0, 0.2), 0);
});

test('el suavizado NO depende de los fotogramas por segundo', () => {
  // Con `actual += (deseado - actual) * k` y una `k` fija, la camara persigue
  // mas rapido a 120 fps que a 30, y el coche parece otro coche. El factor
  // exponencial es lo que hace que la constante sea tiempo y no fotogramas.
  const constante = 0.25;
  const segundos = 1 / 30;

  const deUnGolpe = 1 - factorDeSuavizado(segundos, constante);
  let aTrozos = 1;
  for (let i = 0; i < 4; i += 1) {
    aTrozos *= 1 - factorDeSuavizado(segundos / 4, constante);
  }

  assert.ok(Math.abs(deUnGolpe - aTrozos) < 1e-9);
});

test('una constante mas corta persigue mas de cerca', () => {
  assert.ok(factorDeSuavizado(1 / 60, 0.05) > factorDeSuavizado(1 / 60, 0.5));
});

test('una constante no positiva pega la camara al coche en vez de dividir por cero', () => {
  assert.equal(factorDeSuavizado(1 / 60, 0), 1);
  assert.equal(factorDeSuavizado(1 / 60, -3), 1);
});
