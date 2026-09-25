import test from 'node:test';
import assert from 'node:assert/strict';

import { Estructura } from 'urbs-core';

import { estructuraDeVia, nivelDeVia } from '../src/osm/etiquetas.js';

// --- Puentes

test('bridge=yes es un puente', () => {
  assert.equal(estructuraDeVia({ bridge: 'yes' }), Estructura.PUENTE);
});

test('los tipos concretos de puente tambien son puente', () => {
  // En el slice aparece `boardwalk` (una pasarela de madera del paseo).
  for (const valor of ['viaduct', 'boardwalk', 'aqueduct', 'cantilever']) {
    assert.equal(estructuraDeVia({ bridge: valor }), Estructura.PUENTE, valor);
  }
});

test('bridge=no NO es un puente', () => {
  assert.equal(estructuraDeVia({ bridge: 'no' }), Estructura.RASANTE);
});

// --- Tuneles, y el matiz que importa

test('tunnel=yes es un tunel', () => {
  assert.equal(estructuraDeVia({ tunnel: 'yes' }), Estructura.TUNEL);
});

test('tunnel=building_passage NO es un tunel: es un soportal, y va a RASANTE', () => {
  // Medido en el slice: de los 81 `tunnel`, CINCUENTA Y TRES son
  // `building_passage`. No van bajo tierra, son calles que pasan por debajo de
  // un edificio — los soportales de Ciudad Vieja. Tratarlos como tunel borraria
  // cincuenta y tres calles perfectamente conducibles del casco viejo.
  assert.equal(estructuraDeVia({ tunnel: 'building_passage' }), Estructura.RASANTE);
});

test('covered=yes tampoco es un tunel', () => {
  // Estar techado no es estar enterrado.
  assert.equal(estructuraDeVia({ covered: 'yes' }), Estructura.RASANTE);
});

test('tunnel=no NO es un tunel', () => {
  assert.equal(estructuraDeVia({ tunnel: 'no' }), Estructura.RASANTE);
});

// --- Sin nada

test('una calle sin etiquetas de estructura va a rasante', () => {
  assert.equal(estructuraDeVia({}), Estructura.RASANTE);
  assert.equal(estructuraDeVia({ highway: 'residential' }), Estructura.RASANTE);
});

test('si viniera puente y tunel a la vez, manda el puente', () => {
  // En el slice no pasa ni una vez, pero es un etiquetado posible y hay que
  // decidir algo estable. Gana el puente porque un puente mal puesto se ve al
  // instante y un tunel mal puesto solo se nota al entrar en el.
  assert.equal(estructuraDeVia({ bridge: 'yes', tunnel: 'yes' }), Estructura.PUENTE);
});

// --- Nivel

test('el nivel sale de `layer` y admite negativos', () => {
  assert.equal(nivelDeVia({ layer: '1' }), 1);
  assert.equal(nivelDeVia({ layer: '-1' }), -1);
  assert.equal(nivelDeVia({ layer: '5' }), 5);
});

test('sin `layer` el nivel es cero', () => {
  assert.equal(nivelDeVia({}), 0);
});

test('un `layer` que no sea un entero se ignora en vez de reventar la celda', () => {
  // OSM esta lleno de gente, y la gente escribe cosas.
  for (const basura of ['', 'planta baja', '1.5', '+', 'NaN']) {
    assert.equal(nivelDeVia({ layer: basura }), 0, JSON.stringify(basura));
  }
});

test('un `layer` disparatado se recorta al tope del dominio', () => {
  // El maximo real medido es 5. Un layer de tres cifras es un error, y dejarlo
  // pasar haria que `crearTramo` rechazara el tramo entero.
  assert.equal(nivelDeVia({ layer: '999' }), 10);
  assert.equal(nivelDeVia({ layer: '-999' }), -10);
});

test('`layer=+1` se lee como 1: el signo mas es legal en OSM', () => {
  assert.equal(nivelDeVia({ layer: '+1' }), 1);
});
