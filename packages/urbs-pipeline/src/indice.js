/**
 * Indice de un territorio generado.
 *
 * Un navegador no puede listar un directorio. Sin este archivo el visor no
 * tiene forma de saber que celdas existen, ni donde caen, ni cuanto pesan, y
 * acabaria pidiendo a ciegas celdas que no estan.
 *
 * Tambien es el sitio donde las atribuciones salen del dato en vez de una
 * lista escrita a mano: lo que aparece en los creditos es exactamente lo que
 * ha contribuido a generar este territorio.
 */

import { EXTENSION_CELDA } from './generar.js';

/** Version del indice. Un visor que no la reconozca debe negarse a leerlo. */
export const VERSION_INDICE = 1;

/** Nombre del indice dentro del directorio del territorio. El visor lo pide asi. */
export const NOMBRE_INDICE = 'indice.json';

/**
 * @param {Array<{indice: {x: number, z: number}}>} celdas
 * @returns {{xMin: number, xMax: number, zMin: number, zMax: number}|null}
 */
function limitesDe(celdas) {
  if (celdas.length === 0) {
    // Sin celdas no hay extension. Devolver Infinity seria tecnicamente cierto
    // y practicamente una trampa para quien lo pinte.
    return null;
  }

  const xs = celdas.map((celda) => celda.indice.x);
  const zs = celdas.map((celda) => celda.indice.z);

  return Object.freeze({
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    zMin: Math.min(...zs),
    zMax: Math.max(...zs),
  });
}

/**
 * Construye el indice que acompana a las celdas de un territorio.
 *
 * @param {Object} informe  Lo que devuelve `generarCeldas`
 * @param {Object} [opciones]
 * @param {() => Date} [opciones.ahora]  Inyectable para que el indice sea comprobable
 * @returns {Object} Objeto serializable tal cual a JSON
 */
export function construirIndice(informe, { ahora = () => new Date() } = {}) {
  if (informe === null || typeof informe !== 'object' || !Array.isArray(informe.celdas)) {
    throw new TypeError('construirIndice: se esperaba el informe que devuelve generarCeldas');
  }

  const celdas = [...informe.celdas]
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
    .map((celda) =>
      Object.freeze({
        clave: celda.clave,
        // El visor pide `${base}/${archivo}`: la ruta del pipeline lleva el
        // directorio de salida de la maquina que genero, y eso no viaja.
        archivo: `${celda.clave}${EXTENSION_CELDA}`,
        indice: celda.indice,
        origen: celda.origen,
        edificios: celda.edificios,
        tramos: celda.tramos,
        bytes: celda.bytes,
      }),
    );

  return Object.freeze({
    version: VERSION_INDICE,
    generadoEn: ahora().toISOString(),
    territorio: informe.territorio,
    margenMetros: informe.margenMetros,
    capas: informe.capas,
    sinCobertura: informe.sinCobertura,
    atribuciones: informe.atribuciones,
    limites: limitesDe(celdas),
    // Recalculados desde las celdas que realmente estan en el indice: un
    // total que no cuadre con la lista es peor que no tener total.
    totales: Object.freeze({
      celdas: celdas.length,
      edificios: celdas.reduce((suma, celda) => suma + celda.edificios, 0),
      tramos: celdas.reduce((suma, celda) => suma + celda.tramos, 0),
      bytes: celdas.reduce((suma, celda) => suma + celda.bytes, 0),
    }),
    celdas,
  });
}
