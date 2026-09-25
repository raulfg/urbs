/**
 * Descarga de Overpass con cache en disco.
 *
 * La regla de oro es que la red se toca UNA vez por bbox y nunca por accidente.
 * El fichero de `datos/crudos/` es la entrada real del preprocesado: mientras
 * exista, el pipeline se ejecuta offline y reproducible. Volver a descargar es
 * una decision explicita (`refrescar`), nunca un efecto lateral de que algo
 * haya salido mal al leer.
 *
 * La descarga se inyecta (`fetcher`) por la misma razon: asi el comportamiento
 * de la cache se prueba entero, incluidos los 406 y las paginas de error XML,
 * sin que ningun test dependa de que Overpass este de buenas.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { construirConsulta, URL_OVERPASS_POR_DEFECTO, USER_AGENT } from './consulta.js';

/** Donde viven los crudos. Esta ruta esta en .gitignore: pesan y se rehacen. */
export const DIRECTORIO_CRUDOS_POR_DEFECTO = 'datos/crudos';

/** Decimales del nombre de fichero. Seis son ~11 cm: de sobra para un bbox. */
const DECIMALES_RUTA = 6;

/** Cuanto cuerpo de respuesta incluimos en el mensaje de error. */
const MUESTRA_ERROR = 200;

/**
 * Fallo de la respuesta de Overpass, con tipo propio para que quien llama
 * pueda distinguir "el servidor me ha dicho que no" de "el disco ha fallado".
 */
export class RespuestaOverpassError extends Error {
  /**
   * @param {string} mensaje
   * @param {{estado?: number|null, contentType?: string|null, muestra?: string}} detalle
   */
  constructor(mensaje, { estado = null, contentType = null, muestra = '' } = {}) {
    super(mensaje);
    this.name = 'RespuestaOverpassError';
    this.estado = estado;
    this.contentType = contentType;
    this.muestra = muestra;
  }
}

/** Nombre de fichero deterministico a partir del bbox. */
function baseDeArea(area) {
  const partes = [area.latMin, area.lonMin, area.latMax, area.lonMax].map((valor) =>
    valor.toFixed(DECIMALES_RUTA),
  );
  return `osm_${partes.join('_')}`;
}

/** Explica un estado HTTP en los terminos en los que Overpass falla de verdad. */
function explicarEstado(estado, statusText) {
  if (estado === 406) {
    return (
      'Overpass ha respondido 406 Not Acceptable. Casi siempre significa que falta ' +
      `un User-Agent identificable. URBS envia "${USER_AGENT}"; comprueba que el fetcher no lo pise.`
    );
  }
  if (estado === 429 || estado === 504) {
    return (
      `Overpass ha respondido ${estado}: limite de peticiones alcanzado. ` +
      'Solo hay 2 huecos simultaneos por IP. Espera y reintenta, o usa la cache existente.'
    );
  }
  return `Overpass ha respondido ${estado} ${statusText ?? ''}`.trim();
}

/** Valida y parsea el cuerpo de una respuesta antes de dejarlo tocar el disco. */
function parsearRespuesta(texto, { estado, contentType }) {
  const muestra = texto.slice(0, MUESTRA_ERROR);

  if (!String(contentType ?? '').includes('json')) {
    throw new RespuestaOverpassError(
      `Overpass ha respondido con content-type "${contentType ?? 'sin declarar'}" en vez de JSON. ` +
        'Cuando limita peticiones devuelve una pagina XML o HTML con estado 200, asi que el ' +
        `estado por si solo no vale. Primeros ${MUESTRA_ERROR} caracteres: ${muestra}`,
      { estado, contentType, muestra },
    );
  }

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (causa) {
    throw new RespuestaOverpassError(
      `La respuesta decia ser JSON pero no se puede parsear: ${causa.message}. Primeros ${MUESTRA_ERROR} caracteres: ${muestra}`,
      { estado, contentType, muestra },
    );
  }

  if (!Array.isArray(datos.elements)) {
    const remark = typeof datos.remark === 'string' ? ` Overpass dice: "${datos.remark}".` : '';
    throw new RespuestaOverpassError(
      `La respuesta JSON no trae un array \`elements\`.${remark} No se guarda en cache.`,
      { estado, contentType, muestra },
    );
  }

  return datos;
}

/**
 * @typedef {Object} MetaCache
 * @property {{lonMin: number, latMin: number, lonMax: number, latMax: number}} bbox
 * @property {string} consulta
 * @property {string} url
 * @property {string|null} timestamp_osm_base  Corte de datos de OSM, segun `osm3s`
 * @property {string} descargadoEn
 * @property {number} bytes
 */

