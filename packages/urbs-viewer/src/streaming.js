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
