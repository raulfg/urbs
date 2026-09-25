/**
 * Extrusion en tiempo de ejecucion: de huellas a triangulos.
 *
 * Lo que viaja en un `.urbscell` son huellas y semantica, no mallas cocidas.
 * Esta pieza es la que las convierte en geometria, y vive aparte de three.js a
 * proposito: entra una celda en vistas tipadas y salen arrays tipados listos
 * para subir a la GPU. Asi se puede probar entera en Node, sin canvas, sin
 * WebGL y sin fingir un navegador, que es exactamente lo que no se puede hacer
 * con el codigo de render.
 *
 * Una celda produce UNA malla. No una por edificio: cinco mil mallas son cinco
 * mil llamadas de dibujo, y la unidad de carga y descarga del streaming es la
 * celda, asi que la unidad de geometria tambien deberia serlo.
 *
 * Ejes: este a +X, altura a +Y, norte a -Z (ver `origen-flotante.js`).
 */

import earcut from 'earcut';

import { ALTURA_PLANTA_POR_DEFECTO, Confianza } from 'urbs-core';

/**
 * Altura de un edificio del que no se sabe nada. Ni cero —seria un poligono
 * invisible— ni una torre: dos plantas y media, lo mas comun en un casco viejo.
 */
export const ALTURA_POR_DEFECTO = 8;

/** A que altura flota la cinta del viario, para no pelearse con el suelo. */
export const ALTURA_VIARIO = 0.05;

/**
 * El color hace visible la calidad del dato de un vistazo: lo que se ve verde
 * lo dice OSM, lo naranja se lo ha inventado el motor a partir de las plantas
 * o del tipo de edificio. Sale gratis y ahorra abrir un archivo para saberlo.
 */
export const COLOR_POR_CONFIANZA = Object.freeze({
  [Confianza.MEDIDO]: Object.freeze([0.42, 0.72, 0.58]),
  [Confianza.DECLARADO]: Object.freeze([0.55, 0.66, 0.76]),
  [Confianza.ESTIMADO]: Object.freeze([0.85, 0.6, 0.35]),
});

/** Para una confianza que no este en la tabla: gris, visible y evidente. */
export const COLOR_DESCONOCIDO = Object.freeze([0.6, 0.6, 0.6]);

/** El viario no lleva color por procedencia: es el suelo, no el sujeto. */
export const COLOR_VIARIO = Object.freeze([0.3, 0.3, 0.32]);

/**
 * Altura util de un edificio, en metros.
 *
 * @param {number} alturaMetros  NaN si el dato no existe
 * @param {number} plantas       -1 si el dato no existe
 * @returns {number}
 */
export function alturaDeEdificio(alturaMetros, plantas) {
  if (!Number.isNaN(alturaMetros) && alturaMetros > 0) {
    return alturaMetros;
  }
  if (plantas > 0) {
    return plantas * ALTURA_PLANTA_POR_DEFECTO;
  }
  return ALTURA_POR_DEFECTO;
}

/**
 * Devuelve el anillo con la orientacion que toca, sin el vertice de cierre.
 *
 * Fijar la orientacion es lo que permite calcular la normal de una pared con
 * una formula en vez de con una heuristica: en un anillo antihorario sobre
 * (este, norte), el exterior de una arista `(dx, dy)` es siempre `(dy, -dx)`.
 * Los huecos van al reves, y por eso la pared de un patio mira al patio.
 *
 * @param {Float32Array|number[]} plano  Pares [este, norte] seguidos, sin cierre
 * @param {boolean} exterior
 * @returns {Float32Array}
 */
export function orientarAnillo(plano, exterior) {
  const puntos = plano instanceof Float32Array ? plano : Float32Array.from(plano);

  let areaDoble = 0;
  for (let i = 0; i < puntos.length; i += 2) {
    const j = (i + 2) % puntos.length;
    areaDoble += puntos[i] * puntos[j + 1] - puntos[j] * puntos[i + 1];
  }

  const antihorario = areaDoble > 0;
  if (antihorario === exterior) {
    return puntos;
  }

  // Se conserva el primer vertice y se da la vuelta al resto: invertir el
  // anillo entero lo rotaria, y aunque el poligono seria el mismo, cuesta
  // mucho mas seguirle la pista cuando algo sale torcido.
  const invertido = new Float32Array(puntos.length);
  invertido[0] = puntos[0];
  invertido[1] = puntos[1];
  for (let i = 2, j = puntos.length - 2; i < puntos.length; i += 2, j -= 2) {
    invertido[i] = puntos[j];
    invertido[i + 1] = puntos[j + 1];
  }
  return invertido;
}

