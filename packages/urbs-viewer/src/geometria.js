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

import { ALTURA_PLANTA_POR_DEFECTO, Confianza, esTipoConducible } from 'urbs-core';

import { bordesDeCalzada } from './calzada.js';
import { cotaEnCelda, cotasDePuente } from './terreno.js';

/**
 * Altura de un edificio del que no se sabe nada. Ni cero —seria un poligono
 * invisible— ni una torre: dos plantas y media, lo mas comun en un casco viejo.
 */
export const ALTURA_POR_DEFECTO = 8;

/** A que altura flota la cinta de la calzada, para no pelearse con el suelo. */
export const ALTURA_VIARIO = 0.05;

/**
 * A que altura va la acera. Es el bordillo, y no es decoracion.
 *
 * El color solo no basta: a contraluz y con bruma, dos grises se confunden. El
 * escalon es lo que hace que una acera se lea como acera desde dentro del
 * coche, que es desde donde se mira.
 */
export const ALTURA_ACERA = 0.17;

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
 * Firme de la acera: granito claro, el de la ciudad que se esta copiando.
 *
 * Frio no, a proposito. El asfalto ya tira a azul; si la acera tambien lo
 * hiciera, de lejos y bajo la bruma volverian a ser la misma cinta gris y
 * estariamos donde empezamos.
 */
export const COLOR_ACERA = Object.freeze([0.63, 0.6, 0.55]);

/**
 * Como se pinta y a que altura va un tramo por el que pasa un coche.
 *
 * @returns {{color: ReadonlyArray<number>, altura: number}}
 */
export function firmeDeCalzada() {
  return { color: COLOR_VIARIO, altura: ALTURA_VIARIO };
}

/** Lo mismo para un tramo por el que no pasa un coche. */
export function firmeDeAcera() {
  return { color: COLOR_ACERA, altura: ALTURA_ACERA };
}

/**
 * Firme que le toca a un tipo de via.
 *
 * La decision la toma `esTipoConducible`, del dominio, y NO una lista de tipos
 * escrita aqui. Una lista en el visor y otra en el dominio coinciden el dia
 * que se escriben y divergen despues; asi fue como se pintaron 241 km de acera
 * con el asfalto de una autopista.
 *
 * @param {string|undefined} tipo
 * @returns {{color: ReadonlyArray<number>, altura: number}}
 */
export function firmeDeTramo(tipo) {
  return esTipoConducible(tipo) ? firmeDeCalzada() : firmeDeAcera();
}

/**
 * Estructuras, en el orden en que viajan en la celda. Es el mismo orden que
 * fija el formato: cambiarlo reinterpreta archivos ya escritos.
 */
const ESTRUCTURA_RASANTE = 'rasante';
const ESTRUCTURA_PUENTE = 'puente';
const ESTRUCTURA_TUNEL = 'tunel';
const ESTRUCTURAS = Object.freeze([ESTRUCTURA_RASANTE, ESTRUCTURA_PUENTE, ESTRUCTURA_TUNEL]);

/**
 * Zocalo de un edificio, derivado y no elegido.
 *
 * Es lo que puede haber bajado el terreno ENTRE dos muestras sin que lo hayamos
 * visto, o sea la pendiente bajo la huella repartida por el muestreo. Se acota
 * por los dos lados: por abajo para que un edificio en llano no quede colgando
 * de un pelo, y por arriba para que una digitalizacion absurda no lo entierre.
 */
