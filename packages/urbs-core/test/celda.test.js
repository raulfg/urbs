import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BITS_MANTISA_FLOAT32,
  PRECISION_FLOAT32_POR_DEFECTO,
  indiceDeCelda,
  origenDeCelda,
  claveDeCelda,
  crearCelda,
  celdaDePunto,
  aLocal,
  aProyectado,
  pasoFloat32,
  esSeguroEnFloat32,
  exigirCoordenadasLocales,
} from '../src/dominio/celda.js';

// Coruna en EPSG:25829: este ~547.000, norte ~4.800.000.
const CORUNA = { este: 547123.45, norte: 4800678.9 };
const LADO = 250;

const cerca = (valor, esperado, tolerancia = 1e-9) =>
  assert.ok(
    Math.abs(valor - esperado) <= tolerancia,
    `esperaba ${esperado} +-${tolerancia}, recibido ${valor}`,
  );

test('el indice de celda sale de dividir por el lado y truncar hacia abajo', () => {
  assert.deepEqual(indiceDeCelda(CORUNA, LADO), { x: 2188, z: 19202 });
});

test('la reticula se ancla en multiplos globales del lado, no en el area del territorio', () => {
  // El indice solo depende del punto y del lado: no hay parametro de area que
  // pueda desplazar la reticula si se retoca el territorio.
  const origen = origenDeCelda(indiceDeCelda(CORUNA, LADO), LADO);
  assert.equal(origen.este % LADO, 0);
  assert.equal(origen.norte % LADO, 0);
  assert.deepEqual(origen, { este: 547000, norte: 4800500 });
});

test('el origen se recupera del indice con aritmetica exacta', () => {
  assert.deepEqual(origenDeCelda({ x: 2188, z: 19200 }, LADO), {
    este: 547000,
    norte: 4800000,
  });
  assert.deepEqual(origenDeCelda({ x: 0, z: 0 }, LADO), { este: 0, norte: 0 });
});

test('las coordenadas locales caen siempre en [0, lado)', () => {
  const celda = celdaDePunto(CORUNA, LADO);
  const local = aLocal(CORUNA, celda);

  cerca(local.este, 123.45);
  cerca(local.norte, 178.9);
  assert.ok(local.este >= 0 && local.este < LADO);
  assert.ok(local.norte >= 0 && local.norte < LADO);
});

test('local y proyectado son inversas una de otra', () => {
  const celda = celdaDePunto(CORUNA, LADO);
  const vuelta = aProyectado(aLocal(CORUNA, celda), celda);

  cerca(vuelta.este, CORUNA.este);
  cerca(vuelta.norte, CORUNA.norte);
});

test('ningun punto del plano se sale del rango local, tampoco en negativos', () => {
  const lados = [250, 500, 137.5];

  for (const lado of lados) {
    for (let i = 0; i < 500; i += 1) {
      const punto = {
        este: (Math.random() - 0.5) * 2e7,
        norte: (Math.random() - 0.5) * 2e7,
      };
      const celda = celdaDePunto(punto, lado);
      const local = aLocal(punto, celda);

      assert.ok(
        local.este >= 0 && local.este < lado,
        `este local fuera de rango: ${local.este} con lado ${lado}`,
      );
      assert.ok(
        local.norte >= 0 && local.norte < lado,
        `norte local fuera de rango: ${local.norte} con lado ${lado}`,
      );
    }
  }
});

test('las coordenadas negativas truncan hacia abajo, no hacia cero', () => {
  // Con truncamiento hacia cero, -12,5 caeria en la celda 0 y daria un local
  // negativo. Math.floor lo manda a la celda -1.
  assert.deepEqual(indiceDeCelda({ este: -12.5, norte: -0.0001 }, LADO), {
    x: -1,
    z: -1,
  });

  const celda = celdaDePunto({ este: -12.5, norte: -0.0001 }, LADO);
  assert.deepEqual(celda.origen, { este: -250, norte: -250 });

  const local = aLocal({ este: -12.5, norte: -0.0001 }, celda);
  cerca(local.este, 237.5);
  cerca(local.norte, 249.9999);
});

test('el borde exacto de una celda pertenece a la celda que empieza ahi', () => {
  assert.deepEqual(indiceDeCelda({ este: -250, norte: 250 }, LADO), { x: -1, z: 1 });
  assert.deepEqual(aLocal({ este: -250, norte: 250 }, crearCelda({ indice: { x: -1, z: 1 }, ladoCeldaMetros: LADO })), {
    este: 0,
    norte: 0,
  });
});