/**
 * Acumulador de malla. Guarda en listas normales y solo al final vuelca a
 * arrays tipados: no se sabe cuantos triangulos habra hasta triangular.
 */
function crearMalla() {
  const posiciones = [];
  const normales = [];
  const colores = [];
  const indices = [];

  return {
    posiciones,
    normales,
    colores,
    indices,

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number[]} normal
     * @param {readonly number[]} color
     * @returns {number} Indice del vertice recien anadido
     */
    vertice(x, y, z, normal, color) {
      posiciones.push(x, y, z);
      normales.push(normal[0], normal[1], normal[2]);
      colores.push(color[0], color[1], color[2]);
      return posiciones.length / 3 - 1;
    },

    /**
     * @param {number} a
     * @param {number} b
     * @param {number} c
     */
    triangulo(a, b, c) {
      indices.push(a, b, c);
    },
  };
}

const ARRIBA = Object.freeze([0, 1, 0]);

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
 * Extruye un edificio: tejado plano triangulado mas una pared por arista.
 *
 * @param {ReturnType<typeof crearMalla>} malla
 * @param {Float32Array[]} anillos  Ya orientados y sin cierre
 * @param {number} altura
 * @param {readonly number[]} color
 * @returns {void}
 */
function extruirEdificio(malla, anillos, altura, color) {
  // --- Tejado. earcut quiere las coordenadas planas seguidas y los huecos
  // marcados por el indice de vertice en el que empiezan.
  const llano = [];
  const inicioHueco = [];
  for (const [posicion, anillo] of anillos.entries()) {
    if (posicion > 0) {
      inicioHueco.push(llano.length / 2);
    }
    for (let i = 0; i < anillo.length; i += 2) {
      llano.push(anillo[i], anillo[i + 1]);
    }
  }

  // Indice del PRIMER vertice del tejado dentro de la malla, no dentro del
  // array plano: la malla ya trae los edificios anteriores.
  const baseTejado = malla.posiciones.length / 3;
  for (let i = 0; i < llano.length; i += 2) {
    malla.vertice(llano[i], altura, -llano[i + 1], ARRIBA, color);
  }

  const triangulos = earcut(llano, inicioHueco, 2);
  for (let i = 0; i < triangulos.length; i += 3) {
    // El devanado que devuelve earcut sobre un anillo antihorario en
    // (este, norte) ya sale mirando a +Y al pasar el norte a -Z: la inversion
    // del eje y la del sentido se cancelan. Comprobado en las pruebas, que es
    // la unica forma de no equivocarse con esto.
    malla.triangulo(
      baseTejado + triangulos[i],
      baseTejado + triangulos[i + 1],
      baseTejado + triangulos[i + 2],
    );
  }

  // --- Paredes. Una por arista, con normal propia: el gres y la pizarra no
  // tienen aristas suaves, y compartir vertices redondearia las esquinas.
  for (const anillo of anillos) {
    const vertices = anillo.length / 2;
    for (let i = 0; i < vertices; i += 1) {
      const j = (i + 1) % vertices;
      const e1 = anillo[i * 2];
      const n1 = anillo[i * 2 + 1];
      const e2 = anillo[j * 2];
      const n2 = anillo[j * 2 + 1];

      const de = e2 - e1;
      const dn = n2 - n1;
      const largo = Math.hypot(de, dn);
      if (largo === 0) {
        continue;
      }
      // Normal exterior de un anillo antihorario, pasada a los ejes de escena.
      const normal = [dn / largo, 0, de / largo];

      const abajo1 = malla.vertice(e1, 0, -n1, normal, color);
      const abajo2 = malla.vertice(e2, 0, -n2, normal, color);
      const arriba2 = malla.vertice(e2, altura, -n2, normal, color);
      const arriba1 = malla.vertice(e1, altura, -n1, normal, color);

      malla.triangulo(abajo1, abajo2, arriba2);
      malla.triangulo(abajo1, arriba2, arriba1);
    }
  }
}

