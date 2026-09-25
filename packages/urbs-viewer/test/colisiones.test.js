import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Confianza,
  crearCelda,
  crearProcedencia,
  codificarCelda,
  vistasDeCelda,
} from 'urbs-core';

import {
  crearColaAmortizada,
  colisionesDeCelda,
  nubeDeColisionDeEdificio,
} from '../src/colisiones.js';

const LADO = 250;
const CELDA = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });
const DECLARADO = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });

function cuadrado(este, norte, lado) {
  return [
    [este, norte],
    [este + lado, norte],
    [este + lado, norte + lado],
    [este, norte + lado],
    [este, norte],
  ];
}

function vistasDe(contenido) {
  return vistasDeCelda(codificarCelda({ celda: CELDA, epsg: 25829, tramos: [], ...contenido }));
}

function edificio(extra = {}) {
  return {
    id: 'way/1',
    anillos: [cuadrado(10, 10, 20)],
    ancla: { este: 20, norte: 20 },
    alturaMetros: 12,
    plantas: 4,
    uso: 'residencial',
    procedencia: DECLARADO,
    ...extra,
  };
}

// --- Nube de puntos de un edificio

test('un edificio da dos anillos de puntos: el del suelo y el de la cornisa', () => {
  const nube = nubeDeColisionDeEdificio([0, 0, 10, 0, 10, 10, 0, 10], 12);

  // Cuatro vertices arriba y cuatro abajo, tres numeros por punto.
  assert.equal(nube.length, 8 * 3);
  assert.ok(nube instanceof Float32Array);
});

test('la nube va en ejes de escena: el este a X, el norte a -Z y la altura a Y', () => {
  const nube = nubeDeColisionDeEdificio([3, 7, 13, 7, 13, 17], 20);

  // Primer punto del anillo bajo.
  assert.deepEqual([...nube.subarray(0, 3)], [3, 0, -7]);
  // Primer punto del anillo alto: mismo sitio, a la altura del edificio.
  assert.deepEqual([...nube.subarray(9, 12)], [3, 20, -7]);
});

test('el vertice de cierre no se duplica: un punto repetido no aporta casco', () => {
  const abierto = nubeDeColisionDeEdificio([0, 0, 10, 0, 10, 10, 0, 10], 9);
  const cerrado = nubeDeColisionDeEdificio([0, 0, 10, 0, 10, 10, 0, 10, 0, 0], 9);

  assert.equal(cerrado.length, abierto.length);
});

test('un anillo con menos de tres vertices distintos NO da colisionador', () => {
  // `ColliderDesc.convexHull` devuelve null en estos casos, y el dato real los
  // trae. Filtrarlos aqui permite contarlos por separado del rechazo de Rapier.
  assert.equal(nubeDeColisionDeEdificio([0, 0, 10, 0], 10), null);
  assert.equal(nubeDeColisionDeEdificio([0, 0, 0, 0, 0, 0], 10), null);
  assert.equal(nubeDeColisionDeEdificio([], 10), null);
});

test('un anillo degenerado de area cero NO da colisionador', () => {
  // Tres vertices alineados: un poligono sin superficie. Extruirlo daria un
  // plano vertical, y el casco convexo de un plano no tiene volumen.
  assert.equal(nubeDeColisionDeEdificio([0, 0, 10, 0, 20, 0], 10), null);
});

test('una altura que no sea positiva NO da colisionador: seria una lamina', () => {
  assert.equal(nubeDeColisionDeEdificio([0, 0, 10, 0, 10, 10], 0), null);
  assert.equal(nubeDeColisionDeEdificio([0, 0, 10, 0, 10, 10], Number.NaN), null);
});

// --- Colisiones de una celda entera

test('una celda da una nube por edificio, con la clave del edificio', () => {
  const { nubes, descartados } = colisionesDeCelda(
    vistasDe({
      edificios: [
        edificio(),
        edificio({ id: 'way/2', anillos: [cuadrado(100, 100, 40)], ancla: { este: 120, norte: 120 } }),
      ],
    }),
  );

  assert.equal(nubes.length, 2);
  assert.equal(descartados, 0);
  assert.deepEqual(
    nubes.map((nube) => nube.indice),
    [0, 1],
  );
  assert.ok(nubes[0].puntos instanceof Float32Array);
});

test('solo cuenta el anillo exterior: un patio no es un agujero por el que caerse', () => {
  // El casco convexo no tiene huecos por definicion. Meter el anillo del patio
  // en la nube no abriria el patio, solo anadiria puntos que ya estan dentro.
  const conPatio = colisionesDeCelda(
    vistasDe({
      edificios: [
        edificio({ anillos: [cuadrado(10, 10, 60), cuadrado(30, 30, 20)], ancla: { este: 40, norte: 40 } }),
      ],
    }),
  );
  const sinPatio = colisionesDeCelda(
    vistasDe({ edificios: [edificio({ anillos: [cuadrado(10, 10, 60)], ancla: { este: 40, norte: 40 } })] }),
  );

  assert.equal(conPatio.nubes[0].puntos.length, sinPatio.nubes[0].puntos.length);
});

test('los edificios descartados se CUENTAN, no se tragan en silencio', () => {
  const { nubes, descartados } = colisionesDeCelda(
    vistasDe({
      edificios: [
        edificio(),
        edificio({
          id: 'way/degenerado',
          anillos: [[[80, 80], [90, 80], [100, 80], [80, 80]]],
          ancla: { este: 90, norte: 80 },
        }),
      ],
    }),
  );

  assert.equal(nubes.length, 1);
  assert.equal(descartados, 1);
});

test('una celda sin edificios no da colisionadores ni descartes', () => {
  const { nubes, descartados } = colisionesDeCelda(vistasDe({ edificios: [] }));

  assert.equal(nubes.length, 0);
  assert.equal(descartados, 0);
});

// --- Cola amortizada

test('la cola entrega como mucho el presupuesto del fotograma', () => {
  const cola = crearColaAmortizada({ porFotograma: 3 });
  cola.encolar('a', 'b', 'c', 'd', 'e');

  assert.deepEqual(cola.drenar(), ['a', 'b', 'c']);
  assert.equal(cola.pendientes, 2);
  assert.deepEqual(cola.drenar(), ['d', 'e']);
  assert.equal(cola.pendientes, 0);
});

test('la cola respeta el orden de entrada: el cuerpo se va DESPUES de sus colisionadores', () => {
  // No es un detalle de estilo: quitar el cuerpo primero invalidaria los
  // colisionadores que aun estan en la cola, y Rapier recicla sus manejadores.
  const cola = crearColaAmortizada({ porFotograma: 100 });
  cola.encolar('colisionador-1', 'colisionador-2');
  cola.encolar('cuerpo');

  assert.deepEqual(cola.drenar(), ['colisionador-1', 'colisionador-2', 'cuerpo']);
});

test('drenar una cola vacia no devuelve nada ni se queja', () => {
  const cola = crearColaAmortizada({ porFotograma: 4 });
  assert.deepEqual(cola.drenar(), []);
  assert.equal(cola.pendientes, 0);
});

test('un presupuesto no positivo se rechaza: la cola no se vaciaria nunca', () => {
  for (const basura of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => crearColaAmortizada({ porFotograma: basura }), /porFotograma/);
  }
});
