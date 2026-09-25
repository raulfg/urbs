import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGRUPACION_MDT,
  CAMPO_DESCARGA,
  SERIE_MDT02,
  URL_CNIG_POR_DEFECTO,
  crearDescargaCnig,
  nombreDeHoja,
} from '../src/pnoa/cnig.js';

/** Cabeceras al estilo de `fetch`. */
function cabeceras(mapa) {
  return { get: (n) => mapa[n.toLowerCase()] ?? null };
}

/**
 * Fetcher de mentira que apunta cada peticion con su cuerpo ya interpretado.
 */
function fetcherDe(respuestas) {
  const peticiones = [];
  const fetcher = async (url, opciones = {}) => {
    const cuerpo = typeof opciones.body === 'string' ? new URLSearchParams(opciones.body) : null;
    peticiones.push({
      url: String(url),
      metodo: opciones.method ?? 'GET',
      campos: cuerpo === null ? null : Object.fromEntries(cuerpo.entries()),
    });
    const siguiente = respuestas.shift();
    if (siguiente === undefined) throw new Error(`peticion inesperada a ${url}`);
    return siguiente;
  };
  fetcher.peticiones = peticiones;
  return fetcher;
}

function respuestaTif(bytes, { nombre = 'MDT02-ETRS89-HU29-0021-3-COB2.tif' } = {}) {
  return {
    ok: true,
    status: 200,
    headers: cabeceras({
      'content-type': 'image/tiff',
      'content-disposition': `attachment; filename=${nombre}`,
    }),
    arrayBuffer: async () => bytes,
  };
}

/** Un BigTIFF de mentira: solo hacen falta los bytes magicos. */
function bytesBigTiff() {
  return Uint8Array.from([0x49, 0x49, 0x2b, 0x00, 0x08, 0x00, 0x00, 0x00]).buffer;
}

async function directorioTemporal() {
  return mkdtemp(join(tmpdir(), 'urbs-cnig-'));
}

// --- Nombres de hoja

test('el nombre de una hoja se arma con serie, huso, numero y cobertura', () => {
  // Comprobado contra el Content-Disposition real del servicio.
  assert.equal(
    nombreDeHoja({ huso: 29, numHoja: '0021', cuadrante: 3 }),
    'MDT02-ETRS89-HU29-0021-3-COB2',
  );
});

test('el numero de hoja va a cuatro digitos: la 21 no es la 0021 para el CNIG', () => {
  assert.equal(nombreDeHoja({ huso: 29, numHoja: 21, cuadrante: 3 }), 'MDT02-ETRS89-HU29-0021-3-COB2');
});

// --- Descarga

test('descargar una hoja usa `secDescDirLA`, NO `secuencial`', async () => {
  // El campo importa y no es intercambiable: la pagina usa `secuencial` para
  // la accion `descargaDirS3` y `secDescDirLA` para `descargaDir`. Mandar el
  // que no es devuelve una pagina HTML con estado 200, asi que el fallo no se
  // nota hasta que alguien intenta abrir un TIFF que es en realidad un menu.
  const fetcher = fetcherDe([respuestaTif(bytesBigTiff())]);
  const descarga = crearDescargaCnig({ fetcher, directorio: await directorioTemporal() });

  await descarga.hoja({ id: 10323766 });

  const peticion = fetcher.peticiones.at(-1);
  assert.equal(peticion.metodo, 'POST');
  assert.ok(peticion.url.endsWith('/descargaDir'), peticion.url);
  assert.deepEqual(peticion.campos, { [CAMPO_DESCARGA]: '10323766' });
  assert.equal(CAMPO_DESCARGA, 'secDescDirLA');
});

test('la hoja descargada se guarda con el nombre que da el servicio', async () => {
  const directorio = await directorioTemporal();
  const descarga = crearDescargaCnig({
    fetcher: fetcherDe([respuestaTif(bytesBigTiff())]),
    directorio,
  });

  const { ruta } = await descarga.hoja({ id: 10323766 });

  assert.ok(ruta.endsWith('MDT02-ETRS89-HU29-0021-3-COB2.tif'), ruta);
  assert.deepEqual(await readdir(directorio), ['MDT02-ETRS89-HU29-0021-3-COB2.tif']);
  assert.equal((await readFile(ruta)).length, 8);
});

test('una hoja ya descargada NO se vuelve a bajar: son sesenta megas', async () => {
  const directorio = await directorioTemporal();
  const fetcher = fetcherDe([respuestaTif(bytesBigTiff())]);
  const descarga = crearDescargaCnig({ fetcher, directorio });

  await descarga.hoja({ id: 10323766 });
  const segunda = await descarga.hoja({ id: 10323766, nombre: 'MDT02-ETRS89-HU29-0021-3-COB2' });

  assert.equal(fetcher.peticiones.length, 1);
  assert.equal(segunda.desdeCache, true);
});

test('`refrescar` vuelve a bajarla, que para eso esta', async () => {
  const directorio = await directorioTemporal();
  const fetcher = fetcherDe([respuestaTif(bytesBigTiff()), respuestaTif(bytesBigTiff())]);
  const descarga = crearDescargaCnig({ fetcher, directorio });

  await descarga.hoja({ id: 10323766 });
  await descarga.hoja({ id: 10323766, refrescar: true });

  assert.equal(fetcher.peticiones.length, 2);
});

// --- Fallos

test('una respuesta HTML se rechaza en vez de guardarse como si fuera relieve', async () => {
  // Es lo que devuelve el servicio cuando el campo va mal: estado 200 y una
  // pagina. Guardarlo deja un ".tif" de 700 bytes que revienta mucho despues.
  const directorio = await directorioTemporal();
  const descarga = crearDescargaCnig({
    fetcher: fetcherDe([
      {
        ok: true,
        status: 200,
        headers: cabeceras({ 'content-type': 'text/html;charset=utf-8' }),
        arrayBuffer: async () => new TextEncoder().encode('<!doctype html>').buffer,
      },
    ]),
    directorio,
  });

  await assert.rejects(() => descarga.hoja({ id: 1 }), /html|tiff/i);
  assert.deepEqual(await readdir(directorio), []);
});

test('unos bytes que no empiecen por los magicos de TIFF se rechazan', async () => {
  const directorio = await directorioTemporal();
  const descarga = crearDescargaCnig({
    fetcher: fetcherDe([respuestaTif(new TextEncoder().encode('no soy un tif').buffer)]),
    directorio,
  });

  await assert.rejects(() => descarga.hoja({ id: 1 }), /TIFF/i);
  assert.deepEqual(await readdir(directorio), []);
});

test('un estado que no sea 200 se explica con su numero', async () => {
  const descarga = crearDescargaCnig({
    fetcher: fetcherDe([{ ok: false, status: 503, headers: cabeceras({}) }]),
    directorio: await directorioTemporal(),
  });

  await assert.rejects(() => descarga.hoja({ id: 1 }), /503/);
});

test('un fetcher que no lo sea se rechaza al crear', () => {
  assert.throws(() => crearDescargaCnig({ fetcher: null }), /fetcher/);
});

// --- Constantes verificadas contra el servicio

test('la serie y la agrupacion son las del MDT02 de segunda cobertura', () => {
  assert.equal(SERIE_MDT02, 'MDT02');
  assert.equal(AGRUPACION_MDT, 'MOMDT');
  assert.ok(URL_CNIG_POR_DEFECTO.startsWith('https://centrodedescargas.cnig.es/'));
});
