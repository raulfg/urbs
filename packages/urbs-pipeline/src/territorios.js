/**
 * Territorios declarados en disco.
 *
 * Un territorio es lo unico especifico de un lugar que hay en todo el motor,
 * asi que tiene que poder escribirse sin tocar codigo: un JSON que se versiona
 * y que cualquiera puede leer, copiar y cambiar para generar otra ciudad.
 *
 * Esta pieza es la aduana entre ese JSON —que puede traer cualquier cosa— y
 * `crearTerritorio`, que espera un objeto bien formado. Las erratas se cazan
 * aqui, citando el campo, y no tres pantallas mas abajo con un `undefined`.
 */

import { readFile } from 'node:fs/promises';

import { crearArea, crearTerritorio } from 'urbs-core';

/**
 * Claves admitidas en una definicion. Es una lista cerrada a proposito: si
 * `ladoCelda` pasara en silencio por ser desconocida, el territorio se
 * generaria con el lado por defecto y nadie se enteraria hasta ver el mapa.
 */
const CLAVES_ADMITIDAS = Object.freeze([
  'id',
  'nombre',
  'area',
  'epsg',
  'ladoCeldaMetros',
  'notas',
  'relieve',
  'umbralAguaMetros',
]);

/** Las cuatro esquinas que define un area, en grados. */
const CLAVES_AREA = Object.freeze(['lonMin', 'latMin', 'lonMax', 'latMax']);

/**
 * @typedef {Object} DefinicionTerritorio
 * @property {string} id
 * @property {string} nombre
 * @property {{lonMin: number, latMin: number, lonMax: number, latMax: number}} area
 * @property {number} [epsg]
 * @property {number} [ladoCeldaMetros]
 * @property {string} [notas]  Solo para quien lea el archivo; no viaja al dominio
 */

/**
 * @param {unknown} definicion
 * @returns {void}
 */
function exigirClavesConocidas(definicion) {
  const desconocidas = Object.keys(/** @type {object} */ (definicion)).filter(
    (clave) => !CLAVES_ADMITIDAS.includes(clave),
  );
  if (desconocidas.length > 0) {
    throw new TypeError(
      `territorioDesdeDefinicion: clave${desconocidas.length > 1 ? 's' : ''} desconocida${
        desconocidas.length > 1 ? 's' : ''
      } ${desconocidas.map((clave) => `\`${clave}\``).join(', ')}. ` +
        `Las admitidas son: ${CLAVES_ADMITIDAS.join(', ')}.`,
    );
  }
}

/**
 * @param {unknown} area
 * @returns {import('urbs-core').Area}
 */
function areaDesdeDefinicion(area) {
  if (area === null || typeof area !== 'object' || Array.isArray(area)) {
    throw new TypeError(
      'territorioDesdeDefinicion: falta `area`. Debe ser un objeto ' +
        '{lonMin, latMin, lonMax, latMax} en grados WGS84.',
    );
  }

  for (const clave of CLAVES_AREA) {
    const valor = /** @type {any} */ (area)[clave];
    if (!Number.isFinite(valor)) {
      throw new TypeError(
        `territorioDesdeDefinicion: \`area.${clave}\` debe ser un numero en grados, no ${JSON.stringify(valor)}`,
      );
    }
  }

  return crearArea(/** @type {any} */ (area));
}

/**
 * Convierte una definicion plana —lo que sale de un JSON— en un territorio.
 *
 * @param {DefinicionTerritorio} definicion
 * @returns {import('urbs-core').Territorio}
 */
export function territorioDesdeDefinicion(definicion) {
  if (definicion === null || typeof definicion !== 'object' || Array.isArray(definicion)) {
    throw new TypeError(
      'territorioDesdeDefinicion: se esperaba una definicion de territorio ' +
        `({id, nombre, area, ...}), no ${Array.isArray(definicion) ? 'una lista' : typeof definicion}`,
    );
  }

  exigirClavesConocidas(definicion);

  const { id, nombre, epsg, ladoCeldaMetros } = definicion;

  return crearTerritorio({
    id,
    nombre,
    area: areaDesdeDefinicion(definicion.area),
    ...(epsg === undefined ? {} : { epsg }),
    ...(ladoCeldaMetros === undefined ? {} : { ladoCeldaMetros }),
  });
}

/**
 * Lee una definicion de territorio de disco y la convierte en territorio.
 *
 * @param {string} ruta
 * @returns {Promise<import('urbs-core').Territorio>}
 */
/**
 * Las hojas de relieve que declara un territorio, si declara alguna.
 *
 * Va aparte del dominio a proposito: `Territorio` describe QUE area se genera,
 * no DE DONDE sale cada capa. Poner identificadores del Centro de Descargas del
 * CNIG dentro del dominio ataria el motor a Espana.
 *
 * @param {object} definicion
 * @returns {{hojas: Array<{id: number|string, nombre: string}>, pasoMallaMetros?: number}|null}
 */
/**
 * A que cota deja de haber agua en ESTE territorio, si lo declara.
 *
 * Es saber LOCAL y por eso vive en el territorio y no en el dominio: depende de
 * la altura de los muelles, de la marea y de si el sitio es un delta o un
 * polder. Un numero afinado contra A Coruna ahogaria Rotterdam.
 *
 * @param {object} definicion
 * @returns {number|null}
 */
export function umbralAguaDeDefinicion(definicion) {
  const umbral = definicion?.umbralAguaMetros;
  if (umbral === undefined || umbral === null) {
    return null;
  }
  if (!Number.isFinite(umbral)) {
    throw new TypeError(
      `territorios: \`umbralAguaMetros\` debe ser un numero de metros, y es ${umbral}`,
    );
  }
  return umbral;
}

export function relieveDeDefinicion(definicion) {
  const relieve = definicion?.relieve;
  if (relieve === undefined || relieve === null) {
    return null;
  }
  if (!Array.isArray(relieve.hojas) || relieve.hojas.length === 0) {
    throw new TypeError(
      'territorios: `relieve` tiene que traer al menos una hoja en `hojas`, cada una con {id, nombre}',
    );
  }
  for (const hoja of relieve.hojas) {
    if (hoja?.id === undefined || typeof hoja?.nombre !== 'string') {
      throw new TypeError(
        `territorios: cada hoja de relieve necesita {id, nombre}; llego ${JSON.stringify(hoja)}`,
      );
    }
  }
  return relieve;
}

/**
 * Lee la definicion cruda de un territorio, sin pasarla por el dominio.
 *
 * @param {string} ruta
 * @returns {Promise<object>}
 */
export async function leerDefinicion(ruta) {
  const texto = await readFile(ruta, 'utf8');
  try {
    return JSON.parse(texto);
  } catch (causa) {
    throw new SyntaxError(`leerDefinicion: "${ruta}" no es JSON valido: ${causa.message}`);
  }
}

export async function cargarDefinicion(ruta) {
  const texto = await readFile(ruta, 'utf8');

  let definicion;
  try {
    definicion = JSON.parse(texto);
  } catch (causa) {
    throw new SyntaxError(`cargarDefinicion: "${ruta}" no es JSON valido: ${causa.message}`);
  }

  try {
    return territorioDesdeDefinicion(definicion);
  } catch (causa) {
    causa.message = `${causa.message} (definido en "${ruta}")`;
    throw causa;
  }
}
