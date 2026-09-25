import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LADO_CELDA_POR_DEFECTO } from 'urbs-core';

import { cargarDefinicion, territorioDesdeDefinicion } from '../src/territorios.js';

const DEFINICION = Object.freeze({
  id: 'marineda-casco-historico',
  nombre: 'Marineda - Ciudad Vieja, Pescaderia y Orzan',
  area: { lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 },
});

test('territorioDesdeDefinicion construye un territorio a partir de datos planos', () => {
  const territorio = territorioDesdeDefinicion(DEFINICION);

  assert.equal(territorio.id, 'marineda-casco-historico');
  assert.equal(territorio.nombre, DEFINICION.nombre);
  assert.deepEqual(territorio.area, DEFINICION.area);
  assert.equal(territorio.ladoCeldaMetros, LADO_CELDA_POR_DEFECTO);
});

test('el EPSG se deduce de la posicion del area cuando la definicion no lo fija', () => {
  // Zona UTM 29 del hemisferio norte sobre ETRS89: es lo que toca en Galicia,
  // y sale de la longitud, no de una constante escrita a mano.
  assert.equal(territorioDesdeDefinicion(DEFINICION).epsg, 25829);
});

test('una definicion puede imponer su EPSG', () => {
  const territorio = territorioDesdeDefinicion({ ...DEFINICION, epsg: 32629 });
  assert.equal(territorio.epsg, 32629);
});

test('el lado de celda de la definicion manda sobre el valor por defecto', () => {
  const territorio = territorioDesdeDefinicion({ ...DEFINICION, ladoCeldaMetros: 500 });
  assert.equal(territorio.ladoCeldaMetros, 500);
});

test('el territorio resultante es inmutable', () => {
  const territorio = territorioDesdeDefinicion(DEFINICION);
  assert.throws(() => {
    territorio.id = 'otro';
  }, TypeError);
});

test('una definicion que no es un objeto se rechaza nombrando el problema', () => {
  for (const basura of [null, 'marineda', 42, []]) {
    assert.throws(() => territorioDesdeDefinicion(basura), /definicion de territorio/i);
  }
});

test('falta el area: el error dice que campo falta y que forma tiene', () => {
  const { area, ...sinArea } = DEFINICION;
  assert.throws(() => territorioDesdeDefinicion(sinArea), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /area/);
    assert.match(error.message, /lonMin/);
    return true;
  });
});

test('un area con campos que no son numeros se rechaza antes de llegar a crearArea', () => {
  const definicion = { ...DEFINICION, area: { lonMin: '-8.42', latMin: 43.36, lonMax: -8.39, latMax: 43.38 } };
  assert.throws(() => territorioDesdeDefinicion(definicion), /lonMin/);
});

test('un area invertida se rechaza con el mensaje del dominio', () => {
  const definicion = { ...DEFINICION, area: { lonMin: -8.39, latMin: 43.36, lonMax: -8.42, latMax: 43.38 } };
  assert.throws(() => territorioDesdeDefinicion(definicion), RangeError);
});

test('campos desconocidos se rechazan: una errata en una clave no puede pasar en silencio', () => {
  const definicion = { ...DEFINICION, ladoCelda: 250 };
  assert.throws(() => territorioDesdeDefinicion(definicion), (error) => {
    assert.match(error.message, /ladoCelda/);
    assert.match(error.message, /ladoCeldaMetros/);
    return true;
  });
});

test('la clave `notas` se admite y no viaja al territorio', () => {
  const territorio = territorioDesdeDefinicion({ ...DEFINICION, notas: 'vertical slice' });
  assert.equal(territorio.notas, undefined);
});

test('cargarDefinicion lee un JSON de disco y lo convierte en territorio', async () => {
  const directorio = await mkdtemp(join(tmpdir(), 'urbs-territorio-'));
  try {
    const ruta = join(directorio, 'marineda.json');
    await writeFile(ruta, JSON.stringify(DEFINICION), 'utf8');

    const territorio = await cargarDefinicion(ruta);
    assert.equal(territorio.id, DEFINICION.id);
    assert.equal(territorio.epsg, 25829);
  } finally {
    await rm(directorio, { recursive: true, force: true });
  }
});

test('cargarDefinicion cita la ruta cuando el JSON esta roto', async () => {
  const directorio = await mkdtemp(join(tmpdir(), 'urbs-territorio-'));
  try {
    const ruta = join(directorio, 'roto.json');
    await writeFile(ruta, '{ esto no es json', 'utf8');

    await assert.rejects(cargarDefinicion(ruta), (error) => {
      assert.match(error.message, /roto\.json/);
      return true;
    });
  } finally {
    await rm(directorio, { recursive: true, force: true });
  }
});
