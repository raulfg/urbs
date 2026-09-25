import test from 'node:test';
import assert from 'node:assert/strict';

import { crearArea } from '../src/dominio/area.js';
import { Capa } from '../src/proveedores/contratos.js';
import { crearRegistro, SinCoberturaError } from '../src/proveedores/registro.js';

/** Area dentro de Espana: Ciudad Vieja, A Coruna. */
const CORUNA = crearArea({
  lonMin: -8.41,
  latMin: 43.365,
  lonMax: -8.39,
  latMax: 43.375,
});

/** Area fuera de Espana: centro de Berlin. */
const BERLIN = crearArea({
  lonMin: 13.38,
  latMin: 52.51,
  lonMax: 13.41,
  latMax: 52.53,
});

function proveedorEdificios({ id, prioridad, cubre }) {
  return {
    id,
    capa: Capa.EDIFICIOS,
    prioridad,
    cubre,
    atribucion: () => ({ fuente: id, licencia: 'test', texto: `(c) ${id}` }),
    obtenerEdificios: async () => [`edificios de ${id}`],
  };
}

const CATASTRO = proveedorEdificios({
  id: 'catastro',
  prioridad: 100,
  // Solo Espana peninsular, groseramente.
  cubre: (area) => area.lonMin > -9.5 && area.lonMax < 3.4 && area.latMin > 36,
});

const OSM = proveedorEdificios({
  id: 'osm',
  prioridad: 10,
  cubre: () => true,
});

test('la fuente de mayor prioridad gana cuando cubre el area', () => {
  const registro = crearRegistro();
  registro.registrar(OSM);
  registro.registrar(CATASTRO);

  assert.equal(registro.resolver(Capa.EDIFICIOS, CORUNA).id, 'catastro');
});

test('degrada al fallback global cuando la fuente rica no cubre', () => {
  const registro = crearRegistro();
  registro.registrar(OSM);
  registro.registrar(CATASTRO);

  assert.equal(registro.resolver(Capa.EDIFICIOS, BERLIN).id, 'osm');
});

test('el orden de registro no altera el resultado', () => {
  const registro = crearRegistro();
  registro.registrar(CATASTRO);
  registro.registrar(OSM);

  assert.equal(registro.resolver(Capa.EDIFICIOS, CORUNA).id, 'catastro');
  assert.equal(registro.resolver(Capa.EDIFICIOS, BERLIN).id, 'osm');
});

test('obtener delega en el proveedor resuelto', async () => {
  const registro = crearRegistro();
  registro.registrar(OSM);
  registro.registrar(CATASTRO);

  assert.deepEqual(await registro.obtener(Capa.EDIFICIOS, CORUNA), ['edificios de catastro']);
  assert.deepEqual(await registro.obtener(Capa.EDIFICIOS, BERLIN), ['edificios de osm']);
});

test('sin cobertura falla con un error tipado y accionable', async () => {
  const registro = crearRegistro();
  registro.registrar(CATASTRO);

  await assert.rejects(() => registro.obtener(Capa.EDIFICIOS, BERLIN), (error) => {
    assert.ok(error instanceof SinCoberturaError);
    assert.equal(error.capa, Capa.EDIFICIOS);
    assert.deepEqual(error.candidatos, ['catastro']);
    return true;
  });
});

test('solo se citan las atribuciones de las fuentes que se usan', () => {
  const registro = crearRegistro();
  registro.registrar(OSM);
  registro.registrar(CATASTRO);

  assert.deepEqual(
    registro.atribucionesPara(BERLIN).map((a) => a.fuente),
    ['osm'],
  );
  assert.deepEqual(
    registro.atribucionesPara(CORUNA).map((a) => a.fuente),
    ['catastro'],
  );
});

test('el diagnostico muestra la degradacion capa a capa', () => {
  const registro = crearRegistro();
  registro.registrar(OSM);
  registro.registrar(CATASTRO);

  assert.deepEqual(registro.diagnostico(BERLIN), {
    edificios: 'osm',
    viario: null,
    relieve: null,
    suelo: null,
  });
});

test('un proveedor sin `cubre` se rechaza al registrarlo, no al usarlo', () => {
  const registro = crearRegistro();

  assert.throws(
    () =>
      registro.registrar({
        id: 'roto',
        capa: Capa.EDIFICIOS,
        prioridad: 1,
        atribucion: () => ({ fuente: 'x', licencia: 'x', texto: 'x' }),
        obtenerEdificios: async () => [],
      }),
    /debe implementar `cubre\(area\)`/,
  );
});

test('un proveedor sin el metodo de su capa se rechaza al registrarlo', () => {
  const registro = crearRegistro();

  assert.throws(
    () =>
      registro.registrar({
        id: 'roto',
        capa: Capa.VIARIO,
        prioridad: 1,
        cubre: () => true,
        atribucion: () => ({ fuente: 'x', licencia: 'x', texto: 'x' }),
      }),
    /debe implementar `obtenerViario\(area\)`/,
  );
});

test('no se admiten dos proveedores con el mismo id', () => {
  const registro = crearRegistro();
  registro.registrar(OSM);

  assert.throws(() => registro.registrar(OSM), /ya existe un proveedor con id "osm"/);
});
