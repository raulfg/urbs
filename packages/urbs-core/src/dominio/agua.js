/**
 * De dónde sale el agua: la máscara, y por qué es enchufable.
 *
 * La primera version de esto daba por hecho que el mar del MDT es cero exacto.
 * Es FALSO como regla del producto, y se midio contando pixeles sobre hojas
 * reales del MDT02:
 *
 * - Hoja 0021 cuadrante 3 (Ciudad Vieja, Pescaderia, Orzan): el mar se pega a
 *   0,00 y el 99,926% de los ceros forman UNA sola mancha pegada al borde. Ahi
 *   un umbral funciona casi perfecto.
 * - Hoja 0021 cuadrante 2, la de al lado hacia Oleiros: solo CUATRO pixeles
 *   valen cero exacto. El mar abierto vuelve como ruido LiDAR crudo entre
 *   -0,89 y +1,4 m.
 *
 * O sea que la estrategia que vale para una hoja no vale para la siguiente, y
 * cablear `cota === 0` habria dejado Oleiros sin una gota de mar sin que nadie
 * se enterara. Por eso el umbral es un PARAMETRO y la estrategia es una pieza
 * que se cambia: donde la hoja no se deje, habra que cerrar la linea de costa
 * de OSM contra la celda, que es el otro camino y es mas caro.
 *
 * Dos reglas que no se negocian, las dos aprendidas a base de medir:
 *
 * 1. `SIN_DATO` (-32767) NO es agua. Significa "no producido". Es el numero mas
 *    bajo de la escala, asi que un filtro de "esto esta bajo" lo traga entero.
 * 2. Estar bajo NO basta: el mar se reconoce porque SALE del recorte. Un umbral
 *    a secas convierte en oceano cualquier plaza, patio o error de vuelo que
 *    quede a cota baja. Por eso se propaga desde el borde.
 */

import { SIN_DATO } from './elevacion.js';

/**
 * Umbral de reserva, en metros. NO es una calibracion: es un ultimo recurso.
 *
 * EL VALOR BUENO LO DECLARA EL TERRITORIO, no este paquete. La regla fundacional
 * de `urbs-core` es que nunca sabe de que pais come, y "a que cota deja de haber
 * agua" es justo el tipo de saber local que la rompe: depende de la altura de
 * los muelles, de si hay marea, de si es un delta o un polder. Un numero
 * afinado contra los muelles de A Coruna ahogaria Rotterdam.
 *
 * Se deja un cero conservador para que la funcion siga siendo usable suelta y
 * para que, si alguien se olvida de declararlo, el fallo sea "falta agua" —
 * visible al instante— y no "sobra agua", que inunda calles sin avisar.
 */
export const UMBRAL_AGUA_DE_RESERVA = 0;

/**
 * Máscara de agua de una malla de elevación.
 *
 * @param {ReturnType<import('./elevacion.js').crearMallaElevacion>} malla
 * @param {Object} [opciones]
 * @param {number} [opciones.umbral]            Metros; por debajo o igual es candidato
 * @param {boolean} [opciones.soloDesdeElBorde] Exigir que la mancha salga del recorte
 * @returns {{mascara: Uint8Array, pixelesDeAgua: number}}
 */
export function mascaraDeAguaPorUmbral(malla, opciones = {}) {
  const { umbral = UMBRAL_AGUA_DE_RESERVA, soloDesdeElBorde = true } = opciones;

  if (!Number.isFinite(umbral)) {
    throw new RangeError(
      `mascaraDeAguaPorUmbral: el \`umbral\` debe ser un numero de metros, y es ${umbral}`,
    );
  }

  const { ancho, alto } = malla;
  const total = ancho * alto;
  const mascara = new Uint8Array(total);

  /** Candidato: bajo el umbral Y con dato. El centinela nunca pasa de aqui. */
  const esCandidato = (i) => {
    const cota = malla.cotaEnRejilla(i);
    return cota !== SIN_DATO && Number.isFinite(cota) && cota <= umbral;
  };

  if (!soloDesdeElBorde) {
    let cuenta = 0;
    for (let i = 0; i < total; i += 1) {
      if (esCandidato(i)) {
        mascara[i] = 1;
        cuenta += 1;
      }
    }
    return { mascara, pixelesDeAgua: cuenta };
  }

  // Propagacion desde el borde, con cuatro vecinos y no ocho. Con ocho, dos
  // masas que solo se tocan por una esquina se funden, y el mar se cuela al
  // otro lado de un espigon por un unico pixel en diagonal.
  const pila = [];
  const encolarSiProcede = (i) => {
    if (mascara[i] === 0 && esCandidato(i)) {
      mascara[i] = 1;
      pila.push(i);
    }
  };

  for (let x = 0; x < ancho; x += 1) {
    encolarSiProcede(x);
    encolarSiProcede((alto - 1) * ancho + x);
  }
  for (let y = 0; y < alto; y += 1) {
    encolarSiProcede(y * ancho);
    encolarSiProcede(y * ancho + ancho - 1);
  }

  let cuenta = pila.length;
  while (pila.length > 0) {
    const i = pila.pop();
    const x = i % ancho;
    const y = (i - x) / ancho;

    const vecinos = [];
    if (x > 0) vecinos.push(i - 1);
    if (x < ancho - 1) vecinos.push(i + 1);
    if (y > 0) vecinos.push(i - ancho);
    if (y < alto - 1) vecinos.push(i + ancho);

    for (const vecino of vecinos) {
      if (mascara[vecino] === 0 && esCandidato(vecino)) {
        mascara[vecino] = 1;
        cuenta += 1;
        pila.push(vecino);
      }
    }
  }

  return { mascara, pixelesDeAgua: cuenta };
}
