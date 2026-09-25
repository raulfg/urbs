/**
 * Origen flotante: la capa 2 de la decision 0001.
 *
 * Los datos ya vienen en coordenadas locales de celda, pero eso solo arregla
 * la mitad del problema: al colocar cada celda en la escena hay que decirle
 * DONDE va, y si ese "donde" es su origen UTM absoluto volvemos al punto de
 * partida —el norte de A Coruna son 4.800.000 m, y ahi el escalon de float32
 * es de medio metro—.
 *
 * La solucion es un ANCLA en float64 que viaja con el jugador. Todo se coloca
 * relativo a ella, asi que las magnitudes que llegan a la GPU son de cientos
 * de metros y no de millones. Cuando el jugador se aleja mas de un umbral, el
 * ancla se muda bajo sus pies y la escena entera se desplaza en bloque.
 *
 * Convencion de ejes, una sola vez y para siempre: el ESTE va a +X, la ALTURA
 * a +Y y el NORTE a -Z. Es la convencion de mano derecha con Y arriba que usa
 * three.js; mirar hacia -Z es mirar al norte.
 */

/** Distancia que puede alejarse la camara del ancla antes de rebasar, en metros. */
export const UMBRAL_REBASE_POR_DEFECTO = 1000;

/**
 * Pasa un punto proyectado a los ejes de la escena.
 *
 * @param {{este: number, norte: number}} punto
 * @returns {{x: number, z: number}}
 */
export function aEscena({ este, norte }) {
  return { x: este, z: -norte };
}

/**
 * Posicion en escena del origen de una celda, dada un ancla.
 *
 * Es la unica resta que separa "la ciudad tiembla al conducir" de "la ciudad
 * se queda quieta": se hace en float64 y su resultado, que ya es pequeno, es
 * lo unico que llega a la matriz de la celda.
 *
 * @param {{este: number, norte: number}} origen  Origen absoluto de la celda
 * @param {{este: number, norte: number}} ancla
 * @returns {{x: number, z: number}}
 */
export function desplazamientoDeCelda(origen, ancla) {
  return aEscena({ este: origen.este - ancla.este, norte: origen.norte - ancla.norte });
}

/**
 * @param {unknown} ancla
 * @returns {{este: number, norte: number}}
 */
function validarAncla(ancla) {
  if (
    ancla === null ||
    typeof ancla !== 'object' ||
    !Number.isFinite(/** @type {any} */ (ancla).este) ||
    !Number.isFinite(/** @type {any} */ (ancla).norte)
  ) {
    throw new TypeError(
      'crearOrigenFlotante: `ancla` debe ser un punto proyectado {este, norte} en metros',
    );
  }
  return { este: /** @type {any} */ (ancla).este, norte: /** @type {any} */ (ancla).norte };
}

/**
 * Crea el origen flotante del visor.
 *
 * @param {Object} datos
 * @param {{este: number, norte: number}} datos.ancla
 * @param {number} [datos.umbralMetros]
 */
export function crearOrigenFlotante({ ancla, umbralMetros = UMBRAL_REBASE_POR_DEFECTO }) {
  let actual = validarAncla(ancla);

  if (!(Number.isFinite(umbralMetros) && umbralMetros > 0)) {
    throw new RangeError(
      'crearOrigenFlotante: `umbralMetros` debe ser positivo; con cero se rebasaria en cada fotograma',
    );
  }

  return {
    get ancla() {
      return Object.freeze({ ...actual });
    },
    umbralMetros,

    /**
     * Mueve el ancla bajo la camara si se ha alejado demasiado.
     *
     * Devuelve el desplazamiento que hay que restar a TODO lo que ya esta en
     * escena. Quien llama debe aplicarlo al grafo y —cuando lo haya— al mundo
     * de fisicas en el MISMO fotograma: mover uno sin el otro desincroniza
     * render y colisiones, que es peor que el problema original.
     *
     * @param {{x: number, z: number}} camara  Posicion de la camara en escena
     * @returns {{rebasado: boolean, delta: {x: number, z: number}}}
     */
    rebasarSiHaceFalta({ x, z }) {
      if (Math.hypot(x, z) <= umbralMetros) {
        return { rebasado: false, delta: { x: 0, z: 0 } };
      }

      // El ancla se RECALCULA en absolutos, no se va sumando el delta a un
      // acumulador: asi mil rebases no dejan deriva.
      actual = { este: actual.este + x, norte: actual.norte - z };
      return { rebasado: true, delta: { x, z } };
    },

    /**
     * Vuelve a metros proyectados absolutos. Hace falta para saber que celda
     * se esta pisando, y es el unico sitio donde reaparece la magnitud grande.
     *
     * @param {{x: number, z: number}} punto
     * @returns {{este: number, norte: number}}
     */
    aProyectado({ x, z }) {
      return Object.freeze({ este: actual.este + x, norte: actual.norte - z });
    },
  };
}
