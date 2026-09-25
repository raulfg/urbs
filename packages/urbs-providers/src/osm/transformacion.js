/**
 * Transformacion de una respuesta de Overpass al dominio de URBS.
 *
 * Es una funcion pura sobre JSON ya parseado: no descarga nada, no lee disco y
 * no sabe si el JSON viene de la red o de la cache. Por eso se prueba contra
 * un fixture de veinte lineas en vez de contra Overpass.
 *
 * Los dos peligros que resuelve, y que un `for` ingenuo sobre `elements` no ve:
 *
 * 1. Las manzanas de Ciudad Vieja y Pescaderia son relaciones
 *    `type=multipolygon` con patio interior. El `building` vive en la relacion,
 *    no en sus ways, asi que recorrer solo los ways cerrados pierde el edificio
 *    entero y ademas rellena los patios.
 * 2. Un way cerrado NO es un area. Una rotonda es un anillo de asfalto, no una
 *    plaza. Ese matiz lo resuelve `osm2geojson-lite` con la heuristica de
 *    etiquetas de OSM, y por eso delegamos en el en vez de mirar si el primer
 *    nodo coincide con el ultimo.
 */

import osm2geojson from 'osm2geojson-lite';
import { crearEdificio, crearTramo, crearProcedencia } from 'urbs-core';

import {
  tipoDeVia,
  esConducible,
  esHighwayIgnorado,
  estructuraDeVia,
  nivelDeVia,
  usoDeEdificio,
  derivarAltura,
  resolverAnchuraOsm,
} from './etiquetas.js';

/**
 * Opciones de conversion:
 * - `completeFeature`: queremos la coleccion entera, no solo la primera relacion.
 * - `renderTagged`: queremos tambien los ways etiquetados, no solo relaciones.
 * - `excludeWay`: deja fuera los miembros de un multipoligono, que no son
 *   edificios por si mismos.
 */
const OPCIONES_CONVERSION = Object.freeze({
  completeFeature: true,
  renderTagged: true,
  excludeWay: true,
});

/** Numero minimo de posiciones de un anillo cerrado valido. */
const POSICIONES_MINIMAS_ANILLO = 4;

/**
 * @typedef {Object} Incidencia
 * @property {string} id         Identificador OSM del elemento afectado
 * @property {string} motivo     Que ha pasado, en una frase
 * @property {string} [etiqueta] Etiqueta descartada, si el motivo es una etiqueta
 * @property {unknown} [valor]   Valor original descartado
 */

/**
 * Convierte la respuesta de Overpass a features GeoJSON.
 * @param {{elements: unknown[]}} respuesta
 * @returns {Array<{id: string, tipoGeometria: string, coordenadas: unknown, etiquetas: Record<string, string>}>}
 */
function aFeatures(respuesta) {
  if (respuesta === null || typeof respuesta !== 'object' || !Array.isArray(respuesta.elements)) {
    throw new TypeError(
      'transformacion: se esperaba una respuesta de Overpass con un array `elements`. ' +
        'Si viene de la cache, el fichero puede estar truncado o ser una pagina de error.',
    );
  }

  const coleccion = osm2geojson(respuesta, OPCIONES_CONVERSION);

  return coleccion.features.map((feature) => {
    const { id, ...etiquetas } = feature.properties ?? {};
    return {
      id: String(id ?? feature.id),
      tipoGeometria: feature.geometry?.type ?? 'desconocida',
      coordenadas: feature.geometry?.coordinates,
      etiquetas,
    };
  });
}

/** Un anillo GeoJSON valido para el dominio: cerrado y con cuerpo. */
function anilloValido(anillo) {
  return Array.isArray(anillo) && anillo.length >= POSICIONES_MINIMAS_ANILLO;
}

/**
 * Normaliza la geometria de un edificio a una lista de huellas, cada una con
 * su anillo exterior primero y sus huecos despues.
 *
 * Un `MultiPolygon` son varios cuerpos disjuntos bajo un mismo `building`:
 * cada uno es un edificio propio, con el id de origen y un sufijo.
 */
function huellasDe(feature) {
  if (feature.tipoGeometria === 'Polygon') {
    return [feature.coordenadas];
  }
  if (feature.tipoGeometria === 'MultiPolygon') {
    return feature.coordenadas;
  }
  return [];
}

/**
 * Transforma la respuesta de Overpass en edificios del dominio.
 *
 * @param {{elements: unknown[]}} respuesta  JSON de Overpass ya parseado
 * @param {{proveedorId: string, alturaPlanta?: number}} opciones
 * @returns {{edificios: import('urbs-core').Edificio[], incidencias: Incidencia[]}}
 */
