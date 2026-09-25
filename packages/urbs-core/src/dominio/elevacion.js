/**
 * Malla de elevacion: el relieve, antes de trocearlo en celdas.
 *
 * Es una rejilla regular de cotas en metros con su rectangulo geografico, y
 * sabe hacer una sola cosa: decir a que altura esta un punto. Vive en el
 * dominio y sin dependencias porque la llena un proveedor en Node y la consulta
 * el pipeline, igual que pasa con el formato de celda.
 *
 * Dos decisiones que parecen detalles y no lo son:
 *
 * 1. FUERA DE LA MALLA SE DEVUELVE `null`, NUNCA CERO. En este dato el cero
 *    significa "nivel del mar", asi que devolverlo cuando lo que pasa es que no
 *    hay dato inunda de oceano todo lo que caiga fuera del recorte. "No lo se"
 *    y "hay agua" son cosas distintas y aqui no se mezclan jamas.
 * 2. SE INTERPOLA. El MDT del PNOA servido por WCS viene en METROS ENTEROS:
 *    un escalon de 1 m sobre una rejilla de 5 m son once grados de pendiente
 *    falsa, y eso se ve aterrazado y se conduce peor. La bilineal no inventa
 *    relieve, reparte el que ya hay.
 *
 * La fila 0 es la del NORTE, como en un GeoTIFF: se recorre de arriba abajo.
 */

/**
 * Cota del mar, en metros.
 *
 * No es un convenio nuestro: el MDT del PNOA da alturas ortometricas sobre el
 * nivel medio del mar, asi que el agua sale como cero exacto. Comprobado sobre
 * tres recortes reales de A Coruna — en el recorte interior no hay ni un pixel
 * a cero, asi que el cero no es un relleno de "sin dato", es el mar.
 */
export const NIVEL_DEL_MAR = 0;

/**
 * Si una cota es agua.
 *
 * Una cota DESCONOCIDA no es mar. Es la diferencia entre "aqui hay agua" y
 * "aqui no tengo dato", y confundirlas es como se inunda una ciudad entera por
 * haber pedido mal un recorte.
 *
 * @param {number|null|undefined} cota
 * @returns {boolean}
 */
export function esMar(cota) {
  return typeof cota === 'number' && Number.isFinite(cota) && cota <= NIVEL_DEL_MAR;
}

/**
 * @typedef {Object} DatosMallaElevacion
 * @property {ArrayLike<number>} cotas  Metros, fila a fila y de norte a sur
 * @property {number} ancho            Columnas
 * @property {number} alto             Filas
 * @property {{lon: number, lat: number}} noroeste  Centro del pixel (0, 0)
 * @property {{lon: number, lat: number}} paso      Grados por pixel, positivos
 */

/**
 * @param {DatosMallaElevacion} datos
 */
export function crearMallaElevacion({ cotas, ancho, alto, noroeste, paso }) {
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho < 1 || alto < 1) {
    throw new RangeError(
      `crearMallaElevacion: \`ancho\` y \`alto\` deben ser enteros positivos, y son ${ancho}x${alto}`,
    );
  }
  if (cotas === null || typeof cotas !== 'object' || cotas.length < ancho * alto) {
    throw new RangeError(
      `crearMallaElevacion: hacen falta ${ancho * alto} \`cotas\` y hay ${cotas?.length ?? 0}`,
    );
  }
  if (!(paso?.lon > 0) || !(paso?.lat > 0)) {
    throw new RangeError(
      'crearMallaElevacion: el `paso` en grados debe ser positivo en los dos ejes; el sentido lo fija `noroeste`',
    );
  }
  if (!Number.isFinite(noroeste?.lon) || !Number.isFinite(noroeste?.lat)) {
    throw new TypeError('crearMallaElevacion: `noroeste` debe ser un punto {lon, lat}');
  }

  const lonMin = noroeste.lon;
  const lonMax = noroeste.lon + (ancho - 1) * paso.lon;
  const latMax = noroeste.lat;
  const latMin = noroeste.lat - (alto - 1) * paso.lat;

  let minima = Infinity;
  let maxima = -Infinity;
  for (let i = 0; i < ancho * alto; i += 1) {
    const cota = cotas[i];
    if (cota < minima) minima = cota;
    if (cota > maxima) maxima = cota;
  }

  const limites = Object.freeze({ lonMin, latMin, lonMax, latMax });

  /**
   * @param {number} columna
   * @param {number} fila
   * @returns {number}
   */
  function enRejilla(columna, fila) {
    return cotas[fila * ancho + columna];
  }

  return Object.freeze({
    ancho,
    alto,
    paso: Object.freeze({ ...paso }),
    limites,
    cotaMinima: minima,
    cotaMaxima: maxima,

    /**
     * Cota de un punto, en metros, o `null` si cae fuera.
     *
     * @param {number} lon
     * @param {number} lat
     * @returns {number|null}
     */
    cota(lon, lat) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
      }
      if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) {
        return null;
      }

      // Posicion en unidades de pixel. La latitud va al reves que la fila.
      const x = (lon - lonMin) / paso.lon;
      const y = (latMax - lat) / paso.lat;

      const columna = Math.min(Math.floor(x), ancho - 1);
      const fila = Math.min(Math.floor(y), alto - 1);
      const columnaSiguiente = Math.min(columna + 1, ancho - 1);
      const filaSiguiente = Math.min(fila + 1, alto - 1);

      const fx = x - columna;
      const fy = y - fila;

      const arribaIzquierda = enRejilla(columna, fila);
      const arribaDerecha = enRejilla(columnaSiguiente, fila);
      const abajoIzquierda = enRejilla(columna, filaSiguiente);
      const abajoDerecha = enRejilla(columnaSiguiente, filaSiguiente);

      const arriba = arribaIzquierda + (arribaDerecha - arribaIzquierda) * fx;
      const abajo = abajoIzquierda + (abajoDerecha - abajoIzquierda) * fx;
      return arriba + (abajo - arriba) * fy;
    },
  });
}
