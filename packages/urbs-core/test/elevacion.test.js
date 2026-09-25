import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SIN_DATO,
  crearMallaElevacion,
  hayDato,
} from '../src/dominio/elevacion.js';

/**
 * Malla de juguete de 3x3, un metro de lado por pixel. Las coordenadas son
 * pequenas para que las cuentas se lean; en el dato real son metros UTM.
 * La fila 0 es la del NORTE, como en un GeoTIFF.
 *
 *   norte 44 |  0   10   20
 *   norte 43 | 30   40   50
 *   norte 42 | 60   70   80
 *          +-----------------
 *            -8   -7   -6
 */
function malla3x3() {
  return crearMallaElevacion({
    cotas: Int16Array.from([0, 10, 20, 30, 40, 50, 60, 70, 80]),
    ancho: 3,
    alto: 3,
    noroeste: { este: -8, norte: 44 },
    paso: { este: 1, norte: 1 },
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
  // A un cuarto de camino en este y a tres cuartos en norte, entre 0/10/30/40.
  const esperado = 0 * 0.75 * 0.25 + 10 * 0.25 * 0.25 + 30 * 0.75 * 0.75 + 40 * 0.25 * 0.75;

  assert.ok(Math.abs(malla.cota(-7.75, 43.25) - esperado) < 1e-9);
});

test('fuera de la malla NO devuelve una cota, devuelve null', () => {
  // "No lo se" no puede disfrazarse de altura. Quien pregunta por un punto que
  // cae fuera del recorte tiene que enterarse, no recibir un cero que luego
  // alguien interprete como nivel del mar.
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

  assert.deepEqual(limites, { esteMin: -8, norteMin: 42, esteMax: -6, norteMax: 44 });
});

test('la malla sabe su cota minima y maxima sin recorrerla dos veces', () => {
  const malla = malla3x3();

  assert.equal(malla.cotaMinima, 0);
  assert.equal(malla.cotaMaxima, 80);
});

// --- El centinela de "no producido"

test('el centinela del MDT es -32767 y significa "no producido", nunca agua', () => {
  // La trampa mas cara de este dato: es el numero mas bajo de la escala, asi
  // que cualquier filtro de "esto esta bajo, sera mar" se lo traga entero.
  assert.equal(SIN_DATO, -32767);
  assert.equal(hayDato(SIN_DATO), false);
  assert.equal(hayDato(0), true);
  assert.equal(hayDato(-3), true);
  assert.equal(hayDato(45), true);
});

test('una cota que no es un numero tampoco es un dato', () => {
  assert.equal(hayDato(null), false);
  assert.equal(hayDato(Number.NaN), false);
  assert.equal(hayDato(undefined), false);
});

test('el centinela NO se interpola: un vecino sin dato devuelve null, no un pozo', () => {
  // Meter -32.767 en una media abre un agujero de treinta kilometros que
  // ademas se reparte entre los pixeles de alrededor.
  const malla = crearMallaElevacion({
    cotas: Float32Array.from([10, SIN_DATO, 20, 30]),
    ancho: 2,
    alto: 2,
    noroeste: { este: 0, norte: 1 },
    paso: { este: 1, norte: 1 },
  });

  assert.equal(malla.cota(0.5, 0.5), null);
  assert.equal(malla.cota(0, 1), null, 'la esquina buena tambien, porque interpola con la mala');
});

test('el centinela no cuenta para el rango de cotas', () => {
  // Si contara, cualquier recorte con un hueco de vuelo diria que su cota
  // minima son treinta y dos kilometros bajo el mar.
  const malla = crearMallaElevacion({
    cotas: Float32Array.from([10, SIN_DATO, 20, 30]),
    ancho: 2,
    alto: 2,
    noroeste: { este: 0, norte: 1 },
    paso: { este: 1, norte: 1 },
  });

  assert.equal(malla.cotaMinima, 10);
  assert.equal(malla.cotaMaxima, 30);
});

test('una malla entera sin dato no tiene rango, y lo dice con null', () => {
  const malla = crearMallaElevacion({
    cotas: Float32Array.from([SIN_DATO, SIN_DATO]),
    ancho: 2,
    alto: 1,
    noroeste: { este: 0, norte: 0 },
    paso: { este: 1, norte: 1 },
  });

  assert.equal(malla.cotaMinima, null);
  assert.equal(malla.cotaMaxima, null);
});

// --- Construccion

test('una malla sin cotas suficientes se rechaza al construirla', () => {
  assert.throws(
    () =>
      crearMallaElevacion({
        cotas: Int16Array.from([1, 2, 3]),
        ancho: 2,
        alto: 2,
        noroeste: { este: 0, norte: 0 },
        paso: { este: 1, norte: 1 },
      }),
    /cotas/,
  );
});

test('un paso no positivo se rechaza: la malla no tendria orientacion', () => {
  for (const paso of [{ este: 0, norte: 1 }, { este: 1, norte: -1 }]) {
    assert.throws(
      () =>
        crearMallaElevacion({
          cotas: Int16Array.from([1, 2, 3, 4]),
          ancho: 2,
          alto: 2,
          noroeste: { este: 0, norte: 0 },
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
    noroeste: { este: 0, norte: 0 },
    paso: { este: 1, norte: 1 },
  });

  assert.equal(malla.cota(0, 0), 7);
  assert.deepEqual(malla.limites, { esteMin: 0, norteMin: 0, esteMax: 0, norteMax: 0 });
});
