import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RADIO_FISICA_POR_DEFECTO,
  RADIO_RENDER_POR_DEFECTO,
  celdasEnRadio,
  distanciaACelda,
  planDeCarga,
  RADIO_GUARDIA_COCHE,
  celdasParaAnclas,
  radiosDeStreaming,
} from '../src/streaming.js';

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

// --- Radios

test('el radio de fisica es MAYOR que el de render, o se conduce fuera del mundo', () => {
  const radios = radiosDeStreaming();

  assert.equal(radios.render, RADIO_RENDER_POR_DEFECTO);
  assert.equal(radios.fisica, RADIO_FISICA_POR_DEFECTO);
  assert.ok(radios.fisica > radios.render);
});

test('un radio de fisica que no supere al de render se rechaza al arrancar', () => {
  // Es la clase de error que no se ve hasta que alguien conduce hasta el borde
  // y se cae. Comprobarlo cuesta una linea y se detecta en el primer fotograma.
  assert.throws(() => radiosDeStreaming({ render: 1000, fisica: 1000 }), /MAYOR/);
  assert.throws(() => radiosDeStreaming({ render: 1000, fisica: 800 }), /MAYOR/);
});

test('un radio que no sea un numero positivo de metros se rechaza', () => {
  assert.throws(() => radiosDeStreaming({ render: 0 }), /render/);
  assert.throws(() => radiosDeStreaming({ fisica: Number.NaN }), /fisica/);
});

// --- Varias anclas

/** Rejilla de 5x5 celdas de 250 m con origen en (0, 0). */
function rejilla() {
  const salida = [];
  for (let x = 0; x < 5; x += 1) {
    for (let z = 0; z < 5; z += 1) {
      salida.push({ clave: `x${x}z${z}`, origen: { este: x * 250, norte: z * 250 } });
    }
  }
  return salida;
}

test('dos anclas separadas traen las celdas de las dos, sin repetir', () => {
  // Es el arreglo del coche abandonado: al volar, la camara manda, pero el
  // coche sigue donde se quedo y su celda no puede desaparecer.
  const claves = celdasParaAnclas(
    rejilla(),
    [
      { punto: { este: 125, norte: 125 }, radio: 10 },
      { punto: { este: 1125, norte: 1125 }, radio: 10 },
    ],
    250,
  );

  assert.deepEqual([...claves].sort(), ['x0z0', 'x4z4']);
});

test('una celda que piden las dos anclas aparece UNA vez', () => {
  const claves = celdasParaAnclas(
    rejilla(),
    [
      { punto: { este: 125, norte: 125 }, radio: 10 },
      { punto: { este: 130, norte: 130 }, radio: 10 },
    ],
    250,
  );

  assert.deepEqual(claves, ['x0z0']);
});

test('el orden sigue siendo por cercania, contando el ancla MAS proxima', () => {
  const claves = celdasParaAnclas(
    rejilla(),
    [
      { punto: { este: 125, norte: 125 }, radio: 2000 },
      { punto: { este: 1125, norte: 1125 }, radio: 2000 },
    ],
    250,
  );

  // Las dos celdas que se pisan salen primero, a distancia cero.
  assert.ok(claves.slice(0, 2).includes('x0z0'));
  assert.ok(claves.slice(0, 2).includes('x4z4'));
});

test('el radio de guardia del coche cubre su celda y las vecinas', () => {
  // Con celdas de 250 m, el coche en una esquina sigue teniendo suelo alrededor.
  assert.ok(RADIO_GUARDIA_COCHE >= 250);
  // Y es MUCHO menor que el de fisicas: no es un segundo radio de juego.
  assert.ok(RADIO_GUARDIA_COCHE < RADIO_FISICA_POR_DEFECTO / 2);

  const claves = celdasParaAnclas(
    rejilla(),
    [{ punto: { este: 499, norte: 499 }, radio: RADIO_GUARDIA_COCHE }],
    250,
  );

  assert.ok(claves.includes('x1z1'), 'la celda que pisa');
  assert.ok(claves.includes('x2z2'), 'la vecina en diagonal');
});

test('un ancla sin punto se ignora en vez de reventar', () => {
  // El coche no existe hasta que acaba de cargar el mundo; el bucle no puede
  // caerse por eso.
  const claves = celdasParaAnclas(
    rejilla(),
    [{ punto: { este: 125, norte: 125 }, radio: 10 }, { punto: undefined, radio: 10 }],
    250,
  );

  assert.deepEqual(claves, ['x0z0']);
});

test('sin anclas se rechaza: descargaria el mundo entero en silencio', () => {
  assert.throws(() => celdasParaAnclas(rejilla(), [], 250), /ancla/);
});

test('un radio no positivo se rechaza', () => {
  assert.throws(
    () => celdasParaAnclas(rejilla(), [{ punto: { este: 0, norte: 0 }, radio: 0 }], 250),
    /radio/,
  );
});
