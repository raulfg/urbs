import test from 'node:test';
import assert from 'node:assert/strict';

import { centroideDePolilinea, partirPolilinea } from '../src/troceado.js';

/**
 * La invariante que justifica toda esta pieza: un tramo se guarda entero en la
 * celda de su centroide, asi que ningun vertice puede alejarse del centroide
 * mas de lo que el formato admite de margen.
 *
 * @param {Array<[number, number]>} pieza
 * @param {number} maximo
 */
function distanciaMaximaAlCentroide(pieza) {
  const centroide = centroideDePolilinea(pieza);
  return pieza.reduce(
    (peor, [este, norte]) =>
      Math.max(peor, Math.abs(este - centroide.este), Math.abs(norte - centroide.norte)),
    0,
  );
}

/** Polilinea recta de `metros` de largo sobre el eje este, con `vertices` puntos. */
function recta(metros, vertices = 2) {
  return Array.from({ length: vertices }, (_, i) => [
    (metros * i) / (vertices - 1),
    0,
  ]);
}

test('una polilinea que cabe en el maximo vuelve entera, en una sola pieza', () => {
  const eje = [
    [0, 0],
    [100, 0],
    [100, 80],
  ];
  assert.deepEqual(partirPolilinea(eje, 1000), [eje]);
});

test('una polilinea que no cabe se parte en varias piezas', () => {
  const piezas = partirPolilinea(recta(2200, 12), 1000);
  assert.ok(piezas.length > 1, `se esperaba mas de una pieza, hubo ${piezas.length}`);
});

test('cada pieza cabe en el maximo: es la unica razon de existir de la particion', () => {
  const piezas = partirPolilinea(recta(2200, 12), 1000);
  for (const pieza of piezas) {
    assert.ok(
      distanciaMaximaAlCentroide(pieza) <= 1000,
      `una pieza se aleja ${distanciaMaximaAlCentroide(pieza)} m de su centroide`,
    );
  }
});

test('el eje no se rompe: cada pieza empieza donde acaba la anterior', () => {
  const piezas = partirPolilinea(recta(2200, 12), 400);
  for (let i = 1; i < piezas.length; i += 1) {
    const finAnterior = piezas[i - 1].at(-1);
    const inicio = piezas[i][0];
    assert.deepEqual(inicio, finAnterior, `hueco entre la pieza ${i - 1} y la ${i}`);
  }
});

test('ninguna pieza se queda con un solo vertice: eso no es una polilinea', () => {
  for (const piezas of [
    partirPolilinea(recta(2200, 12), 400),
    partirPolilinea(recta(5000, 3), 250),
    partirPolilinea(recta(1000, 2), 100),
  ]) {
    for (const pieza of piezas) {
      assert.ok(pieza.length >= 2, `una pieza tiene ${pieza.length} vertices`);
    }
  }
});

test('un unico segmento mas largo que el maximo se subdivide sobre su propia recta', () => {
  // Dos vertices y 1000 m de por medio: no hay donde cortar sin interpolar.
  // Interpolar sobre un segmento recto es exacto, no inventa geometria.
  const piezas = partirPolilinea(
    [
      [0, 0],
      [1000, 0],
    ],
    200,
  );

  assert.ok(piezas.length > 1);
  for (const pieza of piezas) {
    for (const [este, norte] of pieza) {
      assert.equal(norte, 0, 'un punto interpolado se ha salido de la recta');
      assert.ok(este >= 0 && este <= 1000);
    }
    assert.ok(distanciaMaximaAlCentroide(pieza) <= 200);
  }
});

test('las piezas recorren el eje original de principio a fin, en orden', () => {
  const eje = recta(2200, 12);
  const piezas = partirPolilinea(eje, 700);

  assert.deepEqual(piezas[0][0], eje[0]);
  assert.deepEqual(piezas.at(-1).at(-1), eje.at(-1));

  // Concatenar quitando el vertice compartido devuelve una secuencia monotona
  // que pasa por todos los vertices originales.
  const recorrido = piezas.flatMap((pieza, i) => (i === 0 ? pieza : pieza.slice(1)));
  for (let i = 1; i < recorrido.length; i += 1) {
    assert.ok(recorrido[i][0] >= recorrido[i - 1][0], 'el recorrido retrocede');
  }
  for (const vertice of eje) {
    assert.ok(
      recorrido.some(([este, norte]) => este === vertice[0] && norte === vertice[1]),
      `se ha perdido el vertice ${JSON.stringify(vertice)}`,
    );
  }
});

test('el limite se comprueba en los dos ejes por separado, no por distancia', () => {
  // Una linea puramente norte-sur: si solo se mirase el este, no se partiria.
  const eje = Array.from({ length: 12 }, (_, i) => [0, i * 200]);
  const piezas = partirPolilinea(eje, 500);

  assert.ok(piezas.length > 1);
  for (const pieza of piezas) {
    assert.ok(distanciaMaximaAlCentroide(pieza) <= 500);
  }
});

test('una polilinea de ida y vuelta no se parte si su extension cabe, por larga que sea', () => {
  // 4 km de recorrido dentro de un cuadrado de 100 m. Lo que limita es la
  // extension, no la longitud: el margen protege coordenadas, no metros.
  const eje = [];
  for (let i = 0; i < 20; i += 1) {
    eje.push([0, i * 5], [100, i * 5]);
  }
  assert.equal(partirPolilinea(eje, 500).length, 1);
});

test('un maximo que no es un numero positivo se rechaza', () => {
  for (const basura of [0, -1, Number.NaN, '1000', undefined]) {
    assert.throws(() => partirPolilinea(recta(100), basura), /extensionMaxima/);
  }
});

test('una polilinea de menos de dos posiciones se rechaza', () => {
  assert.throws(() => partirPolilinea([[0, 0]], 100), /partirPolilinea/);
  assert.throws(() => partirPolilinea('no', 100), /partirPolilinea/);
});
