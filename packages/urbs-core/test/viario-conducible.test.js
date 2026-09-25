import test from 'node:test';
import assert from 'node:assert/strict';

import { TipoVia, esTipoConducible } from '../src/dominio/viario.js';

test('una calle residencial admite trafico rodado', () => {
  assert.equal(esTipoConducible(TipoVia.RESIDENCIAL), true);
});

test('una peatonal NO admite trafico rodado', () => {
  assert.equal(esTipoConducible(TipoVia.PEATONAL), false);
});

test('un tipo desconocido no se conduce: ante la duda, acera', () => {
  // Conducir por lo desconocido pone el coche en un sitio del que no se sabe
  // nada; pintarlo de acera solo lo pone feo.
  assert.equal(esTipoConducible('supermercado'), false);
  assert.equal(esTipoConducible(undefined), false);
  assert.equal(esTipoConducible(null), false);
});

test('TODOS los tipos del dominio tienen respuesta, no solo los que recuerdo', () => {
  // Si manana entra un TipoVia nuevo y nadie decide si se conduce, este test
  // lo caza el mismo dia en vez de dejarlo colandose por el lado que toque.
  for (const tipo of Object.values(TipoVia)) {
    assert.equal(typeof esTipoConducible(tipo), 'boolean', `nadie decidio sobre ${tipo}`);
  }
});

test('el predicado del dominio y el de OSM son LA MISMA FUNCION', async () => {
  // Esta es la razon de ser del test. El predicado existia en urbs-providers,
  // exportado y probado, y no lo llamaba nadie fuera de sus propios tests: el
  // render pintaba 241 km de acera con el mismo asfalto que una autopista
  // porque el visor no importa urbs-providers. Dos reglas que hoy coinciden
  // acaban divergiendo; una sola funcion no puede.
  const proveedores = await import('urbs-providers');
  assert.equal(proveedores.esTipoConducible, esTipoConducible);
});
