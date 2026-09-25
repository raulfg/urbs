/**
 * Que es agua en ESTE territorio, decidido una sola vez y con todo delante.
 *
 * Por que no se decide en el visor, celda a celda: porque **estar por debajo de
 * la cota del agua no basta para ser agua**. Hay tierra bajo esa cota por
 * motivos que no tienen nada que ver con el mar — una trinchera de carretera, un
 * dique seco, una rampa de aparcamiento, una excavacion. Medido sobre la hoja
 * real de A Coruna: 46.690 pixeles, DIECIOCHO HECTAREAS Y MEDIA, estan bajo el
 * umbral y no tienen salida al mar. Un umbral a secas las inunda todas.
 *
 * Lo que distingue el mar de un socavon es que el mar SALE del territorio. Por
 * eso la mascara se propaga desde el borde. Y por eso no puede calcularse por
 * celda: el borde de una celda de 250 m no es el borde del mundo, asi que una
 * ria que entra por el oeste quedaria cortada en la primera celda y el resto
 * pasaria por depresion interior.
 *
 * Se calcula al PASO DE LA MALLA y no al del MDT: decidir si una mancha sale al
 * mar no necesita 2 m, y a 10 m el territorio entero cabe en una rejilla de
 * pocos cientos de miles de postes en vez de treinta millones.
 */

import { crearMallaElevacion, mascaraDeAguaPorUmbral } from 'urbs-core';

/**
 * @typedef {Object} MascaraDeTerritorio
 * @property {(este: number, norte: number) => boolean} esAgua
 * @property {number} postesDeAgua
 * @property {number} postes
 */

/**
 * @param {Object} datos
 * @param {{malla: (caja: object) => Promise<object|null>}} datos.fuente
 * @param {{esteMin: number, esteMax: number, norteMin: number, norteMax: number}} datos.limites
 * @param {number} datos.paso
 * @param {number} datos.umbral
 * @returns {Promise<MascaraDeTerritorio|null>}
 */
export async function mascaraDeAguaDeTerritorio({ fuente, limites, paso, umbral }) {
  if (!(Number.isFinite(paso) && paso > 0)) {
    throw new RangeError(`mascaraDeAguaDeTerritorio: el \`paso\` debe ser positivo, y es ${paso}`);
  }
  if (!Number.isFinite(umbral)) {
    throw new RangeError(
      `mascaraDeAguaDeTerritorio: el \`umbral\` debe ser un numero de metros, y es ${umbral}`,
    );
  }

  const fina = await fuente.malla(limites);
  if (fina === null) {
    return null;
  }

  const ancho = Math.round((limites.esteMax - limites.esteMin) / paso) + 1;
  const alto = Math.round((limites.norteMax - limites.norteMin) / paso) + 1;
  const cotas = new Float32Array(ancho * alto);

  for (let fila = 0; fila < alto; fila += 1) {
    // Fila 0 al norte, como en todo lo demas.
    const norte = limites.norteMax - fila * paso;
    for (let columna = 0; columna < ancho; columna += 1) {
      const cota = fina.cota(limites.esteMin + columna * paso, norte);
      // Sin dato NO es agua, asi que se pone por encima del umbral para que la
      // propagacion no lo atraviese. Ver `SIN_DATO` en el dominio.
      cotas[fila * ancho + columna] = cota === null ? umbral + 1000 : cota;
    }
  }

  const rejilla = crearMallaElevacion({
    cotas,
    ancho,
    alto,
    noroeste: { este: limites.esteMin, norte: limites.norteMax },
    paso: { este: paso, norte: paso },
  });
  const { mascara, pixelesDeAgua } = mascaraDeAguaPorUmbral(rejilla, { umbral });

  return Object.freeze({
    postesDeAgua: pixelesDeAgua,
    postes: ancho * alto,

    /**
     * @param {number} este
     * @param {number} norte
     * @returns {boolean}
     */
    esAgua(este, norte) {
      const columna = Math.round((este - limites.esteMin) / paso);
      const fila = Math.round((limites.norteMax - norte) / paso);
      if (columna < 0 || columna >= ancho || fila < 0 || fila >= alto) {
        // Fuera del territorio no se sabe, y "no se" no es agua: inventar mar
        // en el borde meteria oceano dentro de la ultima fila de celdas.
        return false;
      }
      return mascara[fila * ancho + columna] === 1;
    },
  });
}
