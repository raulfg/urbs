/**
 * urbs-core: el dominio y los contratos.
 *
 * Este paquete no sabe de que pais come, no descarga nada y no pinta nada.
 * Si algo aqui dentro menciona A Coruna, Catastro o three.js, esta en el
 * paquete equivocado.
 */

export { crearArea, contiene, intersecan, centro } from './src/dominio/area.js';
export { Confianza, crearProcedencia } from './src/dominio/procedencia.js';
export {
  UsoEdificio,
  crearEdificio,
  ALTURA_PLANTA_POR_DEFECTO,
} from './src/dominio/edificio.js';
export {
  Estructura,
  NIVEL_MAXIMO,
  TipoVia,
  crearTramo,
  resolverAnchura,
  ANCHURA_POR_TIPO,
  ANCHURA_CARRIL,
} from './src/dominio/viario.js';
export {
  zonaUtm,
  epsgUtmWgs84,
  epsgUtmEtrs89,
  epsgRecomendado,
} from './src/dominio/proyeccion.js';
export { crearTerritorio, LADO_CELDA_POR_DEFECTO } from './src/dominio/territorio.js';
export {
  BITS_MANTISA_FLOAT32,
  PRECISION_FLOAT32_POR_DEFECTO,
  indiceDeCelda,
  origenDeCelda,
  claveDeCelda,
  crearCelda,
  celdaDePunto,
  aLocal,
  aProyectado,
  pasoFloat32,
  esSeguroEnFloat32,
  exigirCoordenadasLocales,
} from './src/dominio/celda.js';
export { SIN_DATO, crearMallaElevacion, hayDato } from './src/dominio/elevacion.js';
export { UMBRAL_AGUA_DE_RESERVA, mascaraDeAguaPorUmbral } from './src/dominio/agua.js';
export {
  MAGIA_URBSCELL,
  VERSION_FORMATO,
  BYTES_CABECERA,
  SIN_DATO_RELIEVE,
  ALINEACION_SECCION,
  MARGEN_EN_LADOS_POR_DEFECTO,
  AUSENTE_ENTERO,
  margenPorDefecto,
  codificarCelda,
  decodificarCelda,
  vistasDeCelda,
  leerCabecera,
} from './src/formato/celda-binaria.js';
export { Capa, validarProveedor, metodoDeCapa } from './src/proveedores/contratos.js';
export { crearRegistro, SinCoberturaError } from './src/proveedores/registro.js';
