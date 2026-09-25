/**
 * Descarga de hojas del MDT02 del Centro de Descargas del CNIG.
 *
 * El MDT02 (2 m, PNOA-LiDAR segunda cobertura, RMSE Z <= 25 cm) se publica por
 * HOJAS del MTN50 partidas en cuadrantes, y cada cuadrante pesa entre 60 y
 * 100 MB. Eso manda sobre todo el diseno: las hojas viven en `datos/crudos/`
 * detras de esta cache, no se versionan, y se bajan UNA vez.
 *
 * El flujo esta verificado contra el servicio, no deducido de documentacion:
 *
 *     POST /CentroDescargas/descargaDir   con   secDescDirLA=<id>
 *     -> 200 image/tiff
 *        Content-Disposition: attachment; filename=MDT02-ETRS89-HU29-0021-3-COB2.tif
 *
 * No hace falta registro, ni aceptar una licencia, ni una cookie de sesion.
 *
 * EL NOMBRE DEL CAMPO NO ES INTERCAMBIABLE. La pagina del CNIG usa `secuencial`
 * para la accion `descargaDirS3` y `secDescDirLA` para `descargaDir`; se ve en
 * su propio JavaScript (`descDir(idSec)` hace `$('#secDescDirLA').val(idSec)`).
 * Mandar el que no toca devuelve una pagina HTML con estado 200, asi que el
 * fallo no se nota hasta que alguien intenta abrir un TIFF que es un menu.
 * Por eso aqui se valida lo que llega antes de escribirlo en disco.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Centro de Descargas del CNIG. */
export const URL_CNIG_POR_DEFECTO = 'https://centrodedescargas.cnig.es/CentroDescargas';

/** Serie del modelo digital del terreno a 2 m. */
export const SERIE_MDT02 = 'MDT02';

/** Agrupacion bajo la que el CNIG cuelga los modelos digitales. */
export const AGRUPACION_MDT = 'MOMDT';

/**
 * Campo del formulario de descarga directa. Ver la nota de arriba: NO es
 * `secuencial`, que es el de la variante S3.
 */
export const CAMPO_DESCARGA = 'secDescDirLA';

/** Donde viven los crudos. El mismo sitio que los de OSM. */
export const DIRECTORIO_CRUDOS_POR_DEFECTO = 'datos/crudos';

/**
 * Nombre de una hoja, tal y como lo devuelve el servicio.
 *
 * @param {{huso: number, numHoja: number|string, cuadrante: number, cobertura?: number}} hoja
 * @returns {string}
 */
export function nombreDeHoja({ huso, numHoja, cuadrante, cobertura = 2 }) {
  // A cuatro digitos: para el CNIG la hoja 21 es la "0021".
  const numero = String(numHoja).padStart(4, '0');
  return `${SERIE_MDT02}-ETRS89-HU${huso}-${numero}-${cuadrante}-COB${cobertura}`;
}

/**
 * Si unos bytes empiezan por los magicos de un TIFF.
 *
 * Se admite el clasico (0x2A) y BigTIFF (0x2B): las hojas del MDT02 son
 * BigTIFF, que es justo lo que un lector improvisado no espera.
 *
 * @param {ArrayBuffer} bytes
 * @returns {boolean}
 */
function pareceTiff(bytes) {
  if (bytes.byteLength < 4) return false;
  const b = new Uint8Array(bytes, 0, 4);
  const little = b[0] === 0x49 && b[1] === 0x49;
  const big = b[0] === 0x4d && b[1] === 0x4d;
  if (!little && !big) return false;
  const version = little ? b[2] | (b[3] << 8) : (b[2] << 8) | b[3];
  return version === 42 || version === 43;
}

/**
 * Saca el nombre de fichero de una cabecera `Content-Disposition`.
 *
 * @param {string|null} cabecera
 * @returns {string|null}
 */
function nombreDeCabecera(cabecera) {
  if (typeof cabecera !== 'string') return null;
  const encontrado = cabecera.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return encontrado === null ? null : encontrado[1].trim();
}

/**
 * @typedef {Object} OpcionesDescargaCnig
 * @property {Function} fetcher       Inyectable: la cache se prueba sin red
 * @property {string} [directorio]
 * @property {string} [urlBase]
 */

/**
 * @param {OpcionesDescargaCnig} opciones
 */
export function crearDescargaCnig({
  fetcher,
  directorio = DIRECTORIO_CRUDOS_POR_DEFECTO,
  urlBase = URL_CNIG_POR_DEFECTO,
} = {}) {
  if (typeof fetcher !== 'function') {
    throw new TypeError(
      'crearDescargaCnig: `fetcher` debe ser una funcion compatible con fetch. ' +
        'Se inyecta para poder probar la cache sin bajar sesenta megas.',
    );
  }

  /**
   * Baja una hoja, o la reutiliza si ya esta.
   *
   * El `nombre` es opcional porque el servicio lo dice en la respuesta, pero
   * sin el no se puede saber si la hoja ya esta en disco SIN preguntarselo a la
   * red. Quien tenga el nombre —un territorio que declare sus hojas— se ahorra
   * la peticion entera.
   *
   * @param {{id: number|string, nombre?: string, refrescar?: boolean}} peticion
   * @returns {Promise<{ruta: string, nombre: string, bytes: number, desdeCache: boolean}>}
   */
  async function hoja({ id, nombre = null, refrescar = false }) {
    if (nombre !== null && !refrescar) {
      const ruta = join(directorio, `${nombre}.tif`);
      try {
        const info = await stat(ruta);
        return { ruta, nombre, bytes: info.size, desdeCache: true };
      } catch (causa) {
        if (causa.code !== 'ENOENT') throw causa;
      }
    }

    const url = `${urlBase}/descargaDir`;
    const respuesta = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'image/tiff',
        'user-agent': 'urbs (https://github.com/raulfg/urbs)',
      },
      body: new URLSearchParams({ [CAMPO_DESCARGA]: String(id) }).toString(),
    });

    if (!respuesta?.ok) {
      throw new Error(
        `El Centro de Descargas ha respondido ${respuesta?.status ?? '?'} al pedir la hoja ${id}. No se guarda nada.`,
      );
    }

    const tipo = respuesta.headers?.get?.('content-type') ?? '';
    if (/html/i.test(tipo)) {
      throw new Error(
        `Al pedir la hoja ${id} el servicio ha devuelto html y no un tiff. ` +
          `Suele significar que el campo de descarga no es el que espera: tiene que ser \`${CAMPO_DESCARGA}\`.`,
      );
    }

    const bytes = await respuesta.arrayBuffer();
    // Se valida ANTES de escribir. Un ".tif" de setecientos bytes que en
    // realidad es una pagina de error revienta muchisimo mas tarde y muy lejos.
    if (!pareceTiff(bytes)) {
      throw new Error(
        `Lo que ha llegado para la hoja ${id} no empieza por los magicos de un TIFF (${bytes.byteLength} bytes). No se guarda.`,
      );
    }

    const nombreFinal =
      nombre ?? (nombreDeCabecera(respuesta.headers?.get?.('content-disposition'))?.replace(/\.tif$/i, '') ?? String(id));
    const ruta = join(directorio, `${nombreFinal}.tif`);

    await mkdir(directorio, { recursive: true });
    await writeFile(ruta, Buffer.from(bytes));

    return { ruta, nombre: nombreFinal, bytes: bytes.byteLength, desdeCache: false };
  }

  return Object.freeze({ hoja, directorio });
}
