/**
 * Proveedor de relieve: hojas del MDT02 del PNOA-LiDAR.
 *
 * Sirve la capa `relieve`, y a diferencia de las otras NO devuelve una lista de
 * elementos: devuelve una FUENTE a la que se le piden recortes. La razon es el
 * tamano — un cuadrante son 60 MB en disco y 129 MB descomprimido, asi que el
 * pipeline pide la caja de cada celda y solo se descomprimen las teselas que
 * hagan falta (38 ms por celda frente a 1.321 ms por hoja entera, medido).
 *
 * Las hojas las declara el TERRITORIO, no el codigo. Cada una es un cuadrante
 * del MTN50 con su identificador de descarga del Centro de Descargas; ponerlas
 * aqui ataria el motor a A Coruna, que es justo lo que no puede pasar.
 */

import { Capa, validarProveedor } from 'urbs-core';

import { crearDescargaCnig, DIRECTORIO_CRUDOS_POR_DEFECTO } from './cnig.js';
import { abrirHoja } from './hoja.js';

export const ID_PROVEEDOR_RELIEVE = 'pnoa-mdt02';

/**
 * Por encima de OSM (que es 10) a proposito: OSM ni siquiera tiene relieve.
 */
export const PRIORIDAD_PNOA = 50;

/**
 * Atribucion obligatoria. La formula la fija el IGN y el nombre del producto y
 * el rango de anos son parte de ella: no vale la del PNOA de ortofotos.
 */
export const ATRIBUCION_MDT02 = Object.freeze({
  fuente: 'PNOA-LiDAR / Instituto Geografico Nacional',
  licencia: 'CC BY 4.0',
  texto: 'Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es',
  url: 'https://www.scne.es/',
});

/**
 * Si una caja cabe entera dentro de unos limites.
 *
 * @param {{esteMin: number, esteMax: number, norteMin: number, norteMax: number}} limites
 * @param {{esteMin: number, esteMax: number, norteMin: number, norteMax: number}} caja
 * @returns {boolean}
 */
export function contiene(limites, caja) {
  return (
    caja.esteMin >= limites.esteMin &&
    caja.esteMax <= limites.esteMax &&
    caja.norteMin >= limites.norteMin &&
    caja.norteMax <= limites.norteMax
  );
}

/**
 * Fuente de relieve sobre un juego de hojas.
 *
 * @param {Object} datos
 * @param {Array<{id: number|string, nombre: string}>} datos.hojas
 * @param {string} [datos.directorio]
 * @param {Function} datos.fetcher
 * @param {boolean} [datos.refrescar]
 */
export function crearFuenteRelievePnoa({
  hojas,
  directorio = DIRECTORIO_CRUDOS_POR_DEFECTO,
  fetcher,
  refrescar = false,
}) {
  if (!Array.isArray(hojas) || hojas.length === 0) {
    throw new TypeError(
      'crearFuenteRelievePnoa: hace falta al menos una hoja. Las declara el territorio, no el motor.',
    );
  }

  const descarga = crearDescargaCnig({ fetcher, directorio });
  /** @type {Array<Awaited<ReturnType<typeof abrirHoja>>>} */
  let abiertas = [];

  return Object.freeze({
    /** Baja lo que falte y abre las hojas. No lee relieve todavia. */
    async preparar() {
      if (abiertas.length > 0) {
        return abiertas;
      }
      abiertas = [];
      for (const hoja of hojas) {
        const { ruta } = await descarga.hoja({ ...hoja, refrescar });
        abiertas.push(await abrirHoja(ruta));
      }
      return abiertas;
    },

    get limites() {
      if (abiertas.length === 0) return null;
      return abiertas.reduce(
        (union, hoja) => ({
          esteMin: Math.min(union.esteMin, hoja.limites.esteMin),
          esteMax: Math.max(union.esteMax, hoja.limites.esteMax),
          norteMin: Math.min(union.norteMin, hoja.limites.norteMin),
          norteMax: Math.max(union.norteMax, hoja.limites.norteMax),
        }),
        { ...abiertas[0].limites },
      );
    },

    /**
     * Malla de una caja, de la primera hoja que la contenga entera.
     *
     * Se exige que la contenga ENTERA a proposito: coser dos hojas en el borde
     * es un problema aparte, y devolver media caja dejaria media celda plana
     * sin que nadie se entere.
     *
     * @param {{esteMin: number, esteMax: number, norteMin: number, norteMax: number}} caja
     * @returns {Promise<object|null>}
     */
    async malla(caja) {
      for (const hoja of abiertas) {
        if (contiene(hoja.limites, caja)) {
          return hoja.malla(caja);
        }
      }
      return null;
    },

    async cerrar() {
      for (const hoja of abiertas) await hoja.cerrar();
      abiertas = [];
    },
  });
}

/**
 * @param {Object} datos
 * @param {Array<{id: number|string, nombre: string}>} datos.hojas
 * @param {string} [datos.directorio]
 * @param {Function} datos.fetcher
 * @param {boolean} [datos.refrescar]
 * @param {number} [datos.prioridad]
 */
export function crearProveedorRelievePnoa({ prioridad = PRIORIDAD_PNOA, ...resto }) {
  const fuente = crearFuenteRelievePnoa(resto);

  return validarProveedor(
    Object.freeze({
      id: ID_PROVEEDOR_RELIEVE,
      capa: Capa.RELIEVE,
      prioridad,
      // Cubrir se resuelve con las hojas que declara el territorio: si las ha
      // declarado, es que dice que las hojas cubren su area.
      cubre: () => true,
      atribucion: () => ATRIBUCION_MDT02,

      /**
       * Devuelve la FUENTE, no una lista: el relieve se pide por recortes.
       *
       * @returns {Promise<object>}
       */
      async obtenerRelieve() {
        await fuente.preparar();
        return fuente;
      },
    }),
  );
}
