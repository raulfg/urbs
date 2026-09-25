/**
 * Procedencia de un valor del dominio.
 *
 * Esta es la pieza que hace visible la degradacion en vez de silenciarla.
 * Una altura de 12 metros medida con LiDAR y una altura de 12 metros estimada
 * a partir del numero de plantas valen lo mismo para extruir, pero NO valen
 * lo mismo para decidir si confiamos en ella. El dominio guarda las dos cosas:
 * el valor y de donde ha salido.
 */

/**
 * Nivel de confianza de un valor segun como se haya obtenido.
 * - medido:    procede de una medicion fisica (LiDAR, fotogrametria)
 * - declarado: lo afirma una fuente oficial o una etiqueta explicita
 * - estimado:  lo ha deducido URBS a partir de otros datos
 */
export const Confianza = Object.freeze({
  MEDIDO: 'medido',
  DECLARADO: 'declarado',
  ESTIMADO: 'estimado',
});

const CONFIANZAS_VALIDAS = new Set(Object.values(Confianza));

/**
 * @typedef {Object} Procedencia
 * @property {string} proveedor  Identificador del proveedor que aporto el valor
 * @property {string} confianza  Uno de los valores de `Confianza`
 * @property {string} [nota]     Explicacion opcional de como se estimo
 */

/**
 * @param {{proveedor: string, confianza: string, nota?: string}} datos
 * @returns {Procedencia}
 */
export function crearProcedencia({ proveedor, confianza, nota }) {
  if (typeof proveedor !== 'string' || proveedor.length === 0) {
    throw new TypeError('crearProcedencia: `proveedor` debe ser una cadena no vacia');
  }
  if (!CONFIANZAS_VALIDAS.has(confianza)) {
    throw new RangeError(
      `crearProcedencia: confianza desconocida "${confianza}". Validas: ${[...CONFIANZAS_VALIDAS].join(', ')}`,
    );
  }

  return Object.freeze({ proveedor, confianza, nota });
}
