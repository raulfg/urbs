import test from 'node:test';
import assert from 'node:assert/strict';

import { crearMallaElevacion, SIN_DATO } from '../src/dominio/elevacion.js';
import {
  UMBRAL_AGUA_DE_RESERVA,
  mascaraDeAguaPorUmbral,
} from '../src/dominio/agua.js';

/**
 * @param {number[][]} filas  De norte a sur
 */
function mallaDe(filas) {
  const alto = filas.length;
  const ancho = filas[0].length;
  return crearMallaElevacion({
    cotas: Float32Array.from(filas.flat()),
    ancho,
    alto,
    noroeste: { este: 0, norte: alto - 1 },
    paso: { este: 1, norte: 1 },
  });
}

/** @param {Uint8Array} mascara */
function dibujar(mascara, ancho) {
  const filas = [];
  for (let y = 0; y < mascara.length / ancho; y += 1) {
    filas.push([...mascara.slice(y * ancho, (y + 1) * ancho)].map((v) => (v ? 'A' : '.')).join(''));
  }
  return filas;
}

// --- Conectividad con el borde

test('el mar es agua porque toca el borde, no solo porque este bajo', () => {
  // Esta es LA correccion. Un umbral a secas clasifica como mar cualquier
  // charco interior que este a cota baja. El mar se reconoce porque sale del
  // recorte: se propaga desde el borde.
  const malla = mallaDe([
    [0, 0, 20, 30],
    [0, 0, 18, 25],
    [0, 0, 15, 22],
    [0, 0, 12, 22],
  ]);

  const { mascara, pixelesDeAgua } = mascaraDeAguaPorUmbral(malla, { umbral: 0 });

  assert.deepEqual(dibujar(mascara, 4), ['AA..', 'AA..', 'AA..', 'AA..']);
  assert.equal(pixelesDeAgua, 8);
});

test('un hueco interior a cota cero NO es mar: es una plaza, un patio o un error', () => {
  const malla = mallaDe([
    [30, 30, 30, 30],
    [30, 0, 0, 30],
    [30, 0, 0, 30],
    [30, 30, 30, 30],
  ]);

  const { mascara, pixelesDeAgua } = mascaraDeAguaPorUmbral(malla, { umbral: 0 });

  assert.equal(pixelesDeAgua, 0);
  assert.deepEqual(dibujar(mascara, 4), ['....', '....', '....', '....']);
});

test('se puede pedir sin conectividad, y entonces el hueco interior SI cuenta', () => {
  // La estrategia es un parametro, no una ley. Un embalse interior es agua de
  // verdad y algun dia habra que admitirlo.
  const malla = mallaDe([
    [30, 30, 30, 30],
    [30, 0, 0, 30],
    [30, 0, 0, 30],
    [30, 30, 30, 30],
  ]);

  const { pixelesDeAgua } = mascaraDeAguaPorUmbral(malla, { umbral: 0, soloDesdeElBorde: false });

  assert.equal(pixelesDeAgua, 4);
});

test('el agua se propaga en diagonal? NO: cuatro vecinos, no ocho', () => {
  // Con ocho vecinos, dos masas de agua que solo se tocan por una esquina se
  // funden, y una playa estrecha puede colar el mar al otro lado de un espigon.
  const malla = mallaDe([
    [0, 30, 30],
    [30, 0, 30],
    [30, 30, 30],
  ]);

  const { pixelesDeAgua } = mascaraDeAguaPorUmbral(malla, { umbral: 0 });

  assert.equal(pixelesDeAgua, 1, 'solo el de la esquina, que es el que toca el borde');
});

// --- El centinela de "sin dato"

test('SIN_DATO nunca es agua, por muy bajo que sea el numero', () => {
  // -32767 significa "no producido", no "aqui hay mar". Es la trampa mas cara
  // de todas: el centinela es menor que cualquier umbral, asi que un filtro
  // ingenuo inunda de oceano todos los huecos del vuelo.
  const malla = mallaDe([
    [SIN_DATO, SIN_DATO, 30],
    [SIN_DATO, 40, 30],
    [50, 40, 30],
  ]);

  const { pixelesDeAgua } = mascaraDeAguaPorUmbral(malla, { umbral: 0 });

  assert.equal(pixelesDeAgua, 0);
});

test('un hueco sin dato no deja pasar el agua a traves', () => {
  // Si el centinela se tratara como agua, el mar de la izquierda se colaria
  // por el hueco y anegaria el valle de la derecha.
  const malla = mallaDe([
    [0, SIN_DATO, 0],
    [0, SIN_DATO, 0],
    [0, SIN_DATO, 0],
  ]);

  const { mascara } = mascaraDeAguaPorUmbral(malla, { umbral: 0 });

  assert.deepEqual(dibujar(mascara, 3), ['A.A', 'A.A', 'A.A']);
});

// --- El umbral

test('el umbral es un parametro: hay hojas donde el mar no cae en cero exacto', () => {
  // Medido: en la hoja 0021 cuadrante 3 el mar se pega a 0,00, pero en el
  // cuadrante 2 vuelve como ruido LiDAR entre -0,89 y +1,4 m. Fijar el cero
  // por ley deja ese cuadrante sin una gota de mar.
  const malla = mallaDe([
    [-0.89, 0.4, 25],
    [1.4, 0.9, 30],
    [0.2, -0.3, 28],
  ]);

  assert.equal(mascaraDeAguaPorUmbral(malla, { umbral: 0 }).pixelesDeAgua, 2);
  assert.equal(mascaraDeAguaPorUmbral(malla, { umbral: 1.5 }).pixelesDeAgua, 6);
});

test('el umbral por defecto existe y es pequeno, no cero a secas', () => {
  assert.ok(UMBRAL_AGUA_DE_RESERVA >= 0);
  assert.ok(UMBRAL_AGUA_DE_RESERVA < 3, 'por encima de esto se empieza a comer muelle');
});

// --- Casos limite

test('una malla toda mar sale toda agua', () => {
  const { pixelesDeAgua } = mascaraDeAguaPorUmbral(mallaDe([[0, 0], [0, 0]]), { umbral: 0 });
  assert.equal(pixelesDeAgua, 4);
});

test('una malla toda tierra no tiene ni una gota', () => {
  const { pixelesDeAgua } = mascaraDeAguaPorUmbral(mallaDe([[9, 9], [9, 9]]), { umbral: 0 });
  assert.equal(pixelesDeAgua, 0);
});

test('la mascara tiene un byte por pixel y el mismo tamano que la malla', () => {
  const malla = mallaDe([[0, 9, 9], [0, 9, 9]]);
  const { mascara } = mascaraDeAguaPorUmbral(malla, { umbral: 0 });

  assert.ok(mascara instanceof Uint8Array);
  assert.equal(mascara.length, 6);
});

test('un umbral que no sea un numero se rechaza', () => {
  const malla = mallaDe([[0, 9], [0, 9]]);
  assert.throws(() => mascaraDeAguaPorUmbral(malla, { umbral: Number.NaN }), /umbral/);
});
