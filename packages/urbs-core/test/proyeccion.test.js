import test from 'node:test';
import assert from 'node:assert/strict';

import {
  zonaUtm,
  epsgUtmWgs84,
  epsgUtmEtrs89,
  epsgRecomendado,
} from '../src/dominio/proyeccion.js';

test('A Coruna cae en la zona UTM 29', () => {
  assert.equal(zonaUtm(-8.4), 29);
});

test('los limites del rango de longitud no se salen de las 60 zonas', () => {
  assert.equal(zonaUtm(-180), 1);
  assert.equal(zonaUtm(180), 60);
});

test('A Coruna usa ETRS89, el datum nativo de Catastro y PNOA', () => {
  assert.equal(epsgRecomendado({ lon: -8.4, lat: 43.37 }), 25829);
});

test('fuera del ambito de ETRS89 se degrada a UTM sobre WGS84', () => {
  // Tokio: la zona UTM existe, pero ETRS89 no la cubre.
  assert.equal(epsgUtmEtrs89({ lon: 139.7, lat: 35.7 }), null);
  assert.equal(epsgRecomendado({ lon: 139.7, lat: 35.7 }), 32654);
});

test('el hemisferio sur usa la familia EPSG 327xx', () => {
  // Buenos Aires.
  assert.equal(epsgUtmWgs84({ lon: -58.4, lat: -34.6 }), 32721);
});

test('una longitud invalida falla en vez de devolver una zona absurda', () => {
  assert.throws(() => zonaUtm(200), /fuera del rango/);
});
