/**
 * Contratos de proveedor: los puertos del motor.
 *
 * URBS no sabe que es el Catastro ni que es OSM. Solo sabe pedir cuatro cosas
 * a alguien que prometa saber darlas: edificios, viario, relieve y suelo.
 * Quien las da, y con que calidad, es intercambiable por territorio.
 *
 * En JavaScript vanilla una "interfaz" es una promesa que nadie comprueba.
 * Por eso aqui la promesa se comprueba: `validarProveedor` falla en el momento
 * del registro, con un mensaje claro, en vez de reventar tres horas despues
 * en mitad del preprocesado.
 */

/** Capas que el motor sabe pedir. */
export const Capa = Object.freeze({
  EDIFICIOS: 'edificios',
  VIARIO: 'viario',
  RELIEVE: 'relieve',
  SUELO: 'suelo',
});

const CAPAS_VALIDAS = new Set(Object.values(Capa));

/**
 * Metodo obligatorio que cada capa exige al proveedor que la sirve.
 * Es el nombre de la funcion que el motor va a llamar.
 */
const METODO_POR_CAPA = Object.freeze({
  [Capa.EDIFICIOS]: 'obtenerEdificios',
  [Capa.VIARIO]: 'obtenerViario',
  [Capa.RELIEVE]: 'obtenerRelieve',
  [Capa.SUELO]: 'obtenerSuelo',
});

/**
 * Atribucion legal de una fuente. El motor las agrega automaticamente segun
 * los proveedores que hayan participado en la generacion, para que la pantalla
 * de creditos no dependa de que alguien se acuerde de actualizarla.
 *
 * @typedef {Object} Atribucion
 * @property {string} fuente
 * @property {string} licencia
 * @property {string} texto    Texto exacto que debe aparecer en creditos
 * @property {string} [url]
 */

/**
 * @typedef {Object} Proveedor
 * @property {string} id                 Identificador unico, ej. "osm" o "catastro-inspire"
 * @property {string} capa               Una de las capas de `Capa`
 * @property {number} prioridad          A mayor numero, antes se intenta
 * @property {(area: import('../dominio/area.js').Area) => boolean} cubre
 *           Responde si el proveedor tiene datos para esa area. Es lo que
 *           permite que Catastro diga "yo solo Espana" sin que el core lo sepa.
 * @property {() => Atribucion} atribucion
 */

/**
 * Comprueba que un objeto cumple el contrato de proveedor.
 * Lanza con un mensaje accionable si no.
 *
 * @param {Proveedor} proveedor
 * @returns {Proveedor} El mismo proveedor, si es valido
 */
export function validarProveedor(proveedor) {
  if (proveedor === null || typeof proveedor !== 'object') {
    throw new TypeError('validarProveedor: se esperaba un objeto proveedor');
  }

  const { id, capa } = proveedor;

  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('validarProveedor: `id` debe ser una cadena no vacia');
  }
  if (!CAPAS_VALIDAS.has(capa)) {
    throw new RangeError(
      `validarProveedor: el proveedor "${id}" declara la capa "${capa}", que no existe. Validas: ${[...CAPAS_VALIDAS].join(', ')}`,
    );
  }
  if (!Number.isFinite(proveedor.prioridad)) {
    throw new TypeError(
      `validarProveedor: el proveedor "${id}" debe declarar una \`prioridad\` numerica`,
    );
  }
  if (typeof proveedor.cubre !== 'function') {
    throw new TypeError(
      `validarProveedor: el proveedor "${id}" debe implementar \`cubre(area)\`. Sin eso el motor no puede degradar a otra fuente.`,
    );
  }
  if (typeof proveedor.atribucion !== 'function') {
    throw new TypeError(
      `validarProveedor: el proveedor "${id}" debe implementar \`atribucion()\`. Las licencias de las fuentes son obligatorias.`,
    );
  }

  const metodo = METODO_POR_CAPA[capa];
  if (typeof proveedor[metodo] !== 'function') {
    throw new TypeError(
      `validarProveedor: el proveedor "${id}" sirve la capa "${capa}", asi que debe implementar \`${metodo}(area)\``,
    );
  }

  return proveedor;
}

/**
 * Nombre del metodo que sirve una capa dada.
 * @param {string} capa
 * @returns {string}
 */
export function metodoDeCapa(capa) {
  const metodo = METODO_POR_CAPA[capa];
  if (metodo === undefined) {
    throw new RangeError(`metodoDeCapa: capa desconocida "${capa}"`);
  }
  return metodo;
}
