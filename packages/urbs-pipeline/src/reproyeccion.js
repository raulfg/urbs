/**
 * Reproyeccion: de grados WGS84 a los metros del territorio.
 *
 * Los proveedores hablan en grados porque es lo unico que comparten todas las
 * fuentes del mundo. El dominio trabaja en metros proyectados. Esta es la
 * unica pieza que cruza esa frontera, y por eso es la unica de todo URBS que
 * depende de `proj4`.
 *
 * El EPSG NO se cablea: sale del territorio (`crearTerritorio` lo deduce con
 * `epsgRecomendado`), y de ahi se deriva la definicion de proj4. Que A Coruna
 * acabe en EPSG:25829 es una consecuencia de sus coordenadas, no una decision
 * escrita en ningun sitio.
 *
 * proj4 solo trae de fabrica EPSG:4326 y EPSG:3857, asi que los sistemas UTM
 * se registran aqui explicitamente antes de usarlos.
 */

import proj4 from 'proj4';

/** Sistema geografico de entrada. Viene incluido en proj4. */
export const EPSG_GEOGRAFICO = 4326;

/** Falso este de toda proyeccion UTM, en metros. */
export const FALSO_ESTE_UTM = 500000;

/** Grados de longitud que abarca una zona UTM. */
const GRADOS_POR_ZONA = 6;

/** Rangos de codigo EPSG que este pipeline sabe construir. */
const ETRS89_UTM_BASE = 25800;
const WGS84_UTM_NORTE_BASE = 32600;
const WGS84_UTM_SUR_BASE = 32700;
const ZONA_MINIMA = 1;
const ZONA_MAXIMA = 60;

/** Zonas UTM que cubre ETRS89, el datum europeo que usan Catastro y PNOA. */
const ZONA_ETRS89_MINIMA = 28;
const ZONA_ETRS89_MAXIMA = 38;

/**
 * @typedef {Object} PuntoGeografico
 * @property {number} lon  Longitud en grados WGS84
 * @property {number} lat  Latitud en grados WGS84
 */

/**
 * @typedef {Object} PuntoProyectado
 * @property {number} este   Metros en el eje X del sistema proyectado
 * @property {number} norte  Metros en el eje Y del sistema proyectado
 */

/**
 * @typedef {Object} Reproyector
 * @property {number} epsg
 * @property {string} nombre       Codigo tal y como lo registra proj4
 * @property {string} definicion   Cadena proj4 del sistema
 * @property {(punto: PuntoGeografico) => PuntoProyectado} aProyectado
 * @property {(punto: PuntoProyectado) => PuntoGeografico} aGeografico
 */

/**
 * Nombre con el que proj4 conoce un codigo EPSG.
 *
 * @param {number} epsg
 * @returns {string}
 */
export function nombreEpsg(epsg) {
  return `EPSG:${epsg}`;
}

/**
 * Meridiano central de una zona UTM, en grados. De aqui sale, por definicion,
 * que un punto sobre el se proyecte exactamente al falso este.
 *
 * @param {number} zona
 * @returns {number}
 */
export function meridianoCentral(zona) {
  return (zona - 1) * GRADOS_POR_ZONA - 180 + GRADOS_POR_ZONA / 2;
}

/**
 * @param {number} epsg
 * @param {number} base
 * @returns {number|null} Numero de zona, o null si el codigo no cae en el rango
 */
function zonaDelRango(epsg, base) {
  const zona = epsg - base;
  return zona >= ZONA_MINIMA && zona <= ZONA_MAXIMA ? zona : null;
}

/**
 * Definicion proj4 de un sistema proyectado, derivada de su codigo EPSG.
 *
 * Solo se cubren las familias UTM que `proyeccion.js` sabe recomendar. Un
 * codigo fuera de ellas falla aqui, en el arranque del preprocesado, en vez de
 * producir una ciudad desplazada kilometros sin que nadie se entere.
 *
 * @param {number} epsg
 * @returns {string}
 */
