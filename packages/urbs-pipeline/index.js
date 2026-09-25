/**
 * urbs-pipeline: el preprocesado offline.
 *
 * Coge lo que dan los proveedores en grados, lo pasa a los metros del
 * territorio, lo reparte en celdas y escribe un `.urbscell` por celda. Es el
 * unico paquete que depende de `proj4` y el unico que toca el disco para
 * escribir territorio generado.
 */

export {
  EPSG_GEOGRAFICO,
  FALSO_ESTE_UTM,
  nombreEpsg,
  definicionProj4,
  meridianoCentral,
  crearReproyector,
  crearReproyectorDeTerritorio,
} from './src/reproyeccion.js';

export { centroideDeAnillo, centroideDePolilinea, trocear } from './src/troceado.js';

export {
  DIRECTORIO_CELDAS_POR_DEFECTO,
  EXTENSION_CELDA,
  generarCeldas,
} from './src/generar.js';

export { territorioDesdeDefinicion, cargarDefinicion } from './src/territorios.js';

export { VERSION_INDICE, NOMBRE_INDICE, construirIndice } from './src/indice.js';
