/**
 * Gestor de celdas: el unico sitio del visor que toca la GPU.
 *
 * Carga celdas por proximidad y las suelta cuando sobran. Lo delicado no es
 * cargar sino DESCARGAR: `BufferGeometry.dispose()` solo emite un evento, asi
 * que hay que llamarlo ANTES de soltar la ultima referencia o la memoria de la
 * GPU se queda colgada sin que el recolector pueda hacer nada. Por eso el
 * contador `renderer.info.memory.geometries` esta en pantalla: es el detector
 * de fugas mas barato que existe, y si sube mientras vuelas en circulos, algo
 * de aqui esta mal.
 *
 * El material es UNO, compartido por todas las celdas y contado por
 * referencias: tirarlo con cada celda seria recompilar el shader a cada paso.
 */

import * as THREE from 'three';

import { UMBRAL_AGUA_DE_RESERVA, vistasDeCelda } from 'urbs-core';

import { construirGeometriaDeCelda } from '../src/geometria.js';
import { construirTerrenoDeCelda } from '../src/terreno.js';
import { desplazamientoDeCelda } from '../src/origen-flotante.js';
import { celdasEnRadio, planDeCarga } from '../src/streaming.js';

/**
 * Crea el gestor.
 *
 * @param {Object} datos
 * @param {THREE.Scene} datos.escena
 * @param {Object} datos.indice          El `indice.json` del territorio
 * @param {string} datos.base            URL del directorio del territorio
 * @param {ReturnType<import('../src/origen-flotante.js').crearOrigenFlotante>} datos.origen
 * @param {number} datos.radioMetros
 */