/**
 * Cinta plana de un tramo de via, a ras de suelo.
 *
 * Sin ingletes en las uniones: en un cambio de direccion brusco quedan cunas
 * sin cubrir. Se ve, y se arregla cuando haya calzada de verdad; para mirar la
 * ciudad desde el aire, una cinta por segmento basta.
 *
 * @param {ReturnType<typeof crearMalla>} malla
 * @param {Float32Array} eje  Pares [este, norte] seguidos
 * @param {number} anchura
 * @returns {void}
 */
function tenderCinta(malla, eje, anchura) {
  const mitad = anchura / 2;

  for (let i = 0; i + 3 < eje.length; i += 2) {
    const e1 = eje[i];
    const n1 = eje[i + 1];
    const e2 = eje[i + 2];
    const n2 = eje[i + 3];

    const de = e2 - e1;
    const dn = n2 - n1;
    const largo = Math.hypot(de, dn);
    if (largo === 0) {
      continue;
    }
    const pe = (dn / largo) * mitad;
    const pn = (-de / largo) * mitad;

    const a = malla.vertice(e1 + pe, ALTURA_VIARIO, -(n1 + pn), ARRIBA, COLOR_VIARIO);
    const b = malla.vertice(e2 + pe, ALTURA_VIARIO, -(n2 + pn), ARRIBA, COLOR_VIARIO);
    const c = malla.vertice(e2 - pe, ALTURA_VIARIO, -(n2 - pn), ARRIBA, COLOR_VIARIO);
    const d = malla.vertice(e1 - pe, ALTURA_VIARIO, -(n1 - pn), ARRIBA, COLOR_VIARIO);

    // Devanado antihorario visto desde arriba, para que la cara mire al cielo.
    malla.triangulo(a, b, c);
    malla.triangulo(a, c, d);
  }
}

/**
 * Convierte una celda en los arrays de una malla.
 *
 * @param {Object} vistas  Lo que devuelve `vistasDeCelda`
 * @returns {{posiciones: Float32Array, normales: Float32Array, colores: Float32Array,
 *           indices: Uint32Array, numeroEdificios: number, numeroTramos: number}}
 */
export function construirGeometriaDeCelda(vistas) {
  const malla = crearMalla();
  const { cabecera, edificios, tramos, diccionarios } = vistas;

  for (let i = 0; i < cabecera.numeroEdificios; i += 1) {
    const anillos = [];
    for (let a = edificios.inicioAnillo[i]; a < edificios.inicioAnillo[i + 1]; a += 1) {
      const desde = edificios.anillosInicioVertice[a] * 2;
      const hasta = edificios.anillosInicioVertice[a + 1] * 2;
      const plano = sinCierre(edificios.vertices.subarray(desde, hasta));
      if (plano.length >= 6) {
        anillos.push(orientarAnillo(plano, anillos.length === 0));
      }
    }
    if (anillos.length === 0) {
      continue;
    }

    const confianza = diccionarios.procedencias[edificios.procedencia[i]]?.confianza;
    extruirEdificio(
      malla,
      anillos,
      alturaDeEdificio(edificios.altura[i], edificios.plantas[i]),
      COLOR_POR_CONFIANZA[confianza] ?? COLOR_DESCONOCIDO,
    );
  }

  for (let i = 0; i < cabecera.numeroTramos; i += 1) {
    const desde = tramos.inicioVertice[i] * 2;
    const hasta = tramos.inicioVertice[i + 1] * 2;
    tenderCinta(malla, tramos.vertices.subarray(desde, hasta), tramos.anchura[i]);
  }

  return {
    posiciones: Float32Array.from(malla.posiciones),
    normales: Float32Array.from(malla.normales),
    colores: Float32Array.from(malla.colores),
    indices: Uint32Array.from(malla.indices),
    numeroEdificios: cabecera.numeroEdificios,
    numeroTramos: cabecera.numeroTramos,
  };
}
