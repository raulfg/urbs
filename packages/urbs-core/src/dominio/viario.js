/**
 * Viario: el grafo de calles.
 *
 * Es la unica capa sin degradacion posible, porque su fuente es OSM en todo
 * el mundo. Alimenta tanto la geometria del asfalto como el pathfinding del
 * trafico con IA.
 */

/**
 * Tipo de via, tomado del esquema `highway` de OSM y reducido a lo que el
 * motor necesita para decidir anchura, velocidad y si admite trafico.
 */
export const TipoVia = Object.freeze({
  AUTOPISTA: 'autopista',
  PRIMARIA: 'primaria',
  SECUNDARIA: 'secundaria',
  LOCAL: 'local',
  RESIDENCIAL: 'residencial',
  PEATONAL: 'peatonal',
  SERVICIO: 'servicio',
});

const TIPOS_VALIDOS = new Set(Object.values(TipoVia));

/**
 * Anchura estimada en metros cuando la fuente no declara `width`.
 * Se usa solo como ultimo recurso: primero `width`, luego `lanes`, y si no,
 * esta tabla.
 */
export const ANCHURA_POR_TIPO = Object.freeze({
  [TipoVia.AUTOPISTA]: 14,
  [TipoVia.PRIMARIA]: 12,
  [TipoVia.SECUNDARIA]: 10,
  [TipoVia.LOCAL]: 8,
  [TipoVia.RESIDENCIAL]: 6,
  [TipoVia.PEATONAL]: 4,
  [TipoVia.SERVICIO]: 4,
});

/** Anchura de un carril en metros, para estimar a partir de `lanes`. */
export const ANCHURA_CARRIL = 3;

/**
 * @typedef {Object} Tramo
 * @property {string} id
 * @property {Array<[number, number]>} eje  Polilinea [lon, lat] del eje de la via
 * @property {string} tipo                  Uno de los valores de `TipoVia`
 * @property {number} anchuraMetros
 * @property {number|null} carriles
 * @property {boolean} sentidoUnico
 * @property {string|null} nombre
 * @property {import('./procedencia.js').Procedencia} procedencia
 */

/**
 * @param {Object} datos
 * @returns {Tramo}
 */
export function crearTramo({
  id,
  eje,
  tipo,
  anchuraMetros,
  carriles = null,
  sentidoUnico = false,
  nombre = null,
  procedencia,
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('crearTramo: `id` debe ser una cadena no vacia');
  }
  if (!Array.isArray(eje) || eje.length < 2) {
    throw new TypeError('crearTramo: `eje` necesita al menos dos posiciones');
  }
  if (!TIPOS_VALIDOS.has(tipo)) {
    throw new RangeError(`crearTramo: tipo de via desconocido "${tipo}"`);
  }
  if (!(Number.isFinite(anchuraMetros) && anchuraMetros > 0)) {
    throw new RangeError('crearTramo: `anchuraMetros` debe ser un numero positivo');
  }
  if (!procedencia) {
    throw new TypeError('crearTramo: todo tramo debe declarar su procedencia');
  }

  return Object.freeze({
    id,
    eje: Object.freeze(eje),
    tipo,
    anchuraMetros,
    carriles,
    sentidoUnico,
    nombre,
    procedencia,
  });
}

/**
 * Resuelve la anchura de una via aplicando la cascada acordada:
 * `width` declarado, si no `lanes` por anchura de carril, si no el tipo.
 *
 * @param {{anchuraDeclarada?: number|null, carriles?: number|null, tipo: string}} datos
 * @returns {{anchuraMetros: number, confianza: string}}
 */
export function resolverAnchura({ anchuraDeclarada = null, carriles = null, tipo }) {
  if (Number.isFinite(anchuraDeclarada) && anchuraDeclarada > 0) {
    return { anchuraMetros: anchuraDeclarada, confianza: 'declarado' };
  }
  if (Number.isInteger(carriles) && carriles > 0) {
    return { anchuraMetros: carriles * ANCHURA_CARRIL, confianza: 'estimado' };
  }
  const porTipo = ANCHURA_POR_TIPO[tipo];
  if (porTipo === undefined) {
    throw new RangeError(`resolverAnchura: tipo de via desconocido "${tipo}"`);
  }
  return { anchuraMetros: porTipo, confianza: 'estimado' };
}
