/**
 * urbs-viewer: el runtime en el navegador.
 *
 * Este barril solo exporta lo que NO depende de un navegador: la extrusion,
 * el origen flotante y el streaming. Todo eso se prueba en Node, sin canvas y
 * sin WebGL, y esa es exactamente la linea que separa `src/` de `publico/`.
 *
 * El codigo que toca three.js vive en `publico/` y lo carga el navegador tal
 * cual: no hay empaquetador ni paso de compilacion. El mapa de importaciones
 * de `publico/index.html` resuelve `three`, `earcut` y `urbs-core`.
 */

export {
  ALTURA_POR_DEFECTO,
  ALTURA_VIARIO,
  COLOR_POR_CONFIANZA,
  COLOR_DESCONOCIDO,
  COLOR_VIARIO,
  alturaDeEdificio,
  orientarAnillo,
  construirGeometriaDeCelda,
} from './src/geometria.js';

export {
  LIMITE_INGLETE,
  PROLONGACION_EXTREMO,
  TOLERANCIA_VERTICE,
  bordesDeCalzada,
  limpiarEje,
} from './src/calzada.js';

export {
  UMBRAL_REBASE_POR_DEFECTO,
  aEscena,
  desplazamientoDeCelda,
  crearOrigenFlotante,
} from './src/origen-flotante.js';

export { distanciaACelda, celdasEnRadio, planDeCarga } from './src/streaming.js';
