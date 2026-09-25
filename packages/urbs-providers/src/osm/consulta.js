/**
 * Construccion de la consulta a Overpass.
 *
 * Esta separada de la descarga a proposito: el texto de la consulta se guarda
 * en el sidecar de la cache, asi que tiene que poder generarse y compararse
 * sin abrir un socket.
 */

/**
 * Endpoint por defecto.
 *
 * `overpass-api.de` responde el bbox de la ciudad vieja en ~3 s. El espejo
 * `overpass.kumi.systems` agoto los 240 s en la misma consulta, asi que no
 * hay rotacion automatica de espejos: cambiar de servidor es una decision
 * explicita de quien llama.
 */
export const URL_OVERPASS_POR_DEFECTO = 'https://overpass-api.de/api/interpreter';

/**
 * Overpass responde 406 Not Acceptable al User-Agent por defecto de curl y de
 * undici. Con uno real y localizable responde con normalidad.
 */
export const USER_AGENT = 'urbs/0.1 (+https://github.com/raulfg/urbs)';

/** Segundos que concedemos al servidor antes de que aborte la consulta. */
export const TIMEOUT_CONSULTA_POR_DEFECTO = 180;

/**
 * Formatea la bbox en el orden que espera Overpass: sur, oeste, norte, este.
 * Invertir el orden no da error, da otra ciudad.
 *
 * @param {import('urbs-core').Area} area
 * @returns {string}
 */
export function bboxOverpass(area) {
  return `${area.latMin},${area.lonMin},${area.latMax},${area.lonMax}`;
}

/**
 * Consulta que baja de una sola vez las dos capas que sirve este proveedor.
 *
 * Detalles que no son negociables:
 * - La clausula `relation["building"]["type"="multipolygon"]` es obligatoria:
 *   las manzanas con patio interior viven ahi y no en ningun way etiquetado.
 * - `out geom;` hace que el servidor resuelva la geometria. Sin eso hay que
 *   bajar los nodos aparte y reconstruirlos a mano en dos pasadas.
 *
 * @param {import('urbs-core').Area} area
 * @param {{timeoutSegundos?: number}} [opciones]
 * @returns {string}
 */
export function construirConsulta(area, { timeoutSegundos = TIMEOUT_CONSULTA_POR_DEFECTO } = {}) {
  if (!Number.isInteger(timeoutSegundos) || timeoutSegundos <= 0) {
    throw new RangeError('construirConsulta: `timeoutSegundos` debe ser un entero positivo');
  }

  const bbox = bboxOverpass(area);

  return [
    `[out:json][timeout:${timeoutSegundos}];`,
    '(',
    `  way["building"](${bbox});`,
    `  relation["building"]["type"="multipolygon"](${bbox});`,
    `  way["highway"](${bbox});`,
    ');',
    'out geom;',
    '',
  ].join('\n');
}
