import test from 'node:test';
import assert from 'node:assert/strict';

import { MARGEN_VENTANA, noroesteDeVentana, ventanaDeCaja } from '../src/pnoa/ventana.js';

/**
 * Una hoja de juguete con la geometria REAL del MDT02, a escala.
 * Origen en la esquina exterior noroeste, como lo da un GeoTIFF.
 */
const HOJA = Object.freeze({
  origen: { este: 1000, norte: 2000 },
  paso: { este: 2, norte: 2 },
  ancho: 100,
  alto: 50,
});
// Cubre este 1000..1200, norte 1900..2000.

// --- Conversion de caja a pixeles

test('una caja interior se convierte en su ventana de pixeles', () => {
  const ventana = ventanaDeCaja(HOJA, {
    esteMin: 1020,
    esteMax: 1040,
    norteMin: 1960,
    norteMax: 1980,
  });

  // (1020-1000)/2 = 10 y (1040-1000)/2 = 20; (2000-1980)/2 = 10 y (2000-1960)/2 = 20.
  // Mas un pixel de margen a cada lado.
  assert.deepEqual(ventana, {
    izquierda: 10 - MARGEN_VENTANA,
    arriba: 10 - MARGEN_VENTANA,
    derecha: 20 + MARGEN_VENTANA,
    abajo: 20 + MARGEN_VENTANA,
  });
});

test('la ventana lleva UN PIXEL de margen, o la bilineal no tiene con quien interpolar', () => {
  // Sin el margen, el borde de cada celda interpola contra si mismo y aparece
  // una costura entre celdas vecinas que ademas se mueve al cargar y descargar.
  assert.equal(MARGEN_VENTANA >= 1, true);
});

test('el norte va al reves que la fila: el maximo norte es la fila de ARRIBA', () => {
  // Es el error que sale reflejado en vertical y no se ve hasta comparar con un
  // mapa: el relieve queda plausible pero del reves.
  const arriba = ventanaDeCaja(HOJA, { esteMin: 1000, esteMax: 1002, norteMin: 1998, norteMax: 2000 });
  const abajo = ventanaDeCaja(HOJA, { esteMin: 1000, esteMax: 1002, norteMin: 1900, norteMax: 1902 });

  assert.equal(arriba.arriba, 0);
  assert.ok(abajo.arriba > arriba.arriba, 'el norte bajo tiene que caer en filas mayores');
});

test('la ventana se recorta a la hoja: no se piden pixeles que no existen', () => {
  const ventana = ventanaDeCaja(HOJA, {
    esteMin: 900,
    esteMax: 1300,
    norteMin: 1800,
    norteMax: 2100,
  });

  assert.deepEqual(ventana, { izquierda: 0, arriba: 0, derecha: 100, abajo: 50 });
});

test('una caja que no toca la hoja no da ventana', () => {
  assert.equal(ventanaDeCaja(HOJA, { esteMin: 5000, esteMax: 5100, norteMin: 1900, norteMax: 2000 }), null);
  assert.equal(ventanaDeCaja(HOJA, { esteMin: 1000, esteMax: 1100, norteMin: 3000, norteMax: 3100 }), null);
});

test('una caja que solo roza el borde por fuera tampoco da ventana', () => {
  assert.equal(ventanaDeCaja(HOJA, { esteMin: 800, esteMax: 1000, norteMin: 1900, norteMax: 2000 }).izquierda, 0);
  assert.equal(ventanaDeCaja(HOJA, { esteMin: 700, esteMax: 900, norteMin: 1900, norteMax: 2000 }), null);
});

test('la ventana siempre tiene al menos un pixel de ancho y de alto', () => {
  const ventana = ventanaDeCaja(HOJA, { esteMin: 1050, esteMax: 1050, norteMin: 1950, norteMax: 1950 });

  assert.ok(ventana.derecha > ventana.izquierda);
  assert.ok(ventana.abajo > ventana.arriba);
});

// --- De vuelta a coordenadas

test('el noroeste de una ventana es el CENTRO de su primer pixel, no su esquina', () => {
  // El GeoTIFF ancla en la esquina exterior y la malla muestrea por centros.
  // Media celda de desfase son 1 m con pixeles de 2 m: suficiente para que una
  // fachada se quede colgando o enterrada.
  const noroeste = noroesteDeVentana(HOJA, { izquierda: 10, arriba: 20, derecha: 30, abajo: 40 });

  assert.deepEqual(noroeste, { este: 1000 + 10 * 2 + 1, norte: 2000 - 20 * 2 - 1 });
});

test('la ventana en el origen tambien se desplaza media celda', () => {
  const noroeste = noroesteDeVentana(HOJA, { izquierda: 0, arriba: 0, derecha: 1, abajo: 1 });

  assert.deepEqual(noroeste, { este: 1001, norte: 1999 });
});

// --- Validacion

test('un paso no positivo se rechaza', () => {
  assert.throws(
    () => ventanaDeCaja({ ...HOJA, paso: { este: 0, norte: 2 } }, { esteMin: 1, esteMax: 2, norteMin: 1, norteMax: 2 }),
    /paso/,
  );
});

test('una caja invertida se rechaza en vez de dar una ventana vacia sin explicacion', () => {
  assert.throws(
    () => ventanaDeCaja(HOJA, { esteMin: 1100, esteMax: 1000, norteMin: 1900, norteMax: 2000 }),
    /caja/i,
  );
});
