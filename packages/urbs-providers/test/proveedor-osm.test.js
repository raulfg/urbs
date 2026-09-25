import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  Capa,
  TipoVia,
  crearArea,
  crearRegistro,
  validarProveedor,
} from 'urbs-core';

import {
  crearProveedoresOsm,
  ATRIBUCION_OSM,
  ID_PROVEEDOR_EDIFICIOS,
  ID_PROVEEDOR_VIARIO,
  PRIORIDAD_OSM,
} from '../src/osm/proveedor.js';

const MUESTRA = readFileSync(new URL('./fixtures/overpass-muestra.json', import.meta.url), 'utf8');

const CORUNA = crearArea({ lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 });
const BERLIN = crearArea({ lonMin: 13.38, latMin: 52.51, lonMax: 13.41, latMax: 52.53 });
const MUNDO = crearArea({ lonMin: -180, latMin: -90, lonMax: 180, latMax: 90 });

function fetcherFalso() {
  const llamadas = [];
  const fetcher = async (url, opciones) => {
    llamadas.push({ url, opciones });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      text: async () => MUESTRA,
    };
  };
  fetcher.llamadas = llamadas;
  return fetcher;
}

async function conProveedores(opciones, cuerpo) {
  const directorio = await mkdtemp(join(tmpdir(), 'urbs-prov-'));
  const fetcher = fetcherFalso();
  const incidencias = [];
  try {
    const proveedores = crearProveedoresOsm({
      directorio,
      fetcher,
      registrarIncidencias: (registro) => incidencias.push(registro),
      ...opciones,
    });
    return await cuerpo({ ...proveedores, fetcher, incidencias });
  } finally {
    await rm(directorio, { recursive: true, force: true });
  }
}

test('el paquete se puede consumir por su entrada publica', async () => {
  const paquete = await import('urbs-providers');

  assert.equal(typeof paquete.crearProveedoresOsm, 'function');
  assert.equal(typeof paquete.transformarEdificios, 'function');
  assert.equal(typeof paquete.crearCacheOsm, 'function');
  assert.equal(typeof paquete.construirConsulta, 'function');
  assert.equal(typeof paquete.esTipoConducible, 'function');
  assert.deepEqual(paquete.ATRIBUCION_OSM, ATRIBUCION_OSM);
});

test('los dos proveedores cumplen el contrato del core sin tocarlo', async () => {
  await conProveedores({}, ({ edificios, viario }) => {
    assert.equal(validarProveedor(edificios), edificios);
    assert.equal(validarProveedor(viario), viario);

    assert.equal(edificios.capa, Capa.EDIFICIOS);
    assert.equal(viario.capa, Capa.VIARIO);
    assert.equal(edificios.id, ID_PROVEEDOR_EDIFICIOS);
    assert.equal(viario.id, ID_PROVEEDOR_VIARIO);
    assert.notEqual(edificios.id, viario.id);
  });
});

test('OSM cubre cualquier punto del planeta: es el fallback global', async () => {
  await conProveedores({}, ({ edificios, viario }) => {
    for (const area of [CORUNA, BERLIN, MUNDO]) {
      assert.equal(edificios.cubre(area), true);
      assert.equal(viario.cubre(area), true);
    }
  });
});

test('la atribucion cita a los colaboradores de OpenStreetMap bajo ODbL', async () => {
  await conProveedores({}, ({ edificios, viario }) => {
    const atribucion = edificios.atribucion();

    assert.equal(atribucion.fuente, 'OpenStreetMap');
    assert.match(atribucion.licencia, /ODbL/);
    assert.match(atribucion.texto, /colaboradores de OpenStreetMap/);
    assert.match(atribucion.url, /openstreetmap\.org\/copyright/);
    // Las dos capas citan lo mismo, asi que creditos las agrupa en una linea.
    assert.deepEqual(viario.atribucion(), atribucion);
    assert.deepEqual(atribucion, ATRIBUCION_OSM);
  });
});

test('el registro del core sirve las dos capas sin adaptador', async () => {
  await conProveedores({}, async ({ edificios, viario }) => {
    const registro = crearRegistro();
    registro.registrar(edificios);
    registro.registrar(viario);

    assert.deepEqual(registro.diagnostico(BERLIN), {
      edificios: ID_PROVEEDOR_EDIFICIOS,
      viario: ID_PROVEEDOR_VIARIO,
      relieve: null,
      suelo: null,
    });

    const resultado = await registro.obtener(Capa.EDIFICIOS, CORUNA);
    assert.ok(Array.isArray(resultado));
    assert.ok(resultado.length > 0);
    assert.equal(resultado[0].procedencia.proveedor, ID_PROVEEDOR_EDIFICIOS);
  });
});

