/**
 * urbs-providers: las fuentes de datos reales.
 *
 * Todo lo que sabe de Overpass, de GML o de GeoTIFF vive aqui. `urbs-core` no
 * conoce ninguno de estos nombres, y ese es justo el limite que permite
 * cambiar de fuente sin tocar el dominio.
 */

export {
  crearProveedoresOsm,
  crearFuenteOsm,
  ATRIBUCION_OSM,
  ID_PROVEEDOR_EDIFICIOS,
  ID_PROVEEDOR_VIARIO,
  PRIORIDAD_OSM,
} from './src/osm/proveedor.js';

export {
  crearCacheOsm,
  RespuestaOverpassError,
  DIRECTORIO_CRUDOS_POR_DEFECTO,
} from './src/osm/cache.js';

export {
  construirConsulta,
  bboxOverpass,
  USER_AGENT,
  URL_OVERPASS_POR_DEFECTO,
  TIMEOUT_CONSULTA_POR_DEFECTO,
} from './src/osm/consulta.js';

export { transformarEdificios, transformarViario } from './src/osm/transformacion.js';

export {
  tipoDeVia,
  esConducible,
  esTipoConducible,
  esHighwayIgnorado,
  usoDeEdificio,
  derivarAltura,
  resolverAnchuraOsm,
  parsearNumero,
  parsearEntero,
  TIPO_POR_HIGHWAY,
  ANCHURA_POR_HIGHWAY,
  ALTURA_POR_EDIFICIO,
  ALTURA_POR_EDIFICIO_POR_DEFECTO,
  USO_POR_EDIFICIO,
  ALTURA_MINIMA_PLAUSIBLE,
  ALTURA_MAXIMA_PLAUSIBLE,
  PLANTAS_MAXIMAS,
} from './src/osm/etiquetas.js';


export {
  AGRUPACION_MDT,
  CAMPO_DESCARGA,
  SERIE_MDT02,
  URL_CNIG_POR_DEFECTO,
  crearDescargaCnig,
  nombreDeHoja,
} from './src/pnoa/cnig.js';

export { MARGEN_VENTANA, noroesteDeVentana, ventanaDeCaja } from './src/pnoa/ventana.js';
export { abrirHoja } from './src/pnoa/hoja.js';

export { estructuraDeVia, nivelDeVia } from './src/osm/etiquetas.js';