export function transformarEdificios(respuesta, { proveedorId, alturaPlanta } = {}) {
  exigirProveedorId(proveedorId, 'transformarEdificios');

  /** @type {Incidencia[]} */
  const incidencias = [];
  const edificios = [];

  for (const feature of aFeatures(respuesta)) {
    if (feature.etiquetas.building === undefined) {
      continue;
    }

    const huellas = huellasDe(feature);
    if (huellas.length === 0) {
      incidencias.push({
        id: feature.id,
        motivo: `etiquetado como building pero su geometria no es un poligono (${feature.tipoGeometria})`,
      });
      continue;
    }

    const altura = derivarAltura(feature.etiquetas, { alturaPlanta });
    for (const rechazo of altura.rechazos) {
      incidencias.push({ id: feature.id, motivo: rechazo.motivo, etiqueta: rechazo.etiqueta, valor: rechazo.valor });
    }

    const uso = usoDeEdificio(feature.etiquetas);
    const procedencia = crearProcedencia({
      proveedor: proveedorId,
      confianza: altura.confianza,
      nota: altura.nota ?? undefined,
    });

    huellas.forEach((huella, indice) => {
      const anillos = huella.filter(anilloValido);
      if (anillos.length === 0) {
        incidencias.push({
          id: feature.id,
          motivo: `anillo exterior degenerado: menos de ${POSICIONES_MINIMAS_ANILLO} posiciones`,
        });
        return;
      }

      edificios.push(
        crearEdificio({
          id: huellas.length === 1 ? feature.id : `${feature.id}#${indice}`,
          huella: anillos,
          alturaMetros: altura.alturaMetros,
          plantas: altura.plantas,
          uso,
          procedencia,
        }),
      );
    });
  }

  return { edificios, incidencias };
}

/**
 * Transforma la respuesta de Overpass en tramos de viario.
 *
 * Por defecto devuelve TODAS las vias, peatonales incluidas: la capa de
 * peatones las necesita. `soloConducibles` es lo que separa el grafo del
 * trafico, y filtra por etiquetas (clase y acceso), no por tipo de dominio,
 * porque un `service` con `access=no` sigue siendo `TipoVia.SERVICIO`.
 *
 * @param {{elements: unknown[]}} respuesta
 * @param {{proveedorId: string, soloConducibles?: boolean}} opciones
 * @returns {{tramos: import('urbs-core').Tramo[], incidencias: Incidencia[]}}
 */
export function transformarViario(respuesta, { proveedorId, soloConducibles = false } = {}) {
  exigirProveedorId(proveedorId, 'transformarViario');

  /** @type {Incidencia[]} */
  const incidencias = [];
  const tramos = [];

  for (const feature of aFeatures(respuesta)) {
    const { etiquetas } = feature;
    if (etiquetas.highway === undefined) {
      continue;
    }
    if (esHighwayIgnorado(etiquetas)) {
      continue;
    }
    if (soloConducibles && !esConducible(etiquetas)) {
      continue;
    }

    const tipo = tipoDeVia(etiquetas);
    if (tipo === null) {
      incidencias.push({
        id: feature.id,
        motivo: `valor de highway sin traduccion al dominio`,
        etiqueta: 'highway',
        valor: etiquetas.highway,
      });
      continue;
    }

    if (feature.tipoGeometria !== 'LineString') {
      incidencias.push({
        id: feature.id,
        motivo: `via sin eje lineal: su geometria es ${feature.tipoGeometria} (probablemente area=yes)`,
      });
      continue;
    }

    const anchura = resolverAnchuraOsm({ etiquetas, tipo });
    for (const rechazo of anchura.rechazos) {
      incidencias.push({ id: feature.id, motivo: rechazo.motivo, etiqueta: rechazo.etiqueta, valor: rechazo.valor });
    }

    tramos.push(
      crearTramo({
        id: feature.id,
        eje: feature.coordenadas,
        tipo,
        anchuraMetros: anchura.anchuraMetros,
        carriles: anchura.carriles,
        sentidoUnico: etiquetas.oneway === 'yes' || etiquetas.oneway === '-1',
        nombre: etiquetas.name ?? null,
        // Sin esto, en cuanto haya relieve cada puente se hunde en lo que
        // cruza y cada boca de tunel queda enterrada.
        estructura: estructuraDeVia(etiquetas),
        nivel: nivelDeVia(etiquetas),
        procedencia: crearProcedencia({
          proveedor: proveedorId,
          confianza: anchura.confianza,
          nota: anchura.nota ?? undefined,
        }),
      }),
    );
  }

  return { tramos, incidencias };
}

function exigirProveedorId(proveedorId, quien) {
  if (typeof proveedorId !== 'string' || proveedorId.length === 0) {
    throw new TypeError(
      `${quien}: falta \`proveedorId\`. Todo valor del dominio debe poder decir de donde sale.`,
    );
  }
}