test('la clave de celda es estable y valida como nombre de fichero', () => {
  assert.equal(claveDeCelda({ x: 2188, z: 19202 }), 'x2188z19202');
  assert.equal(claveDeCelda({ x: -1, z: -3 }), 'x-1z-3');
  assert.equal(celdaDePunto(CORUNA, LADO).clave, 'x2188z19202');
});

test('la celda es un valor inmutable con indice, origen, lado y clave', () => {
  const celda = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });

  assert.deepEqual(celda.indice, { x: 2188, z: 19202 });
  assert.deepEqual(celda.origen, { este: 547000, norte: 4800500 });
  assert.equal(celda.ladoCeldaMetros, LADO);
  assert.equal(celda.clave, 'x2188z19202');
  assert.ok(Object.isFrozen(celda));
  assert.ok(Object.isFrozen(celda.indice));
  assert.ok(Object.isFrozen(celda.origen));
});

test('el paso de float32 en el norte de Coruna es de medio metro', () => {
  // 4.800.000 cae entre 2^22 y 2^23, asi que el ULP es 2^(22-23) = 0,5 m.
  assert.equal(pasoFloat32(4800000), 0.5);
  // 547.000 cae entre 2^19 y 2^20: 2^(19-23) = 0,0625 m.
  assert.equal(pasoFloat32(547000), 0.0625);
  // Una coordenada local de 250 m: 2^(7-23), unas 15 micras.
  assert.equal(pasoFloat32(250), 2 ** -16);
});

test('el paso se calcula desde la magnitud, sin tabla de umbrales', () => {
  assert.equal(pasoFloat32(2 ** 23), 1);
  assert.equal(pasoFloat32(2 ** 23 - 1), 0.5);
  assert.equal(pasoFloat32(1), 2 ** -BITS_MANTISA_FLOAT32 * 2);
  assert.equal(pasoFloat32(-4800000), 0.5);
  assert.equal(pasoFloat32(0), 2 ** -149);
});

test('una magnitud no finita no devuelve un paso absurdo', () => {
  assert.throws(() => pasoFloat32(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => pasoFloat32(Number.NaN), RangeError);
});

test('lo local entra en float32 y lo absoluto no', () => {
  assert.equal(PRECISION_FLOAT32_POR_DEFECTO, 0.001);
  assert.equal(esSeguroEnFloat32(249.9), true);
  assert.equal(esSeguroEnFloat32(4800000), false);
  assert.equal(esSeguroEnFloat32(547000), false);
  // Con 1 mm de precision exigida el limite esta en 2^14 metros.
  assert.equal(esSeguroEnFloat32(2 ** 14 - 1), true);
  assert.equal(esSeguroEnFloat32(2 ** 14), false);
  // La precision exigida es un parametro, no un umbral cableado.
  assert.equal(esSeguroEnFloat32(4800000, 1), true);
});

test('meter UTM absoluto donde se esperan coordenadas locales revienta', () => {
  const celda = celdaDePunto(CORUNA, LADO);

  assert.throws(() => exigirCoordenadasLocales(CORUNA, celda), (error) => {
    assert.ok(error instanceof RangeError);
    assert.match(error.message, /local/i);
    assert.match(error.message, /aLocal/);
    assert.match(error.message, /x2188z19202/);
    return true;
  });
});

test('las coordenadas locales validas pasan la guarda sin tocar nada', () => {
  const celda = celdaDePunto(CORUNA, LADO);
  const local = aLocal(CORUNA, celda);

  assert.deepEqual(exigirCoordenadasLocales(local, celda), local);
});

test('un lado de celda invalido falla en vez de partir la reticula', () => {
  assert.throws(() => indiceDeCelda(CORUNA, 0), RangeError);
  assert.throws(() => indiceDeCelda(CORUNA, -250), RangeError);
  assert.throws(() => origenDeCelda({ x: 0, z: 0 }, Number.NaN), RangeError);
});

test('un punto o un indice mal formados fallan con TypeError', () => {
  assert.throws(() => indiceDeCelda({ este: 1 }, LADO), TypeError);
  assert.throws(() => indiceDeCelda(null, LADO), TypeError);
  assert.throws(() => origenDeCelda({ x: 1.5, z: 0 }, LADO), TypeError);
  assert.throws(() => crearCelda({ indice: { x: 0 }, ladoCeldaMetros: LADO }), TypeError);
});
