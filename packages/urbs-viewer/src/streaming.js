/**
 * Streaming por proximidad: que celdas deben estar en escena ahora mismo.
 *
 * Todo lo que hay aqui es aritmetica pura sobre el indice del territorio. No
 * toca la red ni la GPU a proposito: decidir QUE cargar y APLICAR esa decision
 * son dos problemas distintos, y solo el segundo necesita un navegador.
 *
 * La distancia se mide a la CAJA de la celda, no a su centro. Medir al centro
 * hace que la celda que estas pisando compita en igualdad con sus vecinas, y
 * al aterrizar aparece antes el bloque de al lado que el suelo bajo los pies.
 */

/** Radio de lo que se DIBUJA. Poco mas de un kilometro: cuatro celdas a la redonda. */
export const RADIO_RENDER_POR_DEFECTO = 1100;

/**
 * Radio de lo que COLISIONA. Siempre mayor que el de render.
 *
 * No es un margen de cortesia. Si el mundo de fisicas acabara donde acaba lo
 * que se ve, el coche llegaria al borde justo cuando la celda de delante aun
 * no ha bajado, y se caeria por un agujero que ademas no se ve venir. Con el
 * colchon, cuando pisas el ultimo suelo dibujado llevas ya una celda larga de
 * suelo invisible por delante.
 *
 * El precio es bajo: las celdas del anillo de mas se descargan, se decodifican
 * y dan cascos convexos, pero no producen ni un triangulo ni una llamada de
 * dibujo.
 */
export const RADIO_FISICA_POR_DEFECTO = 1500;

/**
 * Los dos radios del streaming, con su invariante comprobada.
 *
 * @param {Object} [opciones]
 * @param {number} [opciones.render]
 * @param {number} [opciones.fisica]
 * @returns {{render: number, fisica: number}}
 */
export function radiosDeStreaming(opciones = {}) {
  const { render = RADIO_RENDER_POR_DEFECTO, fisica = RADIO_FISICA_POR_DEFECTO } = opciones;

  for (const [nombre, valor] of [['render', render], ['fisica', fisica]]) {
    if (!(Number.isFinite(valor) && valor > 0)) {
      throw new RangeError(`radiosDeStreaming: el radio de \`${nombre}\` debe ser positivo, y es ${valor}`);
    }
  }
  if (!(fisica > render)) {
    throw new RangeError(
      `radiosDeStreaming: el radio de \`fisica\` (${fisica}) debe ser MAYOR que el de \`render\` (${render}); ` +
        'si no, se conduce hasta el borde del mundo de colisiones y se cae por el',
    );
  }

  return Object.freeze({ render, fisica });
}

/**
 * Distancia de un punto proyectado a la caja de una celda. Cero si esta dentro.
 *
 * @param {{este: number, norte: number}} punto
 * @param {{origen: {este: number, norte: number}}} celda
 * @param {number} ladoCeldaMetros
 * @returns {number} Metros
 */
export function distanciaACelda(punto, celda, ladoCeldaMetros) {
  const fueraEste = Math.max(
    celda.origen.este - punto.este,
    0,
    punto.este - (celda.origen.este + ladoCeldaMetros),
  );
  const fueraNorte = Math.max(
    celda.origen.norte - punto.norte,
    0,
    punto.norte - (celda.origen.norte + ladoCeldaMetros),
  );
  return Math.hypot(fueraEste, fueraNorte);
}

/**
 * Claves de las celdas que caen dentro del radio, de la mas cercana a la mas
 * lejana. El orden es el que decide que se ve antes al aterrizar.
 *
 * @param {Array<{clave: string, origen: {este: number, norte: number}}>} celdas  Del indice
 * @param {{este: number, norte: number}} punto
 * @param {number} radioMetros
 * @param {number} ladoCeldaMetros
 * @returns {string[]}
 */
export function celdasEnRadio(celdas, punto, radioMetros, ladoCeldaMetros) {
  if (!(Number.isFinite(radioMetros) && radioMetros > 0)) {
    throw new RangeError('celdasEnRadio: el `radio` debe ser un numero positivo de metros');
  }

  return celdas
    .map((celda) => ({ clave: celda.clave, distancia: distanciaACelda(punto, celda, ladoCeldaMetros) }))
    .filter((candidata) => candidata.distancia <= radioMetros)
    .sort((a, b) => a.distancia - b.distancia)
    .map((candidata) => candidata.clave);
}

/**
 * Diferencia entre lo que deberia estar en escena y lo que esta.
 *
 * @param {string[]} deseadas   Claves, ya ordenadas por cercania
 * @param {Set<string>} cargadas
 * @returns {{cargar: string[], descargar: string[]}}
 */
export function planDeCarga(deseadas, cargadas) {
  const objetivo = new Set(deseadas);

  return {
    // Se conserva el orden de cercania: lo que tienes debajo entra primero.
    cargar: deseadas.filter((clave) => !cargadas.has(clave)),
    descargar: [...cargadas].filter((clave) => !objetivo.has(clave)),
  };
}