export const ZOCALO_POR_DESNIVEL = 0.25;
export const ZOCALO_MINIMO = 0.15;
export const ZOCALO_MAXIMO = 2;

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
/**
 * Cota a la que arranca un edificio.
 *
 * Se toma el MINIMO del terreno bajo la huella, menos un zocalo. No la media ni
 * una muestra en el centroide, y el motivo es que los tres errores posibles no
 * cuestan lo mismo: un hueco bajo un edificio es el unico que se VE y por el
 * que ademas se CAE, mientras que enterrar treinta centimetros de un portal
 * solo queda un poco raro. La media entierra media fachada y hace flotar la
 * otra media —lo peor de las dos— y una muestra en el centroide flota por el
 * lado de abajo en cualquier calle en cuesta, que en Ciudad Vieja son casi
 * todas.
 *
 * El minimo se busca sobre la MALLA QUE SE ENVIA, que es la superficie que se
 * ve y se pisa. Buscarlo sobre el dato fino del preprocesado dejaria el
 * edificio flotando alli donde la malla quede por debajo.
 *
 * El zocalo NO es un numero elegido: es lo que puede bajar el terreno entre dos
 * muestras, o sea pendiente por paso de muestreo, acotado para que una
 * digitalizacion absurda no entierre un edificio entero.
 *
 * Coste que se acepta: un edificio largo en una calle empinada se hunde por el
 * extremo de arriba. Tiene fecha de caducidad — OSM ya trae `building:part`, y
 * cuando cada parte tome su propia base el defecto se disuelve casi solo.
 *
 * @param {Float32Array} anilloExterior  Pares [este, norte] locales
 * @param {Object|null} relieve
 * @returns {number}
 */
export function baseDeEdificio(anilloExterior, relieve) {
  if (relieve === null) {
    return 0;
  }

  let minima = Infinity;
  let maxima = -Infinity;
  for (let i = 0; i < anilloExterior.length; i += 2) {
    const cota = cotaEnCelda(relieve, anilloExterior[i], anilloExterior[i + 1]);
    if (cota === null) continue;
    if (cota < minima) minima = cota;
    if (cota > maxima) maxima = cota;
  }
  if (minima === Infinity) {
    return 0;
  }

  // Pendiente bajo la huella por el paso de la rejilla: lo que el terreno puede
  // haber bajado entre dos muestras sin que lo hayamos visto.
  const desnivel = maxima - minima;
  const zocalo = Math.min(Math.max(desnivel * ZOCALO_POR_DESNIVEL, ZOCALO_MINIMO), ZOCALO_MAXIMO);
  return minima - zocalo;
}

function extruirEdificio(malla, anillos, altura, color, base = 0) {
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
    malla.vertice(llano[i], base + altura, -llano[i + 1], ARRIBA, color);
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

      const abajo1 = malla.vertice(e1, base, -n1, normal, color);
      const abajo2 = malla.vertice(e2, base, -n2, normal, color);
      const arriba2 = malla.vertice(e2, base + altura, -n2, normal, color);
      const arriba1 = malla.vertice(e1, base + altura, -n1, normal, color);

      malla.triangulo(abajo1, abajo2, arriba2);
      malla.triangulo(abajo1, arriba2, arriba1);
    }
  }
}

/**
 * Calzada de un tramo de via, a ras de suelo.
 *
 * Los bordes salen ya ingletados de `bordesDeCalzada`: un punto por vertice, no
 * cuatro esquinas por segmento. Aqui solo queda coserlos en una tira de
 * cuadrilateros, que es lo unico que sabe de triangulos y de ejes de escena.
 *
 * @param {ReturnType<typeof crearMalla>} malla
 * @param {Float32Array} eje  Pares [este, norte] seguidos
 * @param {number} anchura
 * @returns {void}
 */
