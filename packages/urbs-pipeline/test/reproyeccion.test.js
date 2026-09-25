import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { crearArea, crearTerritorio, epsgRecomendado, centro } from 'urbs-core';

import {
  FALSO_ESTE_UTM,
  nombreEpsg,
  definicionProj4,
  meridianoCentral,
  crearReproyector,
  crearReproyectorDeTerritorio,
} from '../src/reproyeccion.js';

// Ciudad Vieja, Pescaderia y Orzan: el vertical slice inicial.
const CORUNA = crearArea({ lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 });
const TERRITORIO = crearTerritorio({ id: 'coruna-centro', nombre: 'A Coruna centro', area: CORUNA });

test('el codigo EPSG se escribe como lo espera proj4', () => {
  assert.equal(nombreEpsg(25829), 'EPSG:25829');
});

test('la zona UTM sale del codigo EPSG, no de una constante del motor', () => {
  // ETRS89 / UTM 29N. El 29 se lee del codigo, no se cablea.
  assert.match(definicionProj4(25829), /\+proj=utm/);
  assert.match(definicionProj4(25829), /\+zone=29\b/);
  assert.match(definicionProj4(25829), /\+ellps=GRS80/);

  assert.match(definicionProj4(25830), /\+zone=30\b/);
});

test('fuera del ambito de ETRS89 se cae a UTM sobre WGS84', () => {
  assert.match(definicionProj4(32630), /\+zone=30\b/);
  assert.match(definicionProj4(32630), /\+datum=WGS84/);
  assert.doesNotMatch(definicionProj4(32630), /\+south/);
});

test('el hemisferio sur lleva su propio falso norte', () => {
  assert.match(definicionProj4(32733), /\+zone=33\b/);
  assert.match(definicionProj4(32733), /\+south/);
});

test('un EPSG que el pipeline no sabe construir se rechaza con un mensaje util', () => {
  assert.throws(() => definicionProj4(4326), (error) => {
    assert.ok(error instanceof RangeError);
    assert.match(error.message, /4326/);
    assert.match(error.message, /proyectado/);
    return true;
  });
  assert.throws(() => definicionProj4(99999), RangeError);
});

test('el meridiano central se deduce de la zona', () => {
  assert.equal(meridianoCentral(29), -9);
  assert.equal(meridianoCentral(30), -3);
  assert.equal(meridianoCentral(1), -177);
  assert.equal(meridianoCentral(60), 177);
});

test('sobre el meridiano central el este es exactamente el falso este', () => {
  // Verdad de terreno que no depende de ninguna tabla: por definicion de UTM,
  // el meridiano central de la zona 29 (-9 grados) se proyecta al falso este.
  const reproyector = crearReproyector(25829);
  const { este } = reproyector.aProyectado({ lon: -9, lat: 43.37 });

  assert.ok(
    Math.abs(este - FALSO_ESTE_UTM) < 1e-6,
    `esperaba ${FALSO_ESTE_UTM} sobre el meridiano central, recibido ${este}`,
  );
});

test('en el ecuador y sobre el meridiano central el norte es cero', () => {
  const { este, norte } = crearReproyector(32630).aProyectado({ lon: -3, lat: 0 });

  assert.ok(Math.abs(este - FALSO_ESTE_UTM) < 1e-6);
  assert.ok(Math.abs(norte) < 1e-6, `esperaba 0, recibido ${norte}`);
});

test('proyectar y volver devuelve el mismo punto geografico', () => {
  const reproyector = crearReproyector(25829);
  const punto = { lon: -8.4055, lat: 43.3713 };
  const vuelto = reproyector.aGeografico(reproyector.aProyectado(punto));

  assert.ok(Math.abs(vuelto.lon - punto.lon) < 1e-9, `lon: ${vuelto.lon}`);
  assert.ok(Math.abs(vuelto.lat - punto.lat) < 1e-9, `lat: ${vuelto.lat}`);
});

test('A Coruna aterriza donde tiene que aterrizar en la zona 29N', () => {
  const { este, norte } = crearReproyector(25829).aProyectado({ lon: -8.4055, lat: 43.3713 });

  assert.ok(este > 540000 && este < 555000, `este fuera de rango: ${este}`);
  assert.ok(norte > 4790000 && norte < 4810000, `norte fuera de rango: ${norte}`);
});

test('el reproyector de un territorio hereda su EPSG, nunca uno cableado', () => {
  const reproyector = crearReproyectorDeTerritorio(TERRITORIO);

  assert.equal(reproyector.epsg, TERRITORIO.epsg);
  assert.equal(reproyector.epsg, epsgRecomendado(centro(CORUNA)));
  assert.equal(reproyector.nombre, 'EPSG:25829');
});

test('otro territorio sale con otra proyeccion sin tocar una linea de codigo', () => {
  const berlin = crearTerritorio({
    id: 'berlin',
    nombre: 'Berlin',
    area: crearArea({ lonMin: 13.38, latMin: 52.51, lonMax: 13.41, latMax: 52.53 }),
  });
  const reproyector = crearReproyectorDeTerritorio(berlin);

  assert.equal(reproyector.epsg, 25833, 'ETRS89 / UTM 33N');
  assert.match(reproyector.definicion, /\+zone=33\b/);
});

test('el reproyector es inmutable', () => {
  assert.ok(Object.isFrozen(crearReproyector(25829)));
});

test('un punto no finito se rechaza antes de llegar a proj4', () => {
  const reproyector = crearReproyector(25829);

  assert.throws(() => reproyector.aProyectado({ lon: Number.NaN, lat: 43 }), TypeError);
  assert.throws(() => reproyector.aGeografico({ este: 1, norte: undefined }), TypeError);
});

test('proj4 no contamina urbs-core: el dominio sigue sin dependencias', () => {
  const core = JSON.parse(
    readFileSync(new URL('../../urbs-core/package.json', import.meta.url), 'utf8'),
  );

  assert.equal(core.dependencies, undefined);
  assert.equal(core.peerDependencies, undefined);
});
