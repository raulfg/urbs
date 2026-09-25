import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIRECCION_MAXIMA,
  DIRECCION_MINIMA,
  FUERZA_MOTOR,
  VELOCIDAD_MAXIMA,
  crearConduccion,
  limiteDeDireccion,
} from '../src/conduccion.js';

const QUIETO = Object.freeze({
  acelera: false,
  frena: false,
  izquierda: false,
  derecha: false,
  velocidad: 0,
});

/** Corre varios fotogramas seguidos y devuelve el ultimo resultado. */
function correr(conduccion, mando, fotogramas, segundos = 1 / 60) {
  let ultimo;
  for (let i = 0; i < fotogramas; i += 1) {
    ultimo = conduccion.actualizar({ ...QUIETO, ...mando }, segundos);
  }
  return ultimo;
}

// --- Motor

test('acelerar desde parado empuja hacia delante y no frena', () => {
  const mando = crearConduccion().actualizar({ ...QUIETO, acelera: true }, 1 / 60);

  assert.equal(mando.fuerzaMotor, FUERZA_MOTOR);
  assert.equal(mando.freno, 0);
});

test('a la velocidad maxima se corta el motor: no se acelera hasta el infinito', () => {
  const mando = crearConduccion().actualizar(
    { ...QUIETO, acelera: true, velocidad: VELOCIDAD_MAXIMA + 1 },
    1 / 60,
  );

  assert.equal(mando.fuerzaMotor, 0);
});

test('sin tocar nada el coche no empuja, pero frena un poco: el motor retiene', () => {
  const mando = crearConduccion().actualizar({ ...QUIETO, velocidad: 15 }, 1 / 60);

  assert.equal(mando.fuerzaMotor, 0);
  assert.ok(mando.freno > 0, 'sin retencion el coche rodaria eternamente');
});

// --- Freno contra marcha atras

test('frenar yendo hacia delante FRENA, no da marcha atras', () => {
  // El error clasico del coche arcade: pulsar freno a 80 por hora y salir
  // disparado hacia atras. El estado importa, no solo la tecla.
  const mando = crearConduccion().actualizar({ ...QUIETO, frena: true, velocidad: 20 }, 1 / 60);

  assert.ok(mando.freno > 0);
  assert.equal(mando.fuerzaMotor, 0);
});

test('frenar ya parado SI da marcha atras', () => {
  const mando = crearConduccion().actualizar({ ...QUIETO, frena: true, velocidad: 0 }, 1 / 60);

  assert.ok(mando.fuerzaMotor < 0, 'deberia empujar hacia atras');
  assert.equal(mando.freno, 0);
});

test('frenar yendo ya hacia atras sigue dando gas atras, no frena de golpe', () => {
  const mando = crearConduccion().actualizar({ ...QUIETO, frena: true, velocidad: -5 }, 1 / 60);

  assert.ok(mando.fuerzaMotor < 0);
  assert.equal(mando.freno, 0);
});

test('acelerar yendo hacia atras frena primero: no se cambia de sentido de golpe', () => {
  const mando = crearConduccion().actualizar(
    { ...QUIETO, acelera: true, velocidad: -5 },
    1 / 60,
  );

  assert.ok(mando.freno > 0);
  assert.equal(mando.fuerzaMotor, 0);
});

test('con freno y acelerador a la vez manda el freno', () => {
  const mando = crearConduccion().actualizar(
    { ...QUIETO, acelera: true, frena: true, velocidad: 20 },
    1 / 60,
  );

  assert.ok(mando.freno > 0);
  assert.equal(mando.fuerzaMotor, 0);
});

// --- Direccion

test('el volante no salta: tarda en llegar al tope', () => {
  // Poner la rueda en el tope en un fotograma es lo que hace que un coche
  // arcade sea imposible de conducir en linea recta.
  const conduccion = crearConduccion();
  const primero = conduccion.actualizar({ ...QUIETO, izquierda: true }, 1 / 60);

  assert.ok(primero.direccion > 0, 'gira a la izquierda');
  assert.ok(primero.direccion < DIRECCION_MAXIMA / 4, 'y no llega al tope de golpe');
});

test('manteniendo el giro se llega al tope y ahi se queda', () => {
  const conduccion = crearConduccion();
  const mando = correr(conduccion, { izquierda: true }, 120);

  assert.ok(Math.abs(mando.direccion - DIRECCION_MAXIMA) < 1e-6);
});

test('al soltar, el volante vuelve solo al centro', () => {
  const conduccion = crearConduccion();
  correr(conduccion, { izquierda: true }, 120);
  const mando = correr(conduccion, {}, 120);

  assert.ok(Math.abs(mando.direccion) < 1e-6);
});

test('izquierda y derecha a la vez se anulan: el volante vuelve al centro', () => {
  const conduccion = crearConduccion();
  correr(conduccion, { izquierda: true }, 60);
  const mando = correr(conduccion, { izquierda: true, derecha: true }, 120);

  assert.ok(Math.abs(mando.direccion) < 1e-6);
});

test('a mas velocidad, menos angulo de giro', () => {
  // Con el mismo tope a 100 que a 10, el coche da un trompo a la minima
  // correccion. Cerrar la direccion con la velocidad es casi todo lo que
  // separa "se conduce solo" de "pelearse con el coche".
  assert.ok(limiteDeDireccion(0) > limiteDeDireccion(VELOCIDAD_MAXIMA / 2));
  assert.ok(limiteDeDireccion(VELOCIDAD_MAXIMA / 2) > limiteDeDireccion(VELOCIDAD_MAXIMA));
  assert.equal(limiteDeDireccion(0), DIRECCION_MAXIMA);
  assert.ok(Math.abs(limiteDeDireccion(VELOCIDAD_MAXIMA) - DIRECCION_MINIMA) < 1e-9);
});

test('el limite de direccion no depende del sentido de la marcha', () => {
  assert.equal(limiteDeDireccion(-20), limiteDeDireccion(20));
});

test('pasada la velocidad maxima el limite no baja mas: se queda en el minimo', () => {
  assert.ok(Math.abs(limiteDeDireccion(VELOCIDAD_MAXIMA * 5) - DIRECCION_MINIMA) < 1e-9);
});

test('el volante ya girado se recorta al acelerar: el limite baja con la velocidad', () => {
  const conduccion = crearConduccion();
  correr(conduccion, { izquierda: true }, 200);
  const rapido = conduccion.actualizar(
    { ...QUIETO, izquierda: true, velocidad: VELOCIDAD_MAXIMA },
    1 / 60,
  );

  assert.ok(rapido.direccion <= limiteDeDireccion(VELOCIDAD_MAXIMA) + 1e-9);
});

test('un fotograma de cero segundos no mueve el volante', () => {
  const conduccion = crearConduccion();
  const mando = conduccion.actualizar({ ...QUIETO, izquierda: true }, 0);

  assert.equal(mando.direccion, 0);
});
