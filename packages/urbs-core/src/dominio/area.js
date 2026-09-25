/**
 * Area geografica de consulta.
 *
 * Siempre en coordenadas geograficas WGS84 (EPSG:4326), en grados.
 * Los proveedores hablan en grados porque es lo unico que comparten todas
 * las fuentes del mundo. Proyectar a metros es responsabilidad del pipeline,
 * nunca de la fuente de datos.
 */

/**
 * @typedef {Object} Area
 * @property {number} lonMin  Longitud minima en grados
 * @property {number} latMin  Latitud minima en grados
 * @property {number} lonMax  Longitud maxima en grados
 * @property {number} latMax  Latitud maxima en grados
 */

/**
 * @param {{lonMin: number, latMin: number, lonMax: number, latMax: number}} limites
 * @returns {Area}
 */
export function crearArea({ lonMin, latMin, lonMax, latMax }) {
  const coordenadas = [lonMin, latMin, lonMax, latMax];

  if (!coordenadas.every((valor) => Number.isFinite(valor))) {
    throw new TypeError('crearArea: las cuatro coordenadas deben ser numeros finitos');
  }
  if (lonMin < -180 || lonMax > 180 || latMin < -90 || latMax > 90) {
    throw new RangeError('crearArea: coordenadas fuera del rango geografico valido');
  }
  if (lonMin >= lonMax || latMin >= latMax) {
    throw new RangeError('crearArea: el minimo debe ser menor que el maximo en ambos ejes');
  }

  return Object.freeze({ lonMin, latMin, lonMax, latMax });
}

/**
 * Indica si `contenida` cae por completo dentro de `contenedora`.
 * @param {Area} contenedora
 * @param {Area} contenida
 * @returns {boolean}
 */
export function contiene(contenedora, contenida) {
  return (
    contenida.lonMin >= contenedora.lonMin &&
    contenida.latMin >= contenedora.latMin &&
    contenida.lonMax <= contenedora.lonMax &&
    contenida.latMax <= contenedora.latMax
  );
}

/**
 * Indica si dos areas comparten alguna superficie.
 * @param {Area} a
 * @param {Area} b
 * @returns {boolean}
 */
export function intersecan(a, b) {
  return (
    a.lonMin < b.lonMax && a.lonMax > b.lonMin && a.latMin < b.latMax && a.latMax > b.latMin
  );
}

/**
 * Punto central del area. Util para decidir la zona UTM del territorio.
 * @param {Area} area
 * @returns {{lon: number, lat: number}}
 */
export function centro(area) {
  return {
    lon: (area.lonMin + area.lonMax) / 2,
    lat: (area.latMin + area.latMax) / 2,
  };
}
