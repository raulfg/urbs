/**
 * Proveedor OSM: el suelo bajo los pies del motor.
 *
 * OSM es la unica fuente que cubre el planeta entero, asi que `cubre` devuelve
 * siempre `true` y la prioridad es baja a proposito: cualquier fuente local
 * mas rica (Catastro en Espana, PNOA para el relieve) le gana el sitio, y
 * donde no llegue ninguna, OSM sigue dando una ciudad.
 *
 * Aqui no hay logica: esto solo pega tres piezas ya probadas por separado
 * (cache, transformacion y etiquetas) y las viste con el contrato del core.
 */

import { Capa, validarProveedor } from 'urbs-core';

import { crearCacheOsm, DIRECTORIO_CRUDOS_POR_DEFECTO } from './cache.js';
import { URL_OVERPASS_POR_DEFECTO } from './consulta.js';
import { transformarEdificios, transformarViario } from './transformacion.js';

export const ID_PROVEEDOR_EDIFICIOS = 'osm-edificios';
export const ID_PROVEEDOR_VIARIO = 'osm-viario';

/**
 * Prioridad baja adrede. OSM es el fallback, no la primera opcion: donde haya
 * Catastro queremos Catastro.
 */
export const PRIORIDAD_OSM = 10;

/**
 * Atribucion obligatoria de OpenStreetMap.
 *
 * El share-alike de ODbL afecta a la base de datos derivada si se redistribuye,
 * no al juego; la cita, en cambio, es innegociable y va en la pantalla de
 * creditos. Las dos capas devuelven el mismo objeto para que el registro las
 * agrupe en una sola linea.
 */
export const ATRIBUCION_OSM = Object.freeze({
  fuente: 'OpenStreetMap',
  licencia: 'ODbL 1.0',
  texto: '(c) colaboradores de OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
});

/** Registrador por defecto: resume la calidad del dato sin vomitar el detalle. */
function avisarPorConsola({ capa, proveedor, incidencias }) {
  const porMotivo = new Map();
  for (const incidencia of incidencias) {
    const clave = incidencia.etiqueta ? `${incidencia.etiqueta}: ${incidencia.motivo}` : incidencia.motivo;
    porMotivo.set(clave, (porMotivo.get(clave) ?? 0) + 1);
  }
  const resumen = [...porMotivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, veces]) => `${veces}x ${motivo}`)
    .join(' | ');

  console.warn(`[${proveedor}] ${incidencias.length} incidencias en la capa ${capa}: ${resumen}`);
}

/**
 * Fuente compartida: una descarga por bbox, servida a las dos capas.
 *
 * Sin esto, edificios y viario bajarian el mismo fichero de 20 MB dos veces.
 * La cache de disco ya lo evitaria entre ejecuciones; esta memoria lo evita
 * dentro de la misma.
 *
 * @param {{cache: ReturnType<typeof crearCacheOsm>, refrescar?: boolean}} opciones
 */
export function crearFuenteOsm({ cache, refrescar = false }) {
  /** @type {Map<string, Promise<{datos: object}>>} */
  const enCurso = new Map();

  /**
   * @param {import('urbs-core').Area} area
   * @returns {Promise<{datos: object, meta: object|null, desdeCache: boolean}>}
   */
  function obtener(area) {
    const clave = cache.rutas(area).datos;
    if (!enCurso.has(clave)) {
      enCurso.set(clave, cache.obtener(area, { refrescar }));
    }
    return enCurso.get(clave);
  }

  return Object.freeze({ obtener, cache });
}

/**
 * @typedef {Object} OpcionesProveedoresOsm
 * @property {string} [directorio]        Donde viven los crudos descargados
 * @property {Function} [fetcher]         Sustituto de `fetch`, inyectable para los tests
 * @property {string} [urlOverpass]
 * @property {number} [timeoutSegundos]
 * @property {boolean} [refrescar]        Fuerza una descarga nueva; por defecto, jamas
 * @property {number} [alturaPlanta]      Metros por planta al estimar altura
 * @property {boolean} [soloConducibles]  Recorta el viario al grafo del trafico
 * @property {number} [prioridad]
 * @property {(informe: {capa: string, proveedor: string, incidencias: object[]}) => void} [registrarIncidencias]
 */

/**
 * Crea los proveedores OSM de edificios y viario compartiendo una sola fuente.
 *
 * @param {OpcionesProveedoresOsm} [opciones]
 * @returns {{edificios: object, viario: object, fuente: ReturnType<typeof crearFuenteOsm>}}
 */
export function crearProveedoresOsm({
  directorio = DIRECTORIO_CRUDOS_POR_DEFECTO,
  fetcher = globalThis.fetch,
  urlOverpass = URL_OVERPASS_POR_DEFECTO,
  timeoutSegundos,
  refrescar = false,
  alturaPlanta,
  soloConducibles = false,
  prioridad = PRIORIDAD_OSM,
  registrarIncidencias = avisarPorConsola,
} = {}) {
  const cache = crearCacheOsm({ directorio, fetcher, urlOverpass, timeoutSegundos });
  const fuente = crearFuenteOsm({ cache, refrescar });

  function reportar(capa, proveedor, incidencias) {
    if (incidencias.length > 0) {
      registrarIncidencias({ capa, proveedor, incidencias });
    }
  }

  const edificios = validarProveedor(
    Object.freeze({
      id: ID_PROVEEDOR_EDIFICIOS,
      capa: Capa.EDIFICIOS,
      prioridad,
      cubre: () => true,
      atribucion: () => ATRIBUCION_OSM,

      /**
       * @param {import('urbs-core').Area} area
       * @returns {Promise<object[]>}
       */
      async obtenerEdificios(area) {
        const { datos } = await fuente.obtener(area);
        const resultado = transformarEdificios(datos, {
          proveedorId: ID_PROVEEDOR_EDIFICIOS,
          alturaPlanta,
        });
        reportar(Capa.EDIFICIOS, ID_PROVEEDOR_EDIFICIOS, resultado.incidencias);
        return resultado.edificios;
      },
    }),
  );

  const viario = validarProveedor(
    Object.freeze({
      id: ID_PROVEEDOR_VIARIO,
      capa: Capa.VIARIO,
      prioridad,
      cubre: () => true,
      atribucion: () => ATRIBUCION_OSM,

      /**
       * @param {import('urbs-core').Area} area
       * @returns {Promise<object[]>}
       */
      async obtenerViario(area) {
        const { datos } = await fuente.obtener(area);
        const resultado = transformarViario(datos, {
          proveedorId: ID_PROVEEDOR_VIARIO,
          soloConducibles,
        });
        reportar(Capa.VIARIO, ID_PROVEEDOR_VIARIO, resultado.incidencias);
        return resultado.tramos;
      },
    }),
  );

  return Object.freeze({ edificios, viario, fuente });
}
