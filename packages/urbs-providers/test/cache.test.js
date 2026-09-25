import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crearArea } from 'urbs-core';

import { construirConsulta, USER_AGENT, URL_OVERPASS_POR_DEFECTO } from '../src/osm/consulta.js';
import { crearCacheOsm, RespuestaOverpassError } from '../src/osm/cache.js';

const AREA = crearArea({ lonMin: -8.42, latMin: 43.36, lonMax: -8.39, latMax: 43.38 });
const OTRA_AREA = crearArea({ lonMin: -8.5, latMin: 43.3, lonMax: -8.45, latMax: 43.32 });

const RESPUESTA = {
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-09-24T21:14:33Z' },
  elements: [],
};

/** Sustituto de `fetch` con memoria de llamadas. Ningun test toca la red. */
function fetcherFalso({ cuerpo = JSON.stringify(RESPUESTA), estado = 200, tipo = 'application/json' } = {}) {
  const llamadas = [];
  const fetcher = async (url, opciones) => {
    llamadas.push({ url, opciones });
    return {
      ok: estado >= 200 && estado < 300,
      status: estado,
      statusText: `estado ${estado}`,
      headers: { get: (nombre) => (nombre.toLowerCase() === 'content-type' ? tipo : null) },
      text: async () => cuerpo,
    };
  };
  fetcher.llamadas = llamadas;
  return fetcher;
}

async function conDirectorioTemporal(cuerpo) {
  const directorio = await mkdtemp(join(tmpdir(), 'urbs-cache-'));
  try {
    return await cuerpo(directorio);
  } finally {
    await rm(directorio, { recursive: true, force: true });
  }
}

test('la consulta pide edificios, multipoligonos y viario con geometria resuelta', () => {
  const consulta = construirConsulta(AREA);

  assert.match(consulta, /\[out:json\]/);
  // Overpass ordena la bbox sur, oeste, norte, este. Invertirlo descarga otro sitio.
  assert.match(consulta, /43\.36,-8\.42,43\.38,-8\.39/);
  assert.match(consulta, /way\["building"\]/);
  assert.match(consulta, /relation\["building"\]\["type"="multipolygon"\]/);
  assert.match(consulta, /way\["highway"\]/);
  // `out geom` resuelve los nodos en el servidor: sin esto hay que hacer dos pasadas.
  assert.match(consulta, /out geom;/);
});

test('el timeout de la consulta es configurable', () => {
  assert.match(construirConsulta(AREA, { timeoutSegundos: 90 }), /\[timeout:90\]/);
});

test('la primera llamada descarga y deja la respuesta en disco', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const fetcher = fetcherFalso();
    const cache = crearCacheOsm({ directorio, fetcher });

    const resultado = await cache.obtener(AREA);

    assert.equal(fetcher.llamadas.length, 1);
    assert.equal(resultado.desdeCache, false);
    assert.deepEqual(resultado.datos, RESPUESTA);

    const enDisco = JSON.parse(await readFile(cache.rutas(AREA).datos, 'utf8'));
    assert.deepEqual(enDisco, RESPUESTA);
  });
});

test('la segunda llamada no vuelve a la red', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const fetcher = fetcherFalso();
    const cache = crearCacheOsm({ directorio, fetcher });

    await cache.obtener(AREA);
    const segunda = await cache.obtener(AREA);

    assert.equal(fetcher.llamadas.length, 1);
    assert.equal(segunda.desdeCache, true);
    assert.deepEqual(segunda.datos, RESPUESTA);
  });
});

test('una cache de otro bbox no se reutiliza', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const fetcher = fetcherFalso();
    const cache = crearCacheOsm({ directorio, fetcher });

    await cache.obtener(AREA);
    await cache.obtener(OTRA_AREA);

    assert.equal(fetcher.llamadas.length, 2);
    assert.notEqual(cache.rutas(AREA).datos, cache.rutas(OTRA_AREA).datos);
  });
});

test('la ruta de cache es estable entre ejecuciones', () => {
  const primera = crearCacheOsm({ directorio: '/tmp/x', fetcher: fetcherFalso() }).rutas(AREA);
  const segunda = crearCacheOsm({ directorio: '/tmp/x', fetcher: fetcherFalso() }).rutas(AREA);

  assert.equal(primera.datos, segunda.datos);
  assert.equal(primera.meta, segunda.meta);
});

test('solo se vuelve a descargar cuando se pide explicitamente', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const fetcher = fetcherFalso();
    const cache = crearCacheOsm({ directorio, fetcher });

    await cache.obtener(AREA);
    const refrescada = await cache.obtener(AREA, { refrescar: true });

    assert.equal(fetcher.llamadas.length, 2);
    assert.equal(refrescada.desdeCache, false);
  });
});

