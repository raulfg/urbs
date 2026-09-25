/**
 * Lectura de etiquetas de OSM y traduccion al dominio de URBS.
 *
 * Aqui vive todo el conocimiento sucio: que `building:levels` puede venir como
 * "4.5" o como "0", que `height` a veces dice "0.5" y a veces "alto", que una
 * acera y una plaza peatonal comparten `TipoVia` pero no miden lo mismo.
 *
 * Nada de este fichero toca red ni disco. Son funciones puras sobre un objeto
 * de etiquetas, y por eso se pueden probar una a una sin pedirle permiso a
 * Overpass.
 */

import {
  Confianza,
  TipoVia,
  UsoEdificio,
  ALTURA_PLANTA_POR_DEFECTO,
  resolverAnchura,
} from 'urbs-core';

/**
 * Altura minima que aceptamos de un `height` etiquetado.
 * Por debajo de esto no es un edificio, es un error de tecleo: en el bbox de
 * Ciudad Vieja hay un `height=0.5` etiquetado sobre un edificio real.
 */
export const ALTURA_MINIMA_PLAUSIBLE = 2;

/** Altura maxima plausible. Filtra metros confundidos con centimetros. */
export const ALTURA_MAXIMA_PLAUSIBLE = 300;

/** Numero de plantas por encima del cual asumimos que el dato esta roto. */
export const PLANTAS_MAXIMAS = 60;

/**
 * Traduccion del esquema `highway` de OSM a `TipoVia`.
 *
 * `TipoVia` es deliberadamente grueso: al motor le importa la anchura, la
 * velocidad y si admite trafico, no la taxonomia completa de OSM.
 */
export const TIPO_POR_HIGHWAY = Object.freeze({
  motorway: TipoVia.AUTOPISTA,
  motorway_link: TipoVia.AUTOPISTA,
  trunk: TipoVia.AUTOPISTA,
  trunk_link: TipoVia.AUTOPISTA,

  primary: TipoVia.PRIMARIA,
  primary_link: TipoVia.PRIMARIA,

  secondary: TipoVia.SECUNDARIA,
  secondary_link: TipoVia.SECUNDARIA,

  tertiary: TipoVia.LOCAL,
  tertiary_link: TipoVia.LOCAL,
  unclassified: TipoVia.LOCAL,
  road: TipoVia.LOCAL,
  busway: TipoVia.LOCAL,

  residential: TipoVia.RESIDENCIAL,
  living_street: TipoVia.RESIDENCIAL,

  service: TipoVia.SERVICIO,
  track: TipoVia.SERVICIO,

  pedestrian: TipoVia.PEATONAL,
  footway: TipoVia.PEATONAL,
  steps: TipoVia.PEATONAL,
  path: TipoVia.PEATONAL,
  cycleway: TipoVia.PEATONAL,
  bridleway: TipoVia.PEATONAL,
  corridor: TipoVia.PEATONAL,
});

/**
 * Valores de `highway` que admiten trafico rodado.
 *
 * Mas de la mitad de las vias del bbox son `footway`, `steps` o `pedestrian`.
 * Si el grafo del trafico no filtra por aqui, la IA conduce por las aceras.
 */
const HIGHWAY_CONDUCIBLE = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'road',
  'busway',
  'residential',
  'living_street',
  'service',
  'track',
]);

/** Tipos de dominio que admiten trafico rodado. */
const TIPO_CONDUCIBLE = new Set([
  TipoVia.AUTOPISTA,
  TipoVia.PRIMARIA,
  TipoVia.SECUNDARIA,
  TipoVia.LOCAL,
  TipoVia.RESIDENCIAL,
  TipoVia.SERVICIO,
]);

/**
 * Valores de `highway` que no son una via transitable y que descartamos en
 * silencio. Sin esta lista, cada parada de autobus del bbox generaria una
 * incidencia y el informe dejaria de servir para nada.
 */
const HIGHWAY_IGNORADO = new Set([
  'construction',
  'proposed',
  'planned',
  'platform',
  'elevator',
  'raceway',
  'rest_area',
  'services',
  'bus_stop',
  'crossing',
  'traffic_signals',
  'street_lamp',
  'give_way',
  'stop',
  'turning_circle',
  'turning_loop',
  'passing_place',
  'milestone',
  'speed_camera',
  'emergency_bay',
]);

/** Valores de `access` que cierran una via al trafico rodado. */
const ACCESO_CERRADO = new Set(['no']);

