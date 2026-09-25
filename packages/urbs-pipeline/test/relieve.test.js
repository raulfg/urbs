import test from 'node:test';
import assert from 'node:assert/strict';

import { crearCelda } from 'urbs-core';

import { PASO_MALLA_POR_DEFECTO, muestrearRelieveDeCelda } from '../src/relieve.js';

const LADO = 250;
const CELDA = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });

/** Una fuente de mentira: un plano inclinado con cota = norte / 100. */
function fuentePlanoInclinado() {
  const cajas = [];
  return {
    cajas,
    async malla(caja) {
      cajas.push(caja);
      return { cota: (este, norte) => norte / 100 };
    },
  };
}

test('los postes cubren la celda de borde a borde', () => {
  // Con lado 250 y paso 10 son 26 postes, del 0 al 250 inclusive. El ultimo cae
  // JUSTO en el borde, que es lo que hace que dos celdas vecinas compartan cota
  // y no quede una costura entre ellas.
  assert.equal(LADO / PASO_MALLA_POR_DEFECTO + 1, 26);
});

test('muestrea una malla cuadrada del tamano que dicta el paso', async () => {
  const relieve = await muestrearRelieveDeCelda({ celda: CELDA, fuente: fuentePlanoInclinado() });

  assert.equal(relieve.paso, PASO_MALLA_POR_DEFECTO);
  assert.equal(relieve.cotas.length, 26 * 26);
});

test('la fila 0 es la del NORTE, como en el GeoTIFF', async () => {
  // Invertir la vertical saca un relieve plausible pero reflejado, y eso no se
  // ve hasta comparar con un mapa.
  const relieve = await muestrearRelieveDeCelda({ celda: CELDA, fuente: fuentePlanoInclinado() });
  const postes = 26;

  const primeraFila = relieve.cotas[0];
  const ultimaFila = relieve.cotas[(postes - 1) * postes];
  assert.ok(primeraFila > ultimaFila, 'la fila 0 tiene que ser la de mas norte');

  // Y con cota = norte/100 se puede comprobar el valor exacto.
  assert.ok(Math.abs(primeraFila - (CELDA.origen.norte + LADO) / 100) < 1e-6);
  assert.ok(Math.abs(ultimaFila - CELDA.origen.norte / 100) < 1e-6);
});

test('se pide a la fuente un poco mas que la celda, para que la bilineal tenga vecinos', async () => {
  const fuente = fuentePlanoInclinado();
  await muestrearRelieveDeCelda({ celda: CELDA, fuente });

  const caja = fuente.cajas[0];
  assert.ok(caja.esteMin < CELDA.origen.este);
  assert.ok(caja.esteMax > CELDA.origen.este + LADO);
  assert.ok(caja.norteMin < CELDA.origen.norte);
  assert.ok(caja.norteMax > CELDA.origen.norte + LADO);
});

test('un paso que no divida al lado de celda se rechaza: la malla no cerraria', async () => {
  await assert.rejects(
    () => muestrearRelieveDeCelda({ celda: CELDA, fuente: fuentePlanoInclinado(), paso: 7 }),
    /paso|divide/i,
  );
});

test('un paso no positivo se rechaza', async () => {
  await assert.rejects(
    () => muestrearRelieveDeCelda({ celda: CELDA, fuente: fuentePlanoInclinado(), paso: 0 }),
    /paso/,
  );
});

test('una celda fuera de las hojas no da malla, y eso NO es una malla llana', async () => {
  const relieve = await muestrearRelieveDeCelda({
    celda: CELDA,
    fuente: { async malla() { return null; } },
  });

  assert.equal(relieve, null);
});

test('un poste sin dato entra como NaN, no como cero', async () => {
  // Cero es el nivel del mar. Rellenar un hueco de vuelo con cero mete agua en
  // mitad de una ladera.
  const relieve = await muestrearRelieveDeCelda({
    celda: CELDA,
    fuente: {
      async malla() {
        return { cota: (este) => (este === CELDA.origen.este ? null : 42) };
      },
    },
  });

  assert.ok(Number.isNaN(relieve.cotas[0]));
  assert.equal(relieve.cotas[1], 42);
});

test('si NINGUN poste tiene dato, no se escribe malla', async () => {
  const relieve = await muestrearRelieveDeCelda({
    celda: CELDA,
    fuente: { async malla() { return { cota: () => null }; } },
  });

  assert.equal(relieve, null);
});