test('el sidecar deja constancia del bbox, la consulta y la fecha de los datos', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cache = crearCacheOsm({
      directorio,
      fetcher: fetcherFalso(),
      ahora: () => new Date('2026-09-25T10:00:00Z'),
    });

    const resultado = await cache.obtener(AREA);

    const meta = JSON.parse(await readFile(cache.rutas(AREA).meta, 'utf8'));
    assert.deepEqual(meta.bbox, {
      lonMin: AREA.lonMin,
      latMin: AREA.latMin,
      lonMax: AREA.lonMax,
      latMax: AREA.latMax,
    });
    assert.equal(meta.consulta, construirConsulta(AREA));
    // La fecha del corte de datos de OSM, no la de la descarga: es lo que dice
    // si la ciudad generada esta al dia.
    assert.equal(meta.timestamp_osm_base, '2026-09-24T21:14:33Z');
    assert.equal(meta.descargadoEn, '2026-09-25T10:00:00.000Z');
    assert.equal(meta.url, URL_OVERPASS_POR_DEFECTO);
    assert.ok(meta.bytes > 0);
    assert.equal(resultado.meta.timestamp_osm_base, '2026-09-24T21:14:33Z');
  });
});

test('el sidecar viaja con la lectura de cache, no solo con la descarga', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cache = crearCacheOsm({ directorio, fetcher: fetcherFalso() });

    await cache.obtener(AREA);
    const segunda = await cache.obtener(AREA);

    assert.equal(segunda.meta.timestamp_osm_base, '2026-09-24T21:14:33Z');
    assert.deepEqual(segunda.meta.bbox.lonMin, AREA.lonMin);
  });
});

test('se envia un User-Agent real: sin el, Overpass responde 406', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const fetcher = fetcherFalso();
    await crearCacheOsm({ directorio, fetcher }).obtener(AREA);

    const [{ url, opciones }] = fetcher.llamadas;
    assert.equal(url, URL_OVERPASS_POR_DEFECTO);
    assert.equal(opciones.method, 'POST');
    assert.equal(opciones.headers['User-Agent'], USER_AGENT);
    assert.ok(USER_AGENT.length > 0);
    assert.match(opciones.body, /out geom;/);
  });
});

test('un 406 se explica por lo que es, no como un fallo generico', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cache = crearCacheOsm({
      directorio,
      fetcher: fetcherFalso({ estado: 406, tipo: 'text/html', cuerpo: '<html>no</html>' }),
    });

    await assert.rejects(() => cache.obtener(AREA), (error) => {
      assert.ok(error instanceof RespuestaOverpassError);
      assert.equal(error.estado, 406);
      assert.match(error.message, /User-Agent/);
      return true;
    });
  });
});

test('un 429 se explica como limite de peticiones', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cache = crearCacheOsm({
      directorio,
      fetcher: fetcherFalso({ estado: 429, tipo: 'text/html', cuerpo: 'slot limit' }),
    });

    await assert.rejects(() => cache.obtener(AREA), /limite/i);
  });
});

test('una pagina de error XML no se parsea como si fuera JSON', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cuerpo = '<?xml version="1.0"?><osm-derived><remark>rate_limited</remark></osm-derived>';
    const cache = crearCacheOsm({
      directorio,
      fetcher: fetcherFalso({ estado: 200, tipo: 'application/osm3s+xml', cuerpo }),
    });

    await assert.rejects(() => cache.obtener(AREA), (error) => {
      assert.ok(error instanceof RespuestaOverpassError);
      assert.match(error.message, /content-type/i);
      return true;
    });
  });
});

test('una respuesta invalida no deja cache envenenada', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cache = crearCacheOsm({
      directorio,
      fetcher: fetcherFalso({ estado: 200, tipo: 'text/html', cuerpo: 'error' }),
    });

    await assert.rejects(() => cache.obtener(AREA));
    await assert.rejects(() => readFile(cache.rutas(AREA).datos, 'utf8'), /ENOENT/);
  });
});

test('un JSON sin elements se rechaza antes de llegar al dominio', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const cache = crearCacheOsm({
      directorio,
      fetcher: fetcherFalso({ cuerpo: '{"remark":"runtime error: Query timed out"}' }),
    });

    await assert.rejects(() => cache.obtener(AREA), /elements|remark/i);
  });
});

test('una cache corrupta se denuncia en vez de redescargarse a escondidas', async () => {
  await conDirectorioTemporal(async (directorio) => {
    const fetcher = fetcherFalso();
    const cache = crearCacheOsm({ directorio, fetcher });
    const rutas = cache.rutas(AREA);

    await mkdir(directorio, { recursive: true });
    await writeFile(rutas.datos, 'esto no es json', 'utf8');

    await assert.rejects(() => cache.obtener(AREA), (error) => {
      assert.match(error.message, /refrescar/);
      return true;
    });
    assert.equal(fetcher.llamadas.length, 0);
  });
});

test('sin fetcher no se finge: se falla al crear la cache', () => {
  assert.throws(() => crearCacheOsm({ directorio: '/tmp/x', fetcher: 'no' }), /fetcher/);
});
