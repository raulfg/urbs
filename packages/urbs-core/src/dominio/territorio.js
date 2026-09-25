/**
 * Territorio: la descripcion completa de un trozo de mundo a generar.
 *
 * Es el unico sitio donde vive lo especifico de un lugar. El resto del motor
 * solo conoce este objeto. Generar otra ciudad es escribir otro territorio,
 * nunca tocar el core.
 */

import { centro } from './area.js';
import { epsgRecomendado } from './proyeccion.js';

/** Lado de celda por defecto, en metros. */
export const LADO_CELDA_POR_DEFECTO = 250;

/**
 * @typedef {Object} Territorio
 * @property {string} id
 * @property {string} nombre
 * @property {import('./area.js').Area} area
 * @property {number} epsg            Sistema proyectado de trabajo, en metros
 * @property {number} ladoCeldaMetros
 */

/**
 * @param {Object} datos
 * @param {string} datos.id
 * @param {string} datos.nombre
 * @param {import('./area.js').Area} datos.area
 * @param {number} [datos.epsg]  Si se omite, se deduce de la posicion del area
 * @param {number} [datos.ladoCeldaMetros]
 * @returns {Territorio}
 */
export function crearTerritorio({
  id,
  nombre,
  area,
  epsg,
  ladoCeldaMetros = LADO_CELDA_POR_DEFECTO,
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('crearTerritorio: `id` debe ser una cadena no vacia');
  }
  if (typeof nombre !== 'string' || nombre.length === 0) {
    throw new TypeError('crearTerritorio: `nombre` debe ser una cadena no vacia');
  }
  if (!area) {
    throw new TypeError('crearTerritorio: `area` es obligatoria');
  }
  if (!(Number.isFinite(ladoCeldaMetros) && ladoCeldaMetros > 0)) {
    throw new RangeError('crearTerritorio: `ladoCeldaMetros` debe ser un numero positivo');
  }

  const epsgFinal = epsg ?? epsgRecomendado(centro(area));

  if (!Number.isInteger(epsgFinal)) {
    throw new TypeError('crearTerritorio: `epsg` debe ser un entero');
  }

  return Object.freeze({
    id,
    nombre,
    area,
    epsg: epsgFinal,
    ladoCeldaMetros,
  });
}