test('la prioridad de OSM deja paso a una fuente local mas rica', async () => {
  await conProveedores({}, ({ edificios }) => {
    const registro = crearRegistro();
    registro.registrar(edificios);
    registro.registrar({
      id: 'catastro-falso',
      capa: Capa.EDIFICIOS,
      prioridad: PRIORIDAD_OSM + 1,
      cubre: (area) => area.lonMin > -9.5 && area.lonMax < 3.4,
      atribucion: () => ({ fuente: 'x', licencia: 'x', texto: 'x' }),
      obtenerEdificios: async () => [],
    });

    assert.equal(registro.resolver(Capa.EDIFICIOS, CORUNA).id, 'catastro-falso');
    assert.equal(registro.resolver(Capa.EDIFICIOS, BERLIN).id, ID_PROVEEDOR_EDIFICIOS);
  });
});

test('obtenerEdificios devuelve el dominio ya construido', async () => {
  await conProveedores({}, async ({ edificios }) => {
    const resultado = await edificios.obtenerEdificios(CORUNA);

    const manzana = resultado.find((edificio) => edificio.id === 'relation/100');
    assert.ok(manzana, 'la manzana con patio debe llegar hasta el proveedor');
    assert.equal(manzana.huella.length, 2);
  });
});

test('obtenerViario conserva las peatonales por defecto', async () => {
  await conProveedores({}, async ({ viario }) => {
    const tramos = await viario.obtenerViario(CORUNA);

    assert.ok(tramos.some((tramo) => tramo.tipo === TipoVia.PEATONAL));
  });
});

test('soloConducibles recorta el grafo del trafico sin perder el resto de capas', async () => {
  await conProveedores({ soloConducibles: true }, async ({ viario }) => {
    const tramos = await viario.obtenerViario(CORUNA);

    assert.equal(tramos.some((tramo) => tramo.tipo === TipoVia.PEATONAL), false);
    assert.ok(tramos.length > 0);
  });
});

test('las dos capas comparten una sola descarga', async () => {
  await conProveedores({}, async ({ edificios, viario, fetcher }) => {
    await edificios.obtenerEdificios(CORUNA);
    await viario.obtenerViario(CORUNA);

    assert.equal(fetcher.llamadas.length, 1);
  });
});

test('las incidencias de calidad salen a la luz por el registrador inyectado', async () => {
  await conProveedores({}, async ({ edificios, incidencias }) => {
    await edificios.obtenerEdificios(CORUNA);

    assert.equal(incidencias.length, 1);
    const [informe] = incidencias;
    assert.equal(informe.capa, Capa.EDIFICIOS);
    assert.equal(informe.proveedor, ID_PROVEEDOR_EDIFICIOS);
    assert.ok(informe.incidencias.some((registro) => registro.id === 'way/2'));
    assert.ok(informe.incidencias.some((registro) => registro.id === 'way/5'));
  });
});

test('sin incidencias no se molesta a nadie', async () => {
  await conProveedores({}, async ({ viario, incidencias }) => {
    await viario.obtenerViario(CORUNA);
    // El fixture si tiene incidencias de viario, asi que aqui hay informe.
    assert.equal(incidencias.length, 1);
    assert.equal(incidencias[0].capa, Capa.VIARIO);
  });
});

test('refrescar es una decision del arranque, no del uso', async () => {
  const directorio = await mkdtemp(join(tmpdir(), 'urbs-prov-'));
  try {
    const fetcher = fetcherFalso();
    const primera = crearProveedoresOsm({ directorio, fetcher, registrarIncidencias: () => {} });
    await primera.edificios.obtenerEdificios(CORUNA);
    assert.equal(fetcher.llamadas.length, 1);

    // Una sesion nueva sobre el mismo directorio no vuelve a la red...
    const segunda = crearProveedoresOsm({ directorio, fetcher, registrarIncidencias: () => {} });
    await segunda.edificios.obtenerEdificios(CORUNA);
    assert.equal(fetcher.llamadas.length, 1);

    // ...salvo que se le pida explicitamente.
    const tercera = crearProveedoresOsm({
      directorio,
      fetcher,
      refrescar: true,
      registrarIncidencias: () => {},
    });
    await tercera.edificios.obtenerEdificios(CORUNA);
    assert.equal(fetcher.llamadas.length, 2);
  } finally {
    await rm(directorio, { recursive: true, force: true });
  }
});
