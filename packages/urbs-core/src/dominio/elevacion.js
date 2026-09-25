/**
 * Malla de elevacion: el relieve, antes de trocearlo en celdas.
 *
 * Es una rejilla regular de cotas en metros con su rectangulo, y sabe hacer una
 * sola cosa: decir a que altura esta un punto. Vive en el dominio y sin
 * dependencias porque la llena un proveedor en Node y la consulta el pipeline,
 * igual que pasa con el formato de celda.
 *
 * Los ejes son ESTE y NORTE en metros proyectados, no grados. El MDT02 del
 * PNOA-LiDAR se publica por hojas en UTM —la de A Coruna en ETRS89 / UTM 29N,
 * que es justo el sistema en el que ya trabaja el territorio—, asi que no hay
 * ninguna reproyeccion que hacer: entra en los mismos metros en los que se
 * trocea la ciudad.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 * 1. FUERA DE LA MALLA SE DEVUELVE `null`, NUNCA UNA COTA. "No lo se" y "esta a
 *    esta altura" son cosas distintas, y la de arriba se propaga.
 * 2. EL CENTINELA NO SE INTERPOLA. Ver `SIN_DATO`.
 * 3. SE INTERPOLA LO DEMAS. Sin bilineal, un escalon de la rejilla se convierte
 *    en un peldano de verdad: se ve aterrazado y se conduce peor. Interpolar no
 *    inventa relieve, reparte el que ya hay.
 *
 * La fila 0 es la del NORTE, como en un GeoTIFF: se recorre de arriba abajo.
 */

/**
 * Centinela de "no producido" del MDT del PNOA.
 *
 * NO significa agua. Significa que el vuelo no cubrio ese pixel o que el dato
 * se descarto. Es la trampa mas cara de todo este dato: al ser el numero mas
 * bajo de la escala, cualquier filtro ingenuo de "esto esta bajo, sera mar"
 * convierte todos los huecos del vuelo en oceano. Y al interpolar, un solo
 * vecino con este valor abre un pozo de treinta y dos kilometros.
 */
export const SIN_DATO = -32767;

/**
 * Si una cota es un valor util.
 *
 * "No lo se" y "aqui hay agua" son cosas distintas y aqui no se mezclan jamas.
 * Quien decida que es agua es `mascaraDeAguaPorUmbral`, no esto.
 *
 * @param {number|null|undefined} cota
 * @returns {boolean}
 */
export function hayDato(cota) {
  return typeof cota === 'number' && Number.isFinite(cota) && cota !== SIN_DATO;
}

/**
 * @typedef {Object} DatosMallaElevacion
 * @property {ArrayLike<number>} cotas  Metros, fila a fila y de norte a sur
 * @property {number} ancho            Columnas
 * @property {number} alto             Filas
 * @property {{este: number, norte: number}} noroeste  Centro del pixel (0, 0)
 * @property {{este: number, norte: number}} paso      Metros por pixel, positivos
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
  if (!(paso?.este > 0) || !(paso?.norte > 0)) {
    throw new RangeError(
      'crearMallaElevacion: el `paso` en metros debe ser positivo en los dos ejes; el sentido lo fija `noroeste`',
    );
  }
  if (!Number.isFinite(noroeste?.este) || !Number.isFinite(noroeste?.norte)) {
    throw new TypeError('crearMallaElevacion: `noroeste` debe ser un punto {este, norte}');
  }

  const esteMin = noroeste.este;
  const esteMax = noroeste.este + (ancho - 1) * paso.este;
  const norteMax = noroeste.norte;
  const norteMin = noroeste.norte - (alto - 1) * paso.norte;

  // El centinela no cuenta para el rango: si contara, cualquier recorte con un
  // hueco de vuelo diria que su cota minima son -32.767 m.
  let minima = Infinity;
  let maxima = -Infinity;
  for (let i = 0; i < ancho * alto; i += 1) {
    const cota = cotas[i];
    if (cota === SIN_DATO) continue;
    if (cota < minima) minima = cota;
    if (cota > maxima) maxima = cota;
  }
  if (minima === Infinity) {
    minima = null;
    maxima = null;
  }

  const limites = Object.freeze({ esteMin, norteMin, esteMax, norteMax });

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
     * Cota cruda de un pixel por su indice, sin interpolar y sin filtrar.
     *
     * La usa la mascara de agua, que necesita ver el centinela para NO tragarselo.
     *
     * @param {number} indice
     * @returns {number}
     */
    cotaEnRejilla(indice) {
      return cotas[indice];
    },

    /**
     * Cota de un punto, en metros, o `null` si cae fuera.
     *
     * @param {number} este
     * @param {number} norte
     * @returns {number|null}
     */
    cota(este, norte) {
      if (!Number.isFinite(este) || !Number.isFinite(norte)) {
        return null;
      }
      if (este < esteMin || este > esteMax || norte < norteMin || norte > norteMax) {
        return null;
      }

      // Posicion en unidades de pixel. El norte va al reves que la fila.
      const x = (este - esteMin) / paso.este;
      const y = (norteMax - norte) / paso.norte;

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

      // Si alguna de las cuatro esquinas es el centinela, NO se interpola: se
      // devuelve "no lo se". Mezclar -32.767 en una media abre un pozo de
      // treinta kilometros que ademas se reparte por los pixeles de al lado.
      if (
        arribaIzquierda === SIN_DATO ||
        arribaDerecha === SIN_DATO ||
        abajoIzquierda === SIN_DATO ||
        abajoDerecha === SIN_DATO
      ) {
        return null;
      }

      const arriba = arribaIzquierda + (arribaDerecha - arribaIzquierda) * fx;
      const abajo = abajoIzquierda + (abajoDerecha - abajoIzquierda) * fx;
      return arriba + (abajo - arriba) * fy;
    },
  });
}
