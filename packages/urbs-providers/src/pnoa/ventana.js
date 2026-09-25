/**
 * De una caja en metros a una ventana de pixeles, y vuelta.
 *
 * Aritmetica pura, sin fichero y sin librerias, porque aqui es donde viven los
 * errores de uno: el desfase de media celda entre la esquina del GeoTIFF y el
 * centro del pixel, el norte que crece al reves que la fila, y el margen que
 * necesita la bilineal. Ninguno de los tres se ve mirando la pantalla — salen
 * como un relieve plausible pero desplazado, o reflejado, o con costuras entre
 * celdas.
 *
 * Por que ventanas y no la hoja entera: un cuadrante del MDT02 son 6835x4725
 * pixeles en float32, unos 60 MB en disco y 129 MB en memoria si se descomprime
 * del tiron. Con teselas de 512 y COG, leer la ventana de una celda cuesta
 * milisegundos y unos pocos megas. Cargar la hoja entera para quedarse con
 * 250 m funciona con una celda y muere con las 3.000 que pide el territorio
 * completo.
 */

/**
 * Pixeles de margen alrededor de la caja pedida.
 *
 * La bilineal necesita un vecino a cada lado. Sin el, el pixel del borde de una
 * celda interpola contra si mismo y aparece una costura entre celdas contiguas
 * que ademas cambia segun lo que este cargado.
 */
export const MARGEN_VENTANA = 1;

/**
 * @typedef {Object} GeometriaDeHoja
 * @property {{este: number, norte: number}} origen  Esquina EXTERIOR noroeste
 * @property {{este: number, norte: number}} paso    Metros por pixel, positivos
 * @property {number} ancho
 * @property {number} alto
 */

/**
 * @param {GeometriaDeHoja} hoja
 */
function exigirHoja(hoja) {
  if (!(hoja?.paso?.este > 0) || !(hoja?.paso?.norte > 0)) {
    throw new RangeError('ventanaDeCaja: el `paso` de la hoja debe ser positivo en los dos ejes');
  }
  return hoja;
}

/**
 * Ventana de pixeles que cubre una caja, con margen y recortada a la hoja.
 *
 * Los limites derecho e inferior son EXCLUSIVOS, que es lo que espera
 * `readRasters({ window })`.
 *
 * @param {GeometriaDeHoja} hoja
 * @param {{esteMin: number, esteMax: number, norteMin: number, norteMax: number}} caja
 * @returns {{izquierda: number, arriba: number, derecha: number, abajo: number}|null}
 */
export function ventanaDeCaja(hoja, caja) {
  const { origen, paso, ancho, alto } = exigirHoja(hoja);

  if (!(caja?.esteMax >= caja?.esteMin) || !(caja?.norteMax >= caja?.norteMin)) {
    throw new RangeError(
      `ventanaDeCaja: la \`caja\` esta invertida (${caja?.esteMin}..${caja?.esteMax}, ${caja?.norteMin}..${caja?.norteMax})`,
    );
  }

  // El norte crece hacia arriba y la fila hacia abajo: por eso el maximo norte
  // da la fila menor.
  let izquierda = Math.floor((caja.esteMin - origen.este) / paso.este) - MARGEN_VENTANA;
  let derecha = Math.ceil((caja.esteMax - origen.este) / paso.este) + MARGEN_VENTANA;
  let arriba = Math.floor((origen.norte - caja.norteMax) / paso.norte) - MARGEN_VENTANA;
  let abajo = Math.ceil((origen.norte - caja.norteMin) / paso.norte) + MARGEN_VENTANA;

  izquierda = Math.max(0, izquierda);
  arriba = Math.max(0, arriba);
  derecha = Math.min(ancho, derecha);
  abajo = Math.min(alto, abajo);

  if (derecha <= izquierda || abajo <= arriba) {
    return null;
  }

  return { izquierda, arriba, derecha, abajo };
}

/**
 * Centro del primer pixel de una ventana, en metros.
 *
 * El GeoTIFF ancla en la ESQUINA exterior y la malla muestrea por CENTROS: hay
 * media celda de diferencia. Con pixeles de 2 m es un metro, de sobra para
 * dejar una fachada colgando en el aire o enterrada hasta el primer piso.
 *
 * @param {GeometriaDeHoja} hoja
 * @param {{izquierda: number, arriba: number}} ventana
 * @returns {{este: number, norte: number}}
 */
export function noroesteDeVentana(hoja, ventana) {
  const { origen, paso } = exigirHoja(hoja);
  return {
    este: origen.este + ventana.izquierda * paso.este + paso.este / 2,
    norte: origen.norte - ventana.arriba * paso.norte - paso.norte / 2,
  };
}
