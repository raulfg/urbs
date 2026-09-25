import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';

import { resolverDentro, tipoDe } from '../bin/servir.js';

const RAIZ = resolve('/tmp/urbs-raiz');

test('una ruta normal se resuelve dentro de la raiz', () => {
  assert.equal(resolverDentro(RAIZ, '/packages/urbs-core/index.js'), `${RAIZ}${sep}packages${sep}urbs-core${sep}index.js`);
});

test('la raiz misma es una ruta valida', () => {
  assert.equal(resolverDentro(RAIZ, '/'), RAIZ);
});

test('no se puede salir de la raiz con `..`, ni codificado', () => {
  for (const ataque of ['/../../etc/passwd', '/..%2f..%2fetc/passwd', '/packages/../../secreto']) {
    assert.equal(resolverDentro(RAIZ, ataque), null, `se ha escapado con ${ataque}`);
  }
});

test('un directorio con el mismo prefijo que la raiz no cuenta como dentro', () => {
  assert.equal(resolverDentro(RAIZ, '/../urbs-raiz-privada/clave'), null);
});

test('los tipos MIME que rompen los modulos ESM estan cubiertos', () => {
  assert.match(tipoDe('/x/visor.js'), /^text\/javascript/);
  assert.match(tipoDe('/x/indice.json'), /^application\/json/);
  assert.match(tipoDe('/x/index.HTML'), /^text\/html/);
});

test('una celda se sirve como binario, no como texto', () => {
  assert.equal(tipoDe('/datos/celdas/t/x1z2.urbscell'), 'application/octet-stream');
});

test('una extension desconocida cae a binario en vez de a texto', () => {
  assert.equal(tipoDe('/x/cosa.raruna'), 'application/octet-stream');
});