/**
 * Anchura estimada en metros para valores de `highway` cuya realidad se aleja
 * del valor grueso de `ANCHURA_POR_TIPO`.
 *
 * Esta tabla existe porque `width` solo cubre el 2,1% de las vias y `lanes` el
 * 16,1%: la estimacion se usa el ~84% de las veces, asi que es el modelo real
 * de anchura y no un ultimo recurso. Y ahi `TipoVia` se queda corto: una acera
 * (`footway`) y una plaza peatonal (`pedestrian`) son las dos `PEATONAL` en el
 * dominio, pero una mide 2,5 m y la otra 10.
 *
 * Vive en el proveedor, no en `urbs-core`, porque es conocimiento sobre OSM.
 * El dominio no tiene por que saber que existe la etiqueta `steps`.
 */
export const ANCHURA_POR_HIGHWAY = Object.freeze({
  footway: 2.5,
  steps: 1.5,
  path: 2,
  cycleway: 2,
  corridor: 2,
  bridleway: 2,
  pedestrian: 10,
  living_street: 6,
  service: 3.5,
  track: 3,
});

/**
 * Altura estimada en metros segun el valor de `building`, para el ~3% de
 * edificios sin `height` ni `building:levels`.
 */
export const ALTURA_POR_EDIFICIO = Object.freeze({
  house: 6,
  detached: 6,
  semidetached_house: 6,
  terrace: 9,
  bungalow: 4,
  hut: 3,
  shed: 3,
  roof: 3,
  garage: 3,
  garages: 3,
  carport: 3,
  apartments: 12,
  residential: 12,
  dormitory: 12,
  hotel: 15,
  retail: 8,
  commercial: 10,
  supermarket: 8,
  kiosk: 3,
  office: 12,
  industrial: 8,
  warehouse: 8,
  manufacture: 8,
  school: 10,
  university: 12,
  kindergarten: 6,
  college: 12,
  hospital: 15,
  civic: 10,
  public: 10,
  government: 12,
  train_station: 10,
  transportation: 8,
  sports_hall: 10,
  stadium: 15,
  museum: 12,
  church: 15,
  chapel: 8,
  cathedral: 25,
  mosque: 12,
  synagogue: 12,
  temple: 12,
  monastery: 12,
});

/** Altura de referencia cuando el valor de `building` no esta en la tabla. */
export const ALTURA_POR_EDIFICIO_POR_DEFECTO = 9;

/** Traduccion del valor de `building` al uso dominante del dominio. */
export const USO_POR_EDIFICIO = Object.freeze({
  residential: UsoEdificio.RESIDENCIAL,
  apartments: UsoEdificio.RESIDENCIAL,
  house: UsoEdificio.RESIDENCIAL,
  detached: UsoEdificio.RESIDENCIAL,
  semidetached_house: UsoEdificio.RESIDENCIAL,
  terrace: UsoEdificio.RESIDENCIAL,
  bungalow: UsoEdificio.RESIDENCIAL,
  dormitory: UsoEdificio.RESIDENCIAL,

  commercial: UsoEdificio.COMERCIAL,
  retail: UsoEdificio.COMERCIAL,
  supermarket: UsoEdificio.COMERCIAL,
  kiosk: UsoEdificio.COMERCIAL,
  shop: UsoEdificio.COMERCIAL,
  office: UsoEdificio.COMERCIAL,
  hotel: UsoEdificio.COMERCIAL,

  industrial: UsoEdificio.INDUSTRIAL,
  warehouse: UsoEdificio.INDUSTRIAL,
  factory: UsoEdificio.INDUSTRIAL,
  manufacture: UsoEdificio.INDUSTRIAL,

  school: UsoEdificio.EQUIPAMIENTO,
  university: UsoEdificio.EQUIPAMIENTO,
  kindergarten: UsoEdificio.EQUIPAMIENTO,
  college: UsoEdificio.EQUIPAMIENTO,
  hospital: UsoEdificio.EQUIPAMIENTO,
  civic: UsoEdificio.EQUIPAMIENTO,
  public: UsoEdificio.EQUIPAMIENTO,
  government: UsoEdificio.EQUIPAMIENTO,
  train_station: UsoEdificio.EQUIPAMIENTO,
  transportation: UsoEdificio.EQUIPAMIENTO,
  sports_hall: UsoEdificio.EQUIPAMIENTO,
  stadium: UsoEdificio.EQUIPAMIENTO,
  museum: UsoEdificio.EQUIPAMIENTO,
  fire_station: UsoEdificio.EQUIPAMIENTO,

  church: UsoEdificio.RELIGIOSO,
  chapel: UsoEdificio.RELIGIOSO,
  cathedral: UsoEdificio.RELIGIOSO,
  mosque: UsoEdificio.RELIGIOSO,
  synagogue: UsoEdificio.RELIGIOSO,
  temple: UsoEdificio.RELIGIOSO,
  monastery: UsoEdificio.RELIGIOSO,
  religious: UsoEdificio.RELIGIOSO,

  garage: UsoEdificio.APARCAMIENTO,
  garages: UsoEdificio.APARCAMIENTO,
  carport: UsoEdificio.APARCAMIENTO,
  parking: UsoEdificio.APARCAMIENTO,
});