export function crearGestorDeCeldas({ escena, indice, base, origen, radioMetros }) {
  // El umbral de agua lo declara el TERRITORIO, no el motor: depende de la
  // altura de los muelles y del tipo de costa. Si no lo declara, el de reserva
  // deja de pintar agua en vez de inundar calles.
  const umbralAgua = indice.territorio.umbralAguaMetros ?? UMBRAL_AGUA_DE_RESERVA;
  const { ladoCeldaMetros } = indice.territorio;

  // Un solo material para toda la ciudad. El color por confianza viaja en el
  // atributo de vertice, no en el material, justo para que esto sea posible.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  let referenciasAlMaterial = 0;

  /** @type {Map<string, THREE.Mesh>} */
  const enEscena = new Map();
  /** @type {Set<string>} */
  const enVuelo = new Set();
  /** @type {Map<string, object>} */
  const porClave = new Map(indice.celdas.map((celda) => [celda.clave, celda]));

  let edificiosVisibles = 0;

  /**
   * @param {object} celda  Entrada del indice
   * @returns {Promise<void>}
   */
  async function cargar(celda) {
    const respuesta = await fetch(`${base}/${celda.archivo}`);
    if (!respuesta.ok) {
      throw new Error(`No se ha podido leer ${celda.archivo}: ${respuesta.status}`);
    }

    // `arrayBuffer()` entrega justo lo que quiere el lector de vistas: los
    // bytes crudos, sin decodificar ni copiar.
    const vistas = vistasDeCelda(await respuesta.arrayBuffer());
    const malla = construirGeometriaDeCelda(vistas);

    // La celda puede haber salido del radio mientras bajaba.
    if (!enVuelo.has(celda.clave)) {
      return;
    }

    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute('position', new THREE.BufferAttribute(malla.posiciones, 3));
    geometria.setAttribute('normal', new THREE.BufferAttribute(malla.normales, 3));
    geometria.setAttribute('color', new THREE.BufferAttribute(malla.colores, 3));
    geometria.setIndex(new THREE.BufferAttribute(malla.indices, 1));
    geometria.computeBoundingSphere();

    // El terreno va en su propia malla y no mezclado con edificios y calzada:
    // es la unica superficie que puede existir sin que haya nada encima, y
    // separarla deja la puerta abierta a darle su propio material.
    const terreno = construirTerrenoDeCelda(vistas, { umbralAgua });

    const objeto = new THREE.Mesh(geometria, material);
    referenciasAlMaterial += 1;
    objeto.name = celda.clave;
    objeto.userData.edificios = malla.numeroEdificios;

    // AQUI se cumple la regla 1 de la decision 0001: la unica vez que aparece
    // el origen absoluto de la celda es esta resta, en float64. Lo que llega a
    // la matriz son cientos de metros.
    const { x, z } = desplazamientoDeCelda(celda.origen, origen.ancla);
    objeto.position.set(x, 0, z);

    if (terreno !== null) {
      const geometriaTerreno = new THREE.BufferGeometry();
      geometriaTerreno.setAttribute('position', new THREE.BufferAttribute(terreno.posiciones, 3));
      geometriaTerreno.setAttribute('normal', new THREE.BufferAttribute(terreno.normales, 3));
      geometriaTerreno.setAttribute('color', new THREE.BufferAttribute(terreno.colores, 3));
      geometriaTerreno.setIndex(new THREE.BufferAttribute(terreno.indices, 1));
      geometriaTerreno.computeBoundingSphere();
      const mallaTerreno = new THREE.Mesh(geometriaTerreno, material);
      referenciasAlMaterial += 1;
      objeto.add(mallaTerreno);
    }

    escena.add(objeto);
    enEscena.set(celda.clave, objeto);
    edificiosVisibles += malla.numeroEdificios;
  }

  /**
   * @param {string} clave
   * @returns {void}
   */
  function descargar(clave) {
    const objeto = enEscena.get(clave);
    if (objeto === undefined) {
      return;
    }

    escena.remove(objeto);
    // ANTES de soltar la referencia. Al reves, la memoria de la GPU se queda.
    objeto.geometry.dispose();
    for (const hijo of objeto.children) {
      hijo.geometry.dispose();
      referenciasAlMaterial -= 1;
    }
    edificiosVisibles -= objeto.userData.edificios;
    enEscena.delete(clave);
    referenciasAlMaterial -= 1;
  }

  return {
    get celdasEnEscena() {
      return enEscena.size;
    },
    get edificiosEnEscena() {
      return edificiosVisibles;
    },
    get referenciasAlMaterial() {
      return referenciasAlMaterial;
    },

    /**
     * Desplaza todo lo cargado al rebasar el origen flotante. Se llama en el
     * MISMO fotograma que el rebase; cuando haya fisicas, el mundo de Rapier
     * tiene que moverse aqui tambien.
     *
     * @param {{x: number, z: number}} delta
     * @returns {void}
     */
    rebasar({ x, z }) {
      for (const objeto of enEscena.values()) {
        objeto.position.x -= x;
        objeto.position.z -= z;
      }
    },

    /**
     * Pone al dia la escena segun donde esta la camara.
     *
     * @param {{este: number, norte: number}} posicion  En metros proyectados
     * @returns {void}
     */
    actualizar(posicion) {
      const deseadas = celdasEnRadio(indice.celdas, posicion, radioMetros, ladoCeldaMetros);
      const activas = new Set([...enEscena.keys(), ...enVuelo]);
      const plan = planDeCarga(deseadas, activas);

      for (const clave of plan.descargar) {
        enVuelo.delete(clave);
        descargar(clave);
      }

      for (const clave of plan.cargar) {
        enVuelo.add(clave);
        cargar(porClave.get(clave))
          .catch((error) => console.error(`[urbs] celda ${clave}:`, error))
          .finally(() => enVuelo.delete(clave));
      }
    },

    /**
     * Suelta todo. El material solo se tira cuando ya no lo usa nadie.
     * @returns {void}
     */
    destruir() {
      for (const clave of [...enEscena.keys()]) {
        descargar(clave);
      }
      if (referenciasAlMaterial === 0) {
        material.dispose();
      }
    },
  };
}