export function definicionProj4(epsg) {
  if (!Number.isInteger(epsg)) {
    throw new TypeError('definicionProj4: `epsg` debe ser un codigo entero');
  }

  const zonaEtrs89 = zonaDelRango(epsg, ETRS89_UTM_BASE);
  if (zonaEtrs89 !== null && zonaEtrs89 >= ZONA_ETRS89_MINIMA && zonaEtrs89 <= ZONA_ETRS89_MAXIMA) {
    return `+proj=utm +zone=${zonaEtrs89} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  }

  const zonaNorte = zonaDelRango(epsg, WGS84_UTM_NORTE_BASE);
  if (zonaNorte !== null) {
    return `+proj=utm +zone=${zonaNorte} +datum=WGS84 +units=m +no_defs`;
  }

  const zonaSur = zonaDelRango(epsg, WGS84_UTM_SUR_BASE);
  if (zonaSur !== null) {
    return `+proj=utm +zone=${zonaSur} +south +datum=WGS84 +units=m +no_defs`;
  }

  throw new RangeError(
    `definicionProj4: EPSG:${epsg} no es un sistema proyectado que este pipeline sepa construir. ` +
      'Se admiten UTM sobre ETRS89 (258xx, zonas 28 a 38) y UTM sobre WGS84 (326xx norte, 327xx sur). ' +
      'El EPSG lo elige `epsgRecomendado` a partir del area del territorio: revisa el territorio ' +
      'antes que este modulo.',
  );
}

/**
 * Registra un sistema en proj4 si no lo estaba ya, y devuelve su nombre.
 *
 * @param {number} epsg
 * @returns {{nombre: string, definicion: string}}
 */
function registrar(epsg) {
  const nombre = nombreEpsg(epsg);
  const definicion = definicionProj4(epsg);

  if (proj4.defs(nombre) === undefined) {
    proj4.defs(nombre, definicion);
  }
  return { nombre, definicion };
}

/**
 * @param {unknown} punto
 * @param {string} primero
 * @param {string} segundo
 * @param {string} fn
 * @returns {[number, number]}
 */
function validarPar(punto, primero, segundo, fn) {
  if (punto === null || typeof punto !== 'object') {
    throw new TypeError(`${fn}: se esperaba un punto {${primero}, ${segundo}}`);
  }
  const a = /** @type {any} */ (punto)[primero];
  const b = /** @type {any} */ (punto)[segundo];
  if (!(Number.isFinite(a) && Number.isFinite(b))) {
    throw new TypeError(`${fn}: \`${primero}\` y \`${segundo}\` deben ser numeros finitos`);
  }
  return [a, b];
}

/**
 * Crea el reproyector de un sistema proyectado.
 *
 * @param {number} epsg
 * @returns {Reproyector}
 */
export function crearReproyector(epsg) {
  const { nombre, definicion } = registrar(epsg);
  const origen = nombreEpsg(EPSG_GEOGRAFICO);
  const haciaMetros = proj4(origen, nombre);

  return Object.freeze({
    epsg,
    nombre,
    definicion,

    /**
     * @param {PuntoGeografico} punto
     * @returns {PuntoProyectado}
     */
    aProyectado(punto) {
      const [lon, lat] = validarPar(punto, 'lon', 'lat', 'aProyectado');
      const [este, norte] = haciaMetros.forward([lon, lat]);
      return Object.freeze({ este, norte });
    },

    /**
     * @param {PuntoProyectado} punto
     * @returns {PuntoGeografico}
     */
    aGeografico(punto) {
      const [este, norte] = validarPar(punto, 'este', 'norte', 'aGeografico');
      const [lon, lat] = haciaMetros.inverse([este, norte]);
      return Object.freeze({ lon, lat });
    },
  });
}

/**
 * Reproyector de un territorio. El EPSG sale del territorio, que a su vez lo
 * dedujo de su area: generar otra ciudad no toca este modulo.
 *
 * @param {import('urbs-core').Territorio} territorio
 * @returns {Reproyector}
 */
export function crearReproyectorDeTerritorio(territorio) {
  if (territorio === null || typeof territorio !== 'object' || !Number.isInteger(territorio.epsg)) {
    throw new TypeError(
      'crearReproyectorDeTerritorio: se esperaba un territorio creado con crearTerritorio',
    );
  }
  return crearReproyector(territorio.epsg);
}
