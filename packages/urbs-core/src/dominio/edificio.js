/**
 * Edificio: la unidad basica que URBS extruye para construir la ciudad.
 *
 * La huella viene en coordenadas geograficas WGS84. Altura y plantas pueden
 * faltar: fuera de Espana lo normal es que OSM no las traiga, y el motor tiene
 * que seguir funcionando. Un valor ausente es `null`, nunca un cero disfrazado.
 */

/**
 * Uso dominante del edificio. Determina como se genera la fachada:
 * el bajo comercial lleva escaparates, el residencial lleva balcones.
 */
export const UsoEdificio = Object.freeze({
  RESIDENCIAL: 'residencial',
  COMERCIAL: 'comercial',
  INDUSTRIAL: 'industrial',
  EQUIPAMIENTO: 'equipamiento',
  RELIGIOSO: 'religioso',
  APARCAMIENTO: 'aparcamiento',
  DESCONOCIDO: 'desconocido',
});

const USOS_VALIDOS = new Set(Object.values(UsoEdificio));

/**
 * Un anillo es una lista cerrada de posiciones [lon, lat].
 * El primer anillo de una huella es el contorno exterior; el resto son huecos
 * (patios interiores).
 *
 * @typedef {Array<[number, number]>} Anillo
 */

/**
 * @typedef {Object} Edificio
 * @property {string} id
 * @property {Anillo[]} huella            Exterior primero, huecos despues
 * @property {number|null} alturaMetros   Altura total sobre rasante
 * @property {number|null} plantas        Numero de plantas sobre rasante
 * @property {string} uso                 Uno de los valores de `UsoEdificio`
 * @property {import('./procedencia.js').Procedencia} procedencia
 */

/**
 * @param {Object} datos
 * @returns {Edificio}
 */
export function crearEdificio({
  id,
  huella,
  alturaMetros = null,
  plantas = null,
  uso = UsoEdificio.DESCONOCIDO,
  procedencia,
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('crearEdificio: `id` debe ser una cadena no vacia');
  }
  if (!Array.isArray(huella) || huella.length === 0) {
    throw new TypeError('crearEdificio: `huella` debe tener al menos el anillo exterior');
  }
  for (const anillo of huella) {
    if (!Array.isArray(anillo) || anillo.length < 4) {
      throw new TypeError(
        'crearEdificio: cada anillo necesita al menos 4 posiciones (poligono cerrado)',
      );
    }
  }
  if (alturaMetros !== null && !(Number.isFinite(alturaMetros) && alturaMetros > 0)) {
    throw new RangeError('crearEdificio: `alturaMetros` debe ser un numero positivo o null');
  }
  if (plantas !== null && !(Number.isInteger(plantas) && plantas > 0)) {
    throw new RangeError('crearEdificio: `plantas` debe ser un entero positivo o null');
  }
  if (!USOS_VALIDOS.has(uso)) {
    throw new RangeError(`crearEdificio: uso desconocido "${uso}"`);
  }
  if (!procedencia) {
    throw new TypeError('crearEdificio: todo edificio debe declarar su procedencia');
  }

  return Object.freeze({
    id,
    huella: Object.freeze(huella),
    alturaMetros,
    plantas,
    uso,
    procedencia,
  });
}

/**
 * Altura de planta por defecto en metros, usada para estimar cuando solo
 * conocemos una de las dos magnitudes.
 */
export const ALTURA_PLANTA_POR_DEFECTO = 3;