/** Valores de `amenity` que delatan el uso cuando `building` no lo dice. */
const USO_POR_AMENITY = Object.freeze({
  place_of_worship: UsoEdificio.RELIGIOSO,
  school: UsoEdificio.EQUIPAMIENTO,
  university: UsoEdificio.EQUIPAMIENTO,
  college: UsoEdificio.EQUIPAMIENTO,
  kindergarten: UsoEdificio.EQUIPAMIENTO,
  hospital: UsoEdificio.EQUIPAMIENTO,
  clinic: UsoEdificio.EQUIPAMIENTO,
  townhall: UsoEdificio.EQUIPAMIENTO,
  library: UsoEdificio.EQUIPAMIENTO,
  police: UsoEdificio.EQUIPAMIENTO,
  fire_station: UsoEdificio.EQUIPAMIENTO,
  theatre: UsoEdificio.EQUIPAMIENTO,
  parking: UsoEdificio.APARCAMIENTO,
  restaurant: UsoEdificio.COMERCIAL,
  cafe: UsoEdificio.COMERCIAL,
  bar: UsoEdificio.COMERCIAL,
  pharmacy: UsoEdificio.COMERCIAL,
  bank: UsoEdificio.COMERCIAL,
});

/** Solo aceptamos metros. Un `10'` o un `10 ft` se declaran ilegibles. */
const UNIDAD_NO_METRICA = /['"]|\bft\b|\bfeet\b|\binch\b/i;

/** Numero con signo y decimales, opcionalmente seguido de `m`/`metre(s)`. */
const NUMERO_CON_UNIDAD = /^[+-]?\d+(?:\.\d+)?\s*(?:m|metre|metres|meter|meters)?$/i;

/**
 * Lee un valor numerico de una etiqueta de OSM tolerando lo que la gente
 * escribe de verdad: coma decimal, unidad pegada, valores multiples con `;`.
 *
 * Devuelve `null` ante cualquier cosa que no sea un numero limpio. Nunca
 * devuelve 0 como forma de decir "no lo se".
 *
 * @param {string|number|null|undefined} valor
 * @returns {number|null}
 */
export function parsearNumero(valor) {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : null;
  }
  if (typeof valor !== 'string') {
    return null;
  }

  const primero = valor.split(';')[0].trim();
  if (primero.length === 0 || UNIDAD_NO_METRICA.test(primero)) {
    return null;
  }

  const normalizado = primero.replace(',', '.');
  if (!NUMERO_CON_UNIDAD.test(normalizado)) {
    return null;
  }

  const numero = Number.parseFloat(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Como `parsearNumero`, pero exige un entero. Para `lanes`, donde 2,5 carriles
 * no significa nada.
 *
 * @param {string|number|null|undefined} valor
 * @returns {number|null}
 */
export function parsearEntero(valor) {
  const numero = parsearNumero(valor);
  return Number.isInteger(numero) ? numero : null;
}

/**
 * Tipo de via del dominio a partir de las etiquetas, o `null` si el valor de
 * `highway` no lo conocemos.
 *
 * @param {Record<string, string>} etiquetas
 * @returns {string|null}
 */
export function tipoDeVia(etiquetas) {
  return TIPO_POR_HIGHWAY[etiquetas?.highway] ?? null;
}

/**
 * Indica si un valor de `highway` desconocido es de los que descartamos en
 * silencio (obras, paradas, semaforos) o de los que merecen una incidencia.
 *
 * @param {Record<string, string>} etiquetas
 * @returns {boolean}
 */
export function esHighwayIgnorado(etiquetas) {
  return HIGHWAY_IGNORADO.has(etiquetas?.highway);
}

/**
 * Indica si una via admite trafico rodado, mirando su clase y su acceso.
 *
 * Es un predicado aparte del tipo a proposito: el tipo describe la via, esto
 * decide si entra en el grafo del trafico. Las peatonales se conservan igual,
 * porque hacen falta para la capa de peatones.
 *
 * @param {Record<string, string>} etiquetas
 * @returns {boolean}
 */
export function esConducible(etiquetas) {
  if (!HIGHWAY_CONDUCIBLE.has(etiquetas?.highway)) {
    return false;
  }
  if (ACCESO_CERRADO.has(etiquetas.access)) {
    return false;
  }
  if (ACCESO_CERRADO.has(etiquetas.motor_vehicle)) {
    return false;
  }
  return true;
}

/**
 * Version del predicado anterior que solo necesita el tipo del dominio, para
 * filtrar tramos ya transformados sin volver a las etiquetas de origen.
 *
 * @param {string} tipo
 * @returns {boolean}
 */
export function esTipoConducible(tipo) {
  return TIPO_CONDUCIBLE.has(tipo);
}

/**
 * Uso dominante del edificio. Si `building` no lo dice (el clasico
 * `building=yes`), se mira la actividad que hay dentro.
 *
 * @param {Record<string, string>} etiquetas
 * @returns {string}
 */
export function usoDeEdificio(etiquetas) {
  const porBuilding = USO_POR_EDIFICIO[etiquetas?.building];
  if (porBuilding !== undefined) {
    return porBuilding;
  }

  const porAmenity = USO_POR_AMENITY[etiquetas?.amenity];
  if (porAmenity !== undefined) {
    return porAmenity;
  }
  if (etiquetas?.shop !== undefined || etiquetas?.office !== undefined) {
    return UsoEdificio.COMERCIAL;
  }

  return UsoEdificio.DESCONOCIDO;
}

/** Recorta el ruido de coma flotante de las estimaciones. */
function redondearMetros(valor) {
  return Math.round(valor * 100) / 100;
}

/**
 * @typedef {Object} Rechazo
 * @property {string} etiqueta  Etiqueta OSM cuyo valor se ha descartado
 * @property {unknown} valor    Valor original, tal cual venia
 * @property {string} motivo    Por que no lo hemos aceptado
 */

/**
 * @typedef {Object} AlturaDerivada
 * @property {number} alturaMetros
 * @property {number|null} plantas
 * @property {string} confianza     Uno de los valores de `Confianza`
 * @property {string|null} nota     Como se ha estimado, si se ha estimado
 * @property {Rechazo[]} rechazos   Valores etiquetados que hemos descartado
 */

/**
 * Deriva la altura de un edificio en cascada: `height` etiquetado si es sano,
 * si no `building:levels` por la altura de planta, si no la tabla por valor de
 * `building`.
 *
 * Ninguna fuente nos da la altura fiable, asi que lo unico honesto es decir de
 * donde sale cada numero. Solo el primer caso es `declarado`.
 *
 * @param {Record<string, string>} etiquetas
 * @param {{alturaPlanta?: number}} [opciones]
 * @returns {AlturaDerivada}
 */
export function derivarAltura(etiquetas, { alturaPlanta = ALTURA_PLANTA_POR_DEFECTO } = {}) {
  /** @type {Rechazo[]} */
  const rechazos = [];

  const plantasNumero = leerPlantas(etiquetas, rechazos);
  const plantas = Number.isInteger(plantasNumero) ? plantasNumero : null;

  const alturaEtiquetada = leerAlturaEtiquetada(etiquetas, rechazos);
  if (alturaEtiquetada !== null) {
    return {
      alturaMetros: alturaEtiquetada,
      plantas,
      confianza: Confianza.DECLARADO,
      nota: null,
      rechazos,
    };
  }

  if (plantasNumero !== null) {
    return {
      alturaMetros: redondearMetros(plantasNumero * alturaPlanta),
      plantas,
      confianza: Confianza.ESTIMADO,
      nota: `altura estimada a partir de ${plantasNumero} plantas a ${alturaPlanta} m por planta`,
      rechazos,
    };
  }

  const valorBuilding = etiquetas?.building;
  const porTipo = ALTURA_POR_EDIFICIO[valorBuilding] ?? ALTURA_POR_EDIFICIO_POR_DEFECTO;
  return {
    alturaMetros: porTipo,
    plantas: null,
    confianza: Confianza.ESTIMADO,
    nota: `altura estimada por building=${valorBuilding ?? 'sin valor'}`,
    rechazos,
  };
}

/** Lee `height` y decide si es creible. Devuelve `null` si no lo es. */
function leerAlturaEtiquetada(etiquetas, rechazos) {
  const bruto = etiquetas?.height;
  if (bruto === undefined || bruto === null || bruto === '') {
    return null;
  }

  const altura = parsearNumero(bruto);
  if (altura === null) {
    rechazos.push({ etiqueta: 'height', valor: bruto, motivo: 'no es un numero en metros' });
    return null;
  }
  if (altura < ALTURA_MINIMA_PLAUSIBLE) {
    rechazos.push({
      etiqueta: 'height',
      valor: bruto,
      motivo: `por debajo de la altura minima plausible de ${ALTURA_MINIMA_PLAUSIBLE} m`,
    });
    return null;
  }
  if (altura > ALTURA_MAXIMA_PLAUSIBLE) {
    rechazos.push({
      etiqueta: 'height',
      valor: bruto,
      motivo: `por encima de la altura maxima plausible de ${ALTURA_MAXIMA_PLAUSIBLE} m`,
    });
    return null;
  }

  return altura;
}

/** Lee `building:levels`. Puede no ser entero: "4.5" existe y sirve para la altura. */
function leerPlantas(etiquetas, rechazos) {
  const bruto = etiquetas?.['building:levels'];
  if (bruto === undefined || bruto === null || bruto === '') {
    return null;
  }

  const plantas = parsearNumero(bruto);
  if (plantas === null) {
    rechazos.push({ etiqueta: 'building:levels', valor: bruto, motivo: 'no es un numero' });
    return null;
  }
  if (plantas <= 0) {
    rechazos.push({
      etiqueta: 'building:levels',
      valor: bruto,
      motivo: 'un edificio sobre rasante tiene al menos una planta',
    });
    return null;
  }
  if (plantas > PLANTAS_MAXIMAS) {
    rechazos.push({
      etiqueta: 'building:levels',
      valor: bruto,
      motivo: `por encima del maximo plausible de ${PLANTAS_MAXIMAS} plantas`,
    });
    return null;
  }

  return plantas;
}

/**
 * @typedef {Object} AnchuraDerivada
 * @property {number} anchuraMetros
 * @property {number|null} carriles
 * @property {string} confianza
 * @property {string|null} nota
 * @property {Rechazo[]} rechazos
 */

/**
 * Resuelve la anchura de una via a partir de sus etiquetas, aplicando la
 * cascada del dominio (`resolverAnchura`) con un escalon extra en medio: la
 * tabla fina por valor de `highway`, que solo entra cuando no hay ni `width`
 * ni `lanes` y el dominio tendria que conformarse con el tipo grueso.
 *
 * @param {{etiquetas: Record<string, string>, tipo: string}} datos
 * @returns {AnchuraDerivada}
 */
export function resolverAnchuraOsm({ etiquetas, tipo }) {
  /** @type {Rechazo[]} */
  const rechazos = [];

  const anchuraDeclarada = leerAnchuraDeclarada(etiquetas, rechazos);
  const carriles = leerCarriles(etiquetas, rechazos);

  if (anchuraDeclarada === null && carriles === null) {
    const porHighway = ANCHURA_POR_HIGHWAY[etiquetas?.highway];
    if (porHighway !== undefined) {
      return {
        anchuraMetros: porHighway,
        carriles: null,
        confianza: Confianza.ESTIMADO,
        nota: `anchura estimada por highway=${etiquetas.highway}`,
        rechazos,
      };
    }
  }

  const { anchuraMetros, confianza } = resolverAnchura({ anchuraDeclarada, carriles, tipo });
  const nota =
    confianza === Confianza.DECLARADO
      ? null
      : carriles !== null
        ? `anchura estimada a partir de ${carriles} carriles`
        : `anchura estimada por tipo de via ${tipo}`;

  return { anchuraMetros, carriles, confianza, nota, rechazos };
}

/** Lee `width` y descarta lo que no sean metros positivos. */
function leerAnchuraDeclarada(etiquetas, rechazos) {
  const bruto = etiquetas?.width;
  if (bruto === undefined || bruto === null || bruto === '') {
    return null;
  }

  const anchura = parsearNumero(bruto);
  if (anchura === null) {
    rechazos.push({ etiqueta: 'width', valor: bruto, motivo: 'no es un numero en metros' });
    return null;
  }
  if (anchura <= 0) {
    rechazos.push({ etiqueta: 'width', valor: bruto, motivo: 'la anchura debe ser positiva' });
    return null;
  }

  return anchura;
}

/** Lee `lanes` y descarta lo que no sea un entero positivo. */
function leerCarriles(etiquetas, rechazos) {
  const bruto = etiquetas?.lanes;
  if (bruto === undefined || bruto === null || bruto === '') {
    return null;
  }

  const carriles = parsearEntero(bruto);
  if (carriles === null || carriles <= 0) {
    rechazos.push({ etiqueta: 'lanes', valor: bruto, motivo: 'no es un numero entero de carriles' });
    return null;
  }

  return carriles;
}
