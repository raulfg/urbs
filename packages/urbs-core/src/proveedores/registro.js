/**
 * Registro de proveedores: donde vive la degradacion en cascada.
 *
 * El motor pide una capa para un area. El registro ordena los proveedores de
 * esa capa por prioridad y devuelve el primero que declare cubrir el area.
 * Si Catastro cubre, gana Catastro. Si no, baja a OSM. Si no cubre nadie, lo
 * dice claramente en vez de devolver una ciudad vacia sin explicacion.
 */

import { validarProveedor, metodoDeCapa, Capa } from './contratos.js';

/**
 * Error especifico de cobertura. Tiene tipo propio para que el pipeline pueda
 * distinguir "no hay datos aqui" de "el proveedor ha petado".
 */
export class SinCoberturaError extends Error {
  /**
   * @param {string} capa
   * @param {import('../dominio/area.js').Area} area
   * @param {string[]} candidatos Ids de los proveedores que se intentaron
   */
  constructor(capa, area, candidatos) {
    const detalle = candidatos.length
      ? `Proveedores consultados: ${candidatos.join(', ')}`
      : 'No hay ningun proveedor registrado para esta capa';
    super(
      `Sin cobertura de "${capa}" para el area [${area.lonMin}, ${area.latMin}, ${area.lonMax}, ${area.latMax}]. ${detalle}`,
    );
    this.name = 'SinCoberturaError';
    this.capa = capa;
    this.area = area;
    this.candidatos = candidatos;
  }
}

/**
 * Crea un registro vacio de proveedores.
 */
export function crearRegistro() {
  /** @type {Map<string, import('./contratos.js').Proveedor[]>} */
  const porCapa = new Map();
  /** @type {Set<string>} */
  const idsUsados = new Set();

  /**
   * Registra un proveedor. Valida el contrato en este momento, no al usarlo.
   * @param {import('./contratos.js').Proveedor} proveedor
   */
  function registrar(proveedor) {
    validarProveedor(proveedor);

    if (idsUsados.has(proveedor.id)) {
      throw new Error(`registrar: ya existe un proveedor con id "${proveedor.id}"`);
    }
    idsUsados.add(proveedor.id);

    const lista = porCapa.get(proveedor.capa) ?? [];
    lista.push(proveedor);
    // Mayor prioridad primero. La fuente rica se intenta antes que el fallback.
    lista.sort((a, b) => b.prioridad - a.prioridad);
    porCapa.set(proveedor.capa, lista);

    return registro;
  }

  /**
   * Devuelve el proveedor de mayor prioridad que cubra el area, o null.
   * @param {string} capa
   * @param {import('../dominio/area.js').Area} area
   * @returns {import('./contratos.js').Proveedor|null}
   */
  function resolver(capa, area) {
    const lista = porCapa.get(capa) ?? [];
    for (const proveedor of lista) {
      if (proveedor.cubre(area)) {
        return proveedor;
      }
    }
    return null;
  }

  /**
   * Pide una capa para un area, delegando en el proveedor que toque.
   * @param {string} capa
   * @param {import('../dominio/area.js').Area} area
   * @returns {Promise<unknown>}
   */
  async function obtener(capa, area) {
    const proveedor = resolver(capa, area);
    if (proveedor === null) {
      const candidatos = (porCapa.get(capa) ?? []).map((p) => p.id);
      throw new SinCoberturaError(capa, area, candidatos);
    }
    return proveedor[metodoDeCapa(capa)](area);
  }

  /**
   * Atribuciones de los proveedores que realmente cubririan este area.
   * Esto es lo que alimenta la pantalla de creditos: solo se cita lo que se usa.
   *
   * @param {import('../dominio/area.js').Area} area
   * @returns {import('./contratos.js').Atribucion[]}
   */
  function atribucionesPara(area) {
    const vistas = new Set();
    const atribuciones = [];

    for (const capa of Object.values(Capa)) {
      const proveedor = resolver(capa, area);
      if (proveedor === null) continue;

      const atribucion = proveedor.atribucion();
      const clave = `${atribucion.fuente}|${atribucion.licencia}`;
      if (vistas.has(clave)) continue;

      vistas.add(clave);
      atribuciones.push(atribucion);
    }

    return atribuciones;
  }

  /**
   * Informe de que fuente serviria cada capa en este area. Es la herramienta
   * para ver la degradacion de un vistazo antes de lanzar un preprocesado largo.
   *
   * @param {import('../dominio/area.js').Area} area
   * @returns {Record<string, string|null>}
   */
  function diagnostico(area) {
    const informe = {};
    for (const capa of Object.values(Capa)) {
      informe[capa] = resolver(capa, area)?.id ?? null;
    }
    return informe;
  }

  const registro = Object.freeze({
    registrar,
    resolver,
    obtener,
    atribucionesPara,
    diagnostico,
  });

  return registro;
}
