/**
 * Streaming de colisiones: que celdas tienen que existir para las fisicas.
 *
 * Es el gemelo de `gestor-celdas.js`, con la misma aritmetica de proximidad y
 * un radio MAYOR. Van separados a proposito en lugar de ser un gestor con dos
 * radios: son dos ciclos de vida distintos —una celda puede estar colisionando
 * sin dibujarse— y mezclarlos obligaria a llevar media entrada nula en cada
 * una de las dos direcciones.
 *
 * El precio de tenerlos separados es que una celda del anillo exterior se baja
 * otra vez cuando entra en el radio de render. Son 14 KiB; el codigo que
 * ahorraria esa descarga cuesta mas de lo que vale.
 */

import { vistasDeCelda } from 'urbs-core';

import { colisionesDeCelda } from '../src/colisiones.js';
import { alturasParaRapier } from '../src/terreno.js';
import { desplazamientoDeCelda } from '../src/origen-flotante.js';
import { celdasEnRadio, planDeCarga } from '../src/streaming.js';

/**
 * @param {Object} datos
 * @param {Awaited<ReturnType<import('./mundo-fisico.js').crearMundoFisico>>} datos.mundoFisico
 * @param {Object} datos.indice
 * @param {string} datos.base
 * @param {ReturnType<import('../src/origen-flotante.js').crearOrigenFlotante>} datos.origen
 * @param {number} datos.radioMetros
 */
export function crearGestorDeColisiones({ mundoFisico, indice, base, origen, radioMetros }) {
  const { ladoCeldaMetros } = indice.territorio;

  /** @type {Set<string>} */
  const enMundo = new Set();
  /** @type {Set<string>} */
  const enVuelo = new Set();
  /** @type {Map<string, object>} */
  const porClave = new Map(indice.celdas.map((celda) => [celda.clave, celda]));

  /**
   * @param {object} celda  Entrada del indice
   * @returns {Promise<void>}
   */
  async function cargar(celda) {
    const respuesta = await fetch(`${base}/${celda.archivo}`);
    if (!respuesta.ok) {
      throw new Error(`No se ha podido leer ${celda.archivo}: ${respuesta.status}`);
    }

    const vistas = vistasDeCelda(await respuesta.arrayBuffer());
    const colisiones = colisionesDeCelda(vistas);
    // El terreno del colisionador es LA MISMA malla que se dibuja: el coche
    // pisa exactamente la superficie que se ve.
    const terreno =
      vistas.relieve.postes >= 2
        ? {
            postes: vistas.relieve.postes,
            pasoMetros: vistas.relieve.pasoMetros,
            alturas: alturasParaRapier(vistas.relieve),
          }
        : null;

    // Puede haber salido del radio mientras bajaba.
    if (!enVuelo.has(celda.clave)) {
      return;
    }

    // El ancla se lee DESPUES del await: si ha habido un rebase mientras la
    // celda bajaba, el desplazamiento que vale es el de ahora.
    mundoFisico.anadirCelda(
      celda.clave,
      colisiones,
      desplazamientoDeCelda(celda.origen, origen.ancla),
      terreno,
    );
    enMundo.add(celda.clave);
  }

  return {
    get celdasEnMundo() {
      return enMundo.size;
    },

    /** Cuantas celdas estan bajando ahora mismo. */
    get cargando() {
      return enVuelo.size;
    },

    /**
     * @param {{este: number, norte: number}} posicion  Metros proyectados
     * @returns {void}
     */
    actualizar(posicion) {
      const deseadas = celdasEnRadio(indice.celdas, posicion, radioMetros, ladoCeldaMetros);
      const plan = planDeCarga(deseadas, new Set([...enMundo, ...enVuelo]));

      for (const clave of plan.descargar) {
        enVuelo.delete(clave);
        enMundo.delete(clave);
        mundoFisico.quitarCelda(clave);
      }

      for (const clave of plan.cargar) {
        enVuelo.add(clave);
        cargar(porClave.get(clave))
          .catch((error) => console.error(`[urbs] colisiones de ${clave}:`, error))
          .finally(() => enVuelo.delete(clave));
      }
    },
  };
}
