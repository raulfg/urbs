/**
 * De huellas a formas de colision.
 *
 * El mundo de fisicas se construye de los MISMOS datos que la malla, no de la
 * malla: un `.urbscell` trae huellas, y de ahi salen a la vez los triangulos
 * que se ven y los cascos convexos contra los que se choca. Si el colisionador
 * se dedujera del triangulado, cualquier cambio de estilo movería las paredes.
 *
 * Aqui no hay ni three.js ni Rapier a proposito. Entra una celda en vistas
 * tipadas y salen nubes de puntos en ejes de escena, que es justo lo que come
 * `ColliderDesc.convexHull`. Asi se prueba entero en Node, que es lo unico que
 * se puede probar de verdad de un motor de fisicas sin navegador.
 *
 * Por que casco convexo y no malla de triangulos: un trimesh de 5.000 edificios
 * por celda es carisimo de construir y de consultar, y ademas es una superficie
 * sin volumen —un coche rapido la atraviesa en un paso—. El precio del casco es
 * que un edificio en L se rellena por la escotadura. No se puede entrar en el
 * hueco de una L, que a ras de calle casi nunca es un sitio al que se pueda ir.
 */

import { limpiarEje } from './calzada.js';
import { alturaDeEdificio } from './geometria.js';

/** Por debajo de esta area doble, un anillo no tiene superficie. */
const AREA_MINIMA = 1e-6;

/**
 * Quita el vertice de cierre de un anillo, si lo repite.
 *
 * @param {Float32Array} plano
 * @returns {Float32Array}
 */
function sinCierre(plano) {
  const n = plano.length;
  if (n >= 4 && plano[0] === plano[n - 2] && plano[1] === plano[n - 1]) {
    return plano.subarray(0, n - 2);
  }
  return plano;
}

/**
 * Doble del area con signo de un anillo (formula del cordon de zapato).
 *
 * @param {Float32Array} anillo
 * @returns {number}
 */
function areaDoble(anillo) {
  let suma = 0;
  for (let i = 0; i < anillo.length; i += 2) {
    const j = (i + 2) % anillo.length;
    suma += anillo[i] * anillo[j + 1] - anillo[j] * anillo[i + 1];
  }
  return suma;
}

/**
 * Nube de puntos del casco convexo de un edificio, en ejes de escena.
 *
 * Devuelve `null` cuando el anillo no puede dar un solido. `convexHull` tambien
 * devuelve `null` en esos casos, pero filtrarlos aqui permite CONTARLOS: el
 * dato real de OSM trae anillos de dos vertices y anillos alineados, y un
 * contador que se queda a cero es una pista de que el filtro no esta corriendo.
 *
 * @param {Float32Array|number[]} anillo  Pares [este, norte], con o sin cierre
 * @param {number} altura  Metros
 * @returns {Float32Array|null}  Ternas [x, y, z]: primero el anillo bajo, luego el alto
 */
export function nubeDeColisionDeEdificio(anillo, altura) {
  if (!(Number.isFinite(altura) && altura > 0)) {
    return null;
  }

  const plano = limpiarEje(sinCierre(anillo instanceof Float32Array ? anillo : Float32Array.from(anillo)));
  const vertices = plano.length / 2;
  if (vertices < 3) {
    return null;
  }
  if (Math.abs(areaDoble(plano)) < AREA_MINIMA) {
    return null;
  }

  const puntos = new Float32Array(vertices * 2 * 3);
  for (let i = 0; i < vertices; i += 1) {
    const este = plano[i * 2];
    const zeta = -plano[i * 2 + 1];

    const abajo = i * 3;
    puntos[abajo] = este;
    puntos[abajo + 1] = 0;
    puntos[abajo + 2] = zeta;

    const arriba = (vertices + i) * 3;
    puntos[arriba] = este;
    puntos[arriba + 1] = altura;
    puntos[arriba + 2] = zeta;
  }
  return puntos;
}

/**
 * Nubes de colision de todos los edificios de una celda.
 *
 * Solo se lee el anillo EXTERIOR de cada edificio. El casco convexo no tiene
 * huecos por definicion, asi que los puntos de un patio caerian dentro del
 * casco sin cambiarlo: serian calculo tirado.
 *
 * @param {Object} vistas  Lo que devuelve `vistasDeCelda`
 * @returns {{nubes: Array<{indice: number, puntos: Float32Array}>, descartados: number}}
 */
export function colisionesDeCelda(vistas) {
  const { cabecera, edificios } = vistas;
  const nubes = [];
  let descartados = 0;

  for (let i = 0; i < cabecera.numeroEdificios; i += 1) {
    const primerAnillo = edificios.inicioAnillo[i];
    if (primerAnillo >= edificios.inicioAnillo[i + 1]) {
      descartados += 1;
      continue;
    }

    const desde = edificios.anillosInicioVertice[primerAnillo] * 2;
    const hasta = edificios.anillosInicioVertice[primerAnillo + 1] * 2;
    const puntos = nubeDeColisionDeEdificio(
      edificios.vertices.subarray(desde, hasta),
      alturaDeEdificio(edificios.altura[i], edificios.plantas[i]),
    );

    if (puntos === null) {
      descartados += 1;
      continue;
    }
    nubes.push({ indice: i, puntos });
  }

  return { nubes, descartados };
}

/**
 * Cola de trabajo con presupuesto por fotograma.
 *
 * Soltar una celda son doscientos y pico `removeCollider`, y hacerlos todos en
 * un fotograma se ve como un tiron. La cola los reparte sin cambiar el orden,
 * que aqui NO es cosmetico: los colisionadores de una celda tienen que irse
 * antes que el cuerpo que los sostiene, porque quitar el cuerpo invalida los
 * colisionadores que sigan en la cola y Rapier recicla sus manejadores.
 *
 * Lo que se encola son datos opacos. Quien drena sabe que hacer con ellos; asi
 * esto se prueba sin Rapier delante.
 *
 * @param {Object} opciones
 * @param {number} opciones.porFotograma
 */
export function crearColaAmortizada({ porFotograma }) {
  if (!(Number.isInteger(porFotograma) && porFotograma > 0)) {
    throw new RangeError(
      `crearColaAmortizada: \`porFotograma\` debe ser un entero positivo, y es ${porFotograma}`,
    );
  }

  /** @type {unknown[]} */
  let cola = [];
  let cursor = 0;

  return {
    get pendientes() {
      return cola.length - cursor;
    },

    /**
     * @param {...unknown} elementos
     * @returns {void}
     */
    encolar(...elementos) {
      cola.push(...elementos);
    },

    /**
     * @returns {unknown[]}  Como mucho `porFotograma`, en orden de entrada
     */
    drenar() {
      if (cursor >= cola.length) {
        return [];
      }
      const lote = cola.slice(cursor, cursor + porFotograma);
      cursor += lote.length;
      // Se compacta al vaciarse, no en cada drenaje: `shift` sobre miles de
      // elementos es cuadratico y esto corre en cada fotograma.
      if (cursor >= cola.length) {
        cola = [];
        cursor = 0;
      }
      return lote;
    },
  };
}
