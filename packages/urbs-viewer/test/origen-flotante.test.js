import test from 'node:test';
import assert from 'node:assert/strict';

import { esSeguroEnFloat32, pasoFloat32 } from 'urbs-core';

import {
  UMBRAL_REBASE_POR_DEFECTO,
  aEscena,
  crearOrigenFlotante,
  desplazamientoDeCelda,
} from '../src/origen-flotante.js';

/** A Coruna en ETRS89 / UTM 29N: el caso que hizo falta esta decision. */
const ANCLA = Object.freeze({ este: 547000, norte: 4800500 });

test('el este va al eje X y el norte al eje Z invertido: y queda para la altura', () => {
  assert.deepEqual(aEscena({ este: 10, norte: 20 }), { x: 10, z: -20 });
});

test('una celda se coloca en el desplazamiento entre su origen y el ancla', () => {
  const desplazamiento = desplazamientoDeCelda({ este: 547250, norte: 4800750 }, ANCLA);
  assert.deepEqual(desplazamiento, { x: 250, z: -250 });
});

test('la celda del ancla cae exactamente en el origen de la escena', () => {
  assert.deepEqual(desplazamientoDeCelda(ANCLA, ANCLA), { x: 0, z: -0 });
});

test('NINGUN desplazamiento de celda es una coordenada UTM absoluta', () => {
  // La regla 1 de la decision 0001, convertida en prueba. Con el ancla en la
  // propia ciudad, las magnitudes bajan de 1e6 a 1e3 y el escalon de float32
  // pasa de medio metro a decimas de milimetro.
  const origenDeCelda = { este: 547250, norte: 4800750 };
  const { x, z } = desplazamientoDeCelda(origenDeCelda, ANCLA);

  assert.ok(esSeguroEnFloat32(Math.abs(x)));
  assert.ok(esSeguroEnFloat32(Math.abs(z)));
  assert.ok(
    pasoFloat32(origenDeCelda.norte) > 0.4,
    'el norte absoluto deberia ser inseguro: si no, esta prueba no prueba nada',
  );
});

test('el origen flotante nace en el ancla que se le da', () => {
  const origen = crearOrigenFlotante({ ancla: ANCLA });
  assert.deepEqual(origen.ancla, ANCLA);
  assert.equal(origen.umbralMetros, UMBRAL_REBASE_POR_DEFECTO);
});

test('mientras la camara no se aleje del umbral no se rebasa nada', () => {
  const origen = crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 });
  const resultado = origen.rebasarSiHaceFalta({ x: 300, z: -400 });

  assert.equal(resultado.rebasado, false);
  assert.deepEqual(resultado.delta, { x: 0, z: 0 });
  assert.deepEqual(origen.ancla, ANCLA);
});

test('superado el umbral, el ancla se muda bajo la camara', () => {
  const origen = crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 });
  const resultado = origen.rebasarSiHaceFalta({ x: 1200, z: -900 });

  assert.equal(resultado.rebasado, true);
  assert.deepEqual(resultado.delta, { x: 1200, z: -900 });
  assert.deepEqual(origen.ancla, { este: 547000 + 1200, norte: 4800500 + 900 });
});

test('el ancla sigue siendo la misma posicion del mundo despues de rebasar', () => {
  // Lo unico que no puede cambiar: el punto geografico bajo la camara.
  const origen = crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 });
  const celda = { este: 548000, norte: 4801000 };

  const antes = desplazamientoDeCelda(celda, origen.ancla);
  const { delta } = origen.rebasarSiHaceFalta({ x: 1200, z: -900 });
  const despues = desplazamientoDeCelda(celda, origen.ancla);

  assert.ok(Math.abs(antes.x - delta.x - despues.x) < 1e-9);
  assert.ok(Math.abs(antes.z - delta.z - despues.z) < 1e-9);
});

test('rebasar mil veces no acumula deriva: el ancla se recalcula, no se suma a ojo', () => {
  const origen = crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1 });
  for (let i = 0; i < 1000; i += 1) {
    origen.rebasarSiHaceFalta({ x: 2, z: 0 });
  }
  assert.equal(origen.ancla.este, ANCLA.este + 2000);
  assert.equal(origen.ancla.norte, ANCLA.norte);
});

test('el ancla vuelve a metros absolutos: hace falta para saber que celda pisas', () => {
  const origen = crearOrigenFlotante({ ancla: ANCLA });
  assert.deepEqual(origen.aProyectado({ x: 100, z: -250 }), {
    este: 547100,
    norte: 4800750,
  });
});

test('un ancla que no sea un punto proyectado se rechaza', () => {
  for (const basura of [null, {}, { este: 1 }, { este: Number.NaN, norte: 0 }]) {
    assert.throws(() => crearOrigenFlotante({ ancla: basura }), /ancla/);
  }
});

test('un umbral no positivo se rechaza: rebasar en cada fotograma no es una opcion', () => {
  for (const basura of [0, -5, Number.NaN]) {
    assert.throws(() => crearOrigenFlotante({ ancla: ANCLA, umbralMetros: basura }), /umbral/);
  }
});
