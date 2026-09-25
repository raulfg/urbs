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
 * Como se apoya un vial respecto al terreno.
 *
 * No es un adorno para el render: es la diferencia entre una ciudad que se
 * puede conducir y una en la que te metes dentro de un puente. En cuanto haya
 * relieve, un vial a rasante muestrea el terreno vertice a vertice; hacer eso
 * con un puente lo pega al fondo de lo que cruza, y con un tunel entierra la
 * boca. Medido en el slice: 5.300 viales, 24 puentes y 81 tuneles.
 *
 * Es UN valor y no dos banderas porque un tramo no puede ser puente y tunel a
 * la vez, y quien dibuja necesita decidir con una sola pregunta.
 */
export const Estructura = Object.freeze({
  /** Sigue el terreno. La inmensa mayoria. */
  RASANTE: 'rasante',
  /** Salva un hueco: su cota se interpola entre los extremos, no se muestrea. */
  PUENTE: 'puente',
  /** Va por debajo. No forma parte de la superficie visible. */
  TUNEL: 'tunel',
});

const ESTRUCTURAS_VALIDAS = new Set(Object.values(Estructura));

/**
 * Tope de niveles admitidos, en valor absoluto.
 *
 * El maximo real medido en el slice es 5, y el minimo -2. Un `layer` de tres
 * cifras es un error de etiquetado, no un rascacielos de viaductos.
 */
export const NIVEL_MAXIMO = 10;

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
  estructura = Estructura.RASANTE,
  nivel = 0,
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
  if (!ESTRUCTURAS_VALIDAS.has(estructura)) {
    throw new RangeError(
      `crearTramo: estructura desconocida "${estructura}"; son ${[...ESTRUCTURAS_VALIDAS].join(', ')}`,
    );
  }
  if (!Number.isInteger(nivel) || Math.abs(nivel) > NIVEL_MAXIMO) {
    throw new RangeError(
      `crearTramo: el \`nivel\` debe ser un entero entre -${NIVEL_MAXIMO} y ${NIVEL_MAXIMO}, y es ${nivel}`,
    );
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
    estructura,
    nivel,
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
