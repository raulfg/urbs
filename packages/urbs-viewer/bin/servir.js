#!/usr/bin/env node
/**
 * Servidor estatico para el visor.
 *
 *     npm run visor
 *
 * No hay empaquetador ni paso de compilacion: el navegador carga los mismos
 * archivos `.js` que lee Node, con un mapa de importaciones para los nombres
 * desnudos. Lo unico que hace falta es un servidor que sirva la raiz del repo
 * con los tipos MIME correctos, porque los modulos ESM no funcionan sobre
 * `file://` y las celdas se piden por `fetch`.
 *
 * Se escribe aqui, sin dependencias, en lugar de traer una: son sesenta lineas
 * de `node:http`, no hay que verificar la version de nada y funciona sin red.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Puerto por defecto. */
export const PUERTO_POR_DEFECTO = 4173;

/** Pagina que se abre al entrar en la raiz. */
const PAGINA_INICIAL = '/packages/urbs-viewer/publico/index.html';

/**
 * Tipos MIME que importan aqui. Un `.js` servido como `text/plain` hace que
 * el navegador rechace el modulo, y el error que da no menciona el MIME.
 */
const TIPOS = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.urbscell': 'application/octet-stream',
});

/**
 * Resuelve una ruta de peticion dentro de la raiz, o `null` si se sale.
 *
 * @param {string} raiz  Ruta absoluta
 * @param {string} ruta  Ruta de la peticion, ya sin query
 * @returns {string|null}
 */
export function resolverDentro(raiz, ruta) {
  let decodificada;
  try {
    decodificada = decodeURIComponent(ruta);
  } catch {
    return null;
  }

  // Se rechaza en vez de sanear. Normalizar un `..` lo hace desaparecer y la
  // peticion acaba sirviendo otro archivo en silencio; negarse deja un 403
  // que se lee en el registro y no esconde nada.
  if (decodificada.split(/[/\\]/).includes('..')) {
    return null;
  }

  const destino = resolve(join(raiz, normalize(decodificada)));
  return destino === raiz || destino.startsWith(raiz + sep) ? destino : null;
}

/**
 * @param {string} ruta
 * @returns {string}
 */
export function tipoDe(ruta) {
  return TIPOS[extname(ruta).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * @param {Object} [opciones]
 * @param {string} [opciones.raiz]
 * @param {number} [opciones.puerto]
 */
export function crearServidor({ raiz = process.cwd(), puerto = PUERTO_POR_DEFECTO } = {}) {
  const base = resolve(raiz);

  const servidor = createServer(async (peticion, respuesta) => {
    const ruta = new URL(peticion.url, 'http://localhost').pathname;
    if (ruta === '/') {
      respuesta.writeHead(302, { location: PAGINA_INICIAL });
      respuesta.end();
      return;
    }

    const destino = resolverDentro(base, ruta);
    if (destino === null) {
      respuesta.writeHead(403).end('Fuera de la raiz servida');
      return;
    }

    try {
      const info = await stat(destino);
      if (info.isDirectory()) {
        respuesta.writeHead(403).end('Aqui no se listan directorios');
        return;
      }
      respuesta.writeHead(200, {
        'content-type': tipoDe(destino),
        'content-length': info.size,
        'cache-control': 'no-cache',
      });
      createReadStream(destino).pipe(respuesta);
    } catch {
      respuesta.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      respuesta.end(`No existe ${ruta}`);
    }
  });

  return { servidor, puerto, raiz: base };
}

// Comparado con `pathToFileURL` y no interpolando la ruta a mano: una ruta con
// un espacio sale codificada en `import.meta.url` y no en `process.argv[1]`, y
// entonces esto no coincide nunca y el servidor no arranca sin decir por que.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      puerto: { type: 'string', default: String(PUERTO_POR_DEFECTO) },
      raiz: { type: 'string', default: process.cwd() },
    },
  });

  const { servidor, puerto, raiz } = crearServidor({
    raiz: values.raiz,
    puerto: Number(values.puerto),
  });

  servidor.listen(puerto, () => {
    console.log(`\nURBS sirviendo ${raiz}`);
    console.log(`  Visor: http://localhost:${puerto}${PAGINA_INICIAL}`);
    console.log('  Ctrl+C para parar.\n');
  });
}
