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
export { Capa, validarProveedor, metodoDeCapa } from './src/proveedores/contratos.js';
export { crearRegistro, SinCoberturaError } from './src/proveedores/registro.js';