function tenderCalzada(
  malla,
  eje,
  anchura,
  relieve = null,
  estructura = ESTRUCTURA_RASANTE,
  firme = firmeDeCalzada(),
) {
  // El dato real puede traer una anchura invalida en un tramo suelto. Perder
  // ese tramo es mejor que perder la celda entera, que es lo que pasaria si se
  // dejara subir el RangeError.
  if (!(Number.isFinite(anchura) && anchura > 0)) {
    return;
  }

  // Un tunel no forma parte de la superficie visible. Dibujarlo pegado al
  // terreno, que es lo que hacia hasta ahora, deja la boca enterrada y la
  // calzada pintada por encima del monte que atraviesa.
  if (estructura === ESTRUCTURA_TUNEL) {
    return;
  }

  const { derecha, izquierda, eje: ejeLimpio } = bordesDeCalzada(eje, anchura);
  const vertices = derecha.length / 2;
  if (vertices < 2) {
    return;
  }

  // La calzada se apoya en la MALLA QUE SE ENVIA, vertice a vertice y tambien
  // en los desplazados por el inglete. Tomar la cota del dato fino del
  // preprocesado dejaria la calle flotando o hundida respecto a lo que se ve,
  // con luz por debajo a lo largo de toda la calle — y un edificio disimula ese
  // desfase tras sus paredes, pero una calle no puede.
  // Un puente traza una rampa entre sus extremos en vez de seguir el terreno.
  const tablero =
    estructura === ESTRUCTURA_PUENTE && relieve !== null ? cotasDePuente(ejeLimpio, relieve) : null;

  const cotaDeBorde = (indice, x, z) => {
    if (tablero !== null) return tablero[indice] + firme.altura;
    return (relieve === null ? 0 : cotaEnCelda(relieve, x, z) ?? 0) + firme.altura;
  };

  let derechaAnterior = malla.vertice(
    derecha[0],
    cotaDeBorde(0, derecha[0], derecha[1]),
    -derecha[1],
    ARRIBA,
    firme.color,
  );
  let izquierdaAnterior = malla.vertice(
    izquierda[0],
    cotaDeBorde(0, izquierda[0], izquierda[1]),
    -izquierda[1],
    ARRIBA,
    firme.color,
  );

  for (let i = 1; i < vertices; i += 1) {
    const d = malla.vertice(
      derecha[i * 2],
      cotaDeBorde(i, derecha[i * 2], derecha[i * 2 + 1]),
      -derecha[i * 2 + 1],
      ARRIBA,
      firme.color,
    );
    const z = malla.vertice(
      izquierda[i * 2],
      cotaDeBorde(i, izquierda[i * 2], izquierda[i * 2 + 1]),
      -izquierda[i * 2 + 1],
      ARRIBA,
      firme.color,
    );

    // Devanado antihorario visto desde arriba, para que la cara mire al cielo.
    malla.triangulo(derechaAnterior, d, z);
    malla.triangulo(derechaAnterior, z, izquierdaAnterior);

    derechaAnterior = d;
    izquierdaAnterior = z;
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

  // El suelo sobre el que se apoya todo. Es la malla que se ENVIA, no el dato
  // fino del que salio: es la que se ve y la que pisa el coche.
  const relieve =
    vistas.relieve !== undefined && vistas.relieve.postes >= 2
      ? {
          cotas: vistas.relieve.cotas,
          cotaBase: vistas.relieve.cotaBase,
          postes: vistas.relieve.postes,
          pasoMetros: vistas.relieve.pasoMetros,
        }
      : null;

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
    const base = baseDeEdificio(anillos[0], relieve);
    extruirEdificio(
      malla,
      anillos,
      alturaDeEdificio(edificios.altura[i], edificios.plantas[i]),
      COLOR_POR_CONFIANZA[confianza] ?? COLOR_DESCONOCIDO,
      base,
    );
  }

  for (let i = 0; i < cabecera.numeroTramos; i += 1) {
    const desde = tramos.inicioVertice[i] * 2;
    const hasta = tramos.inicioVertice[i + 1] * 2;
    tenderCalzada(
      malla,
      tramos.vertices.subarray(desde, hasta),
      tramos.anchura[i],
      relieve,
      ESTRUCTURAS[tramos.estructura[i]] ?? ESTRUCTURA_RASANTE,
      firmeDeTramo(diccionarios.tiposVia[tramos.tipo[i]]),
    );
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
