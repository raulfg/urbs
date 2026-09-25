import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NIVEL_DEL_MAR,
  crearMallaElevacion,
  esMar,
} from '../src/dominio/elevacion.js';

/**
 * Malla de juguete de 3x3, un grado de lado por pixel, esquina noroeste en
 * (lon -8, lat 44). La fila 0 es la del NORTE, como en un GeoTIFF.
 *
 *   lat 44 |  0   10   20
 *   lat 43 | 30   40   50
 *   lat 42 | 60   70   80
 *          +-----------------
 *            -8   -7   -6
 */
function malla3x3() {
  return crearMallaElevacion({
    cotas: Int16Array.from([0, 10, 20, 30, 40, 50, 60, 70, 80]),
    ancho: 3,
    alto: 3,
    noroeste: { lon: -8, lat: 44 },
    paso: { lon: 1, lat: 1 },
  });
}

// --- Muestreo

test('en el centro de un pixel devuelve su cota tal cual', () => {
  const malla = malla3x3();

  assert.equal(malla.cota(-8, 44), 0);
  assert.equal(malla.cota(-7, 43), 40);
  assert.equal(malla.cota(-6, 42), 80);
});

test('entre dos pixeles interpola: el MDT viene en metros enteros y sin esto se aterraza', () => {
  // Un escalon de 1 m sobre una malla de 5 m son once grados de pendiente
  // falsa. Interpolar no inventa relieve: reparte el que ya hay.
  const malla = malla3x3();

  assert.equal(malla.cota(-7.5, 44), 5);
  assert.equal(malla.cota(-8, 43.5), 15);
  assert.equal(malla.cota(-7.5, 43.5), 20);
});

test('la interpolacion es bilineal de verdad, no en un solo eje', () => {
  const malla = malla3x3();
  // A un cuarto de camino en lon y a tres cuartos en lat, entre 0/10/30/40.
  const esperado = 0 * 0.75 * 0.25 + 10 * 0.25 * 0.25 + 30 * 0.75 * 0.75 + 40 * 0.25 * 0.75;

  assert.ok(Math.abs(malla.cota(-7.75, 43.25) - esperado) < 1e-9);
});

test('fuera de la malla NO devuelve cero, devuelve null', () => {
  // Cero significa "nivel del mar" en este dato. Devolverlo cuando en realidad
  // es "no lo se" inundaria de mar todo lo que caiga fuera del recorte.
  const malla = malla3x3();

  assert.equal(malla.cota(-9, 43), null);
  assert.equal(malla.cota(-5, 43), null);
  assert.equal(malla.cota(-7, 45), null);
  assert.equal(malla.cota(-7, 41), null);
});

test('los bordes exactos SI estan dentro', () => {
  const malla = malla3x3();

  assert.equal(malla.cota(-8, 44), 0);
  assert.equal(malla.cota(-6, 42), 80);
});

test('una coordenada que no sea un numero se rechaza', () => {
  const malla = malla3x3();
  assert.equal(malla.cota(Number.NaN, 43), null);
  assert.equal(malla.cota(-7, undefined), null);
});

// --- Limites y metadatos

test('la malla sabe su propio rectangulo', () => {
  const { limites } = malla3x3();

  assert.deepEqual(limites, { lonMin: -8, latMin: 42, lonMax: -6, latMax: 44 });
});

test('la malla sabe su cota minima y maxima sin recorrerla dos veces', () => {
  const malla = malla3x3();

  assert.equal(malla.cotaMinima, 0);
  assert.equal(malla.cotaMaxima, 80);
});

// --- El mar

test('el nivel del mar es cero, y eso es lo que dice el dato, no un convenio nuestro', () => {
  // El MDT del PNOA da alturas ortometricas sobre el nivel del mar: el mar sale
  // como 0 exacto. Medido sobre tres recortes de A Coruna: en el recorte
  // interior no hay ni un pixel a cero.
  assert.equal(NIVEL_DEL_MAR, 0);
  assert.equal(esMar(0), true);
  assert.equal(esMar(-3), true);
  assert.equal(esMar(0.5), false);
  assert.equal(esMar(45), false);
});

test('una cota desconocida NO es mar', () => {
  // Es la diferencia entre "aqui hay agua" y "aqui no tengo dato". Confundirlas
  // es como se inunda una ciudad entera por un recorte mal pedido.
  assert.equal(esMar(null), false);
  assert.equal(esMar(Number.NaN), false);
  assert.equal(esMar(undefined), false);
});

// --- Construccion

test('una malla sin cotas suficientes se rechaza al construirla', () => {
  assert.throws(
    () =>
      crearMallaElevacion({
        cotas: Int16Array.from([1, 2, 3]),
        ancho: 2,
        alto: 2,
        noroeste: { lon: 0, lat: 0 },
        paso: { lon: 1, lat: 1 },
      }),
    /cotas/,
  );
});

test('un paso no positivo se rechaza: la malla no tendria orientacion', () => {
  for (const paso of [{ lon: 0, lat: 1 }, { lon: 1, lat: -1 }]) {
    assert.throws(
      () =>
        crearMallaElevacion({
          cotas: Int16Array.from([1, 2, 3, 4]),
          ancho: 2,
          alto: 2,
          noroeste: { lon: 0, lat: 0 },
          paso,
        }),
      /paso/,
    );
  }
});

test('una malla de un solo pixel vale y no divide por cero', () => {
  const malla = crearMallaElevacion({
    cotas: Int16Array.from([7]),
    ancho: 1,
    alto: 1,
    noroeste: { lon: 0, lat: 0 },
    paso: { lon: 1, lat: 1 },
  });

  assert.equal(malla.cota(0, 0), 7);
  assert.deepEqual(malla.limites, { lonMin: 0, latMin: 0, lonMax: 0, latMax: 0 });
});
