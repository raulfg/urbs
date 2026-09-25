/**
 * Proyeccion: de grados a metros.
 *
 * Aqui esta la regla fundacional de URBS hecha codigo. La zona UTM NO es una
 * constante del motor, se deduce del territorio. A Coruna cae en la zona 29N
 * (EPSG:25829 en ETRS89), pero eso es una consecuencia de sus coordenadas,
 * no una decision de diseno. El dia que generemos Lisboa o Berlin, esto ya
 * funciona.
 */

/** Zonas UTM cubiertas por ETRS89, el datum oficial europeo. */
const ZONA_ETRS89_MINIMA = 28;
const ZONA_ETRS89_MAXIMA = 38;

/**
 * Zona UTM que corresponde a una longitud dada.
 * @param {number} lon Longitud en grados
 * @returns {number} Numero de zona, de 1 a 60
 */
export function zonaUtm(lon) {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError('zonaUtm: longitud fuera del rango [-180, 180]');
  }
  // La longitud 180 exacta cae en la ultima zona, no en una zona 61 inexistente.
  return Math.min(60, Math.floor((lon + 180) / 6) + 1);
}

/**
 * Codigo EPSG de UTM sobre WGS84. Es el fallback universal: funciona en
 * cualquier punto del planeta.
 *
 * @param {{lon: number, lat: number}} punto
 * @returns {number} Codigo EPSG (326xx en el hemisferio norte, 327xx en el sur)
 */
export function epsgUtmWgs84({ lon, lat }) {
  const zona = zonaUtm(lon);
  return (lat >= 0 ? 32600 : 32700) + zona;
}

/**
 * Codigo EPSG de UTM sobre ETRS89. Es el datum nativo de Catastro y PNOA,
 * asi que en Espana evita una reproyeccion y la perdida de precision que
 * conlleva.
 *
 * @param {{lon: number, lat: number}} punto
 * @returns {number|null} Codigo EPSG 258xx, o null si el punto cae fuera de Europa
 */
export function epsgUtmEtrs89({ lon, lat }) {
  const zona = zonaUtm(lon);
  if (zona < ZONA_ETRS89_MINIMA || zona > ZONA_ETRS89_MAXIMA || lat < 0) {
    return null;
  }
  return 25800 + zona;
}

/**
 * Elige el EPSG proyectado mas adecuado para un punto: ETRS89 si el punto
 * esta dentro de su ambito, WGS84 en cualquier otro caso.
 *
 * @param {{lon: number, lat: number}} punto
 * @returns {number}
 */
export function epsgRecomendado(punto) {
  return epsgUtmEtrs89(punto) ?? epsgUtmWgs84(punto);
}