/**
 * @typedef {Object} OpcionesCache
 * @property {string} [directorio]    Donde se guardan los crudos
 * @property {Function} fetcher       Sustituto de `fetch`; inyectado para poder probarlo
 * @property {string} [urlOverpass]
 * @property {number} [timeoutSegundos]
 * @property {() => Date} [ahora]     Reloj inyectable
 */

/**
 * Crea la cache de respuestas de Overpass para un directorio dado.
 *
 * @param {OpcionesCache} opciones
 */
export function crearCacheOsm({
  directorio = DIRECTORIO_CRUDOS_POR_DEFECTO,
  fetcher,
  urlOverpass = URL_OVERPASS_POR_DEFECTO,
  timeoutSegundos,
  ahora = () => new Date(),
} = {}) {
  if (typeof fetcher !== 'function') {
    throw new TypeError(
      'crearCacheOsm: `fetcher` debe ser una funcion compatible con fetch. ' +
        'Se inyecta para que la logica de cache se pueda probar sin red; pasa `globalThis.fetch` en produccion.',
    );
  }
  if (typeof directorio !== 'string' || directorio.length === 0) {
    throw new TypeError('crearCacheOsm: `directorio` debe ser una ruta no vacia');
  }

  /**
   * Rutas del par de ficheros de un area: los datos y su sidecar.
   * @param {import('urbs-core').Area} area
   * @returns {{datos: string, meta: string}}
   */
  function rutas(area) {
    const base = baseDeArea(area);
    return {
      datos: join(directorio, `${base}.json`),
      meta: join(directorio, `${base}.meta.json`),
    };
  }

  /** Lee el par cache+sidecar. Devuelve null solo si la cache no existe. */
  async function leerDeCache(area) {
    const { datos: rutaDatos, meta: rutaMeta } = rutas(area);

    let bruto;
    try {
      bruto = await readFile(rutaDatos, 'utf8');
    } catch (causa) {
      if (causa.code === 'ENOENT') return null;
      throw causa;
    }

    let datos;
    try {
      datos = JSON.parse(bruto);
    } catch (causa) {
      // Existe pero no sirve. Redescargar aqui a escondidas convertiria un
      // disco lleno en trafico silencioso contra Overpass.
      throw new RespuestaOverpassError(
        `La cache "${rutaDatos}" existe pero no es JSON valido (${causa.message}). ` +
          'Borrala o vuelve a ejecutar con `refrescar` para descargarla de nuevo.',
      );
    }

    let meta = null;
    try {
      meta = JSON.parse(await readFile(rutaMeta, 'utf8'));
    } catch (causa) {
      if (causa.code !== 'ENOENT') throw causa;
    }

    return { datos, meta };
  }

  /** Descarga, valida y persiste. No escribe nada si la respuesta no vale. */
  async function descargar(area) {
    const consulta = construirConsulta(area, timeoutSegundos ? { timeoutSegundos } : undefined);

    const respuesta = await fetcher(urlOverpass, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'text/plain;charset=UTF-8',
        Accept: 'application/json',
      },
      body: consulta,
    });

    const contentType = respuesta.headers?.get?.('content-type') ?? null;
    const texto = await respuesta.text();

    if (!respuesta.ok) {
      throw new RespuestaOverpassError(explicarEstado(respuesta.status, respuesta.statusText), {
        estado: respuesta.status,
        contentType,
        muestra: texto.slice(0, MUESTRA_ERROR),
      });
    }

    const datos = parsearRespuesta(texto, { estado: respuesta.status, contentType });

    /** @type {MetaCache} */
    const meta = {
      bbox: {
        lonMin: area.lonMin,
        latMin: area.latMin,
        lonMax: area.lonMax,
        latMax: area.latMax,
      },
      consulta,
      url: urlOverpass,
      timestamp_osm_base: datos.osm3s?.timestamp_osm_base ?? null,
      descargadoEn: ahora().toISOString(),
      bytes: Buffer.byteLength(texto, 'utf8'),
    };

    const { datos: rutaDatos, meta: rutaMeta } = rutas(area);
    await mkdir(directorio, { recursive: true });
    await writeFile(rutaDatos, texto, 'utf8');
    await writeFile(rutaMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    return { datos, meta };
  }

  /**
   * Devuelve la respuesta de Overpass para un area, de cache si la hay.
   *
   * @param {import('urbs-core').Area} area
   * @param {{refrescar?: boolean}} [opciones]
   * @returns {Promise<{datos: object, meta: MetaCache|null, desdeCache: boolean}>}
   */
  async function obtener(area, { refrescar = false } = {}) {
    if (!refrescar) {
      const enCache = await leerDeCache(area);
      if (enCache !== null) {
        return { ...enCache, desdeCache: true };
      }
    }

    const descargada = await descargar(area);
    return { ...descargada, desdeCache: false };
  }

  return Object.freeze({ obtener, rutas, directorio });
}
