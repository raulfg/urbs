/**
 * Generar: el punto de entrada del preprocesado.
 *
 * Es la unica pieza que ve la cadena entera. Pide las capas al registro de
 * proveedores, las proyecta a los metros del territorio, las reparte en celdas
 * y escribe un `.urbscell` por celda con contenido. Devuelve un informe que
 * responde a las dos preguntas que uno se hace despues de un preprocesado
 * largo: que ha salido, y de donde han salido los datos.
 *
 * La degradacion se hace visible en vez de silenciarse: una capa sin cobertura
 * se anota en el informe y la generacion sigue, porque un territorio con
 * calles y sin edificios es un resultado legitimo. Un proveedor que revienta
 * es otra cosa —un fallo, no una degradacion— y ese error sube tal cual.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Capa, SinCoberturaError, codificarCelda, margenPorDefecto } from 'urbs-core';

import { crearReproyectorDeTerritorio } from './reproyeccion.js';
import { trocear } from './troceado.js';

/** Directorio de salida por defecto. Esta en `.gitignore`: es territorio generado. */
export const DIRECTORIO_CELDAS_POR_DEFECTO = 'datos/celdas';

/** Extension de los archivos de celda. */
export const EXTENSION_CELDA = '.urbscell';

/** Capas que este pipeline sabe trocear hoy. Relieve y suelo aun no. */
const CAPAS_GENERADAS = Object.freeze([Capa.EDIFICIOS, Capa.VIARIO]);

/**
 * @typedef {Object} ResumenDeCelda
 * @property {string} clave
 * @property {{x: number, z: number}} indice
 * @property {{este: number, norte: number}} origen
 * @property {number} edificios
 * @property {number} tramos
 * @property {number} bytes
 * @property {string} ruta
 */

/**
 * Escritor por defecto: crea el directorio que falte y vuelca los bytes.
 *
 * @param {string} ruta
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
async function escribirEnDisco(ruta, bytes) {
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, bytes);
}

/**
 * Pide una capa al registro. Si no hay cobertura devuelve una lista vacia y lo
 * dice; cualquier otro error sube.
 *
 * @param {ReturnType<import('urbs-core').crearRegistro>} registro
 * @param {string} capa
 * @param {import('urbs-core').Area} area
 * @returns {Promise<{elementos: unknown[], cubierta: boolean}>}
 */
async function pedirCapa(registro, capa, area) {
  try {
    const elementos = await registro.obtener(capa, area);
    return { elementos: elementos ?? [], cubierta: true };
  } catch (error) {
    if (error instanceof SinCoberturaError) {
      return { elementos: [], cubierta: false };
    }
    throw error;
  }
}

/**
 * Genera las celdas de un territorio.
 *
 * @param {Object} datos
 * @param {import('urbs-core').Territorio} datos.territorio
 * @param {ReturnType<import('urbs-core').crearRegistro>} datos.registro
 * @param {string} [datos.directorioSalida]
 * @param {(ruta: string, bytes: Uint8Array) => Promise<void>} [datos.escribir]
 *        Inyectable para poder probar sin tocar el disco
 * @param {number} [datos.margenMetros]
 * @returns {Promise<Object>} Informe de la generacion
 */
export async function generarCeldas({
  territorio,
  registro,
  directorioSalida = DIRECTORIO_CELDAS_POR_DEFECTO,
  escribir = escribirEnDisco,
  margenMetros,
}) {
  if (territorio === null || typeof territorio !== 'object' || typeof territorio.id !== 'string') {
    throw new TypeError(
      'generarCeldas: `territorio` es obligatorio y debe venir de crearTerritorio',
    );
  }
  if (registro === null || typeof registro !== 'object' || typeof registro.obtener !== 'function') {
    throw new TypeError('generarCeldas: `registro` es obligatorio y debe venir de crearRegistro');
  }
  if (typeof escribir !== 'function') {
    throw new TypeError('generarCeldas: `escribir` debe ser una funcion (ruta, bytes) => Promise');
  }

  const { area, ladoCeldaMetros } = territorio;
  const margen = margenMetros ?? margenPorDefecto(ladoCeldaMetros);

  const [edificios, viario] = await Promise.all(
    CAPAS_GENERADAS.map((capa) => pedirCapa(registro, capa, area)),
  );

  const sinCobertura = CAPAS_GENERADAS.filter(
    (capa, posicion) => ![edificios, viario][posicion].cubierta,
  );

  const celdas = trocear({
    edificios: /** @type {any[]} */ (edificios.elementos),
    tramos: /** @type {any[]} */ (viario.elementos),
    reproyector: crearReproyectorDeTerritorio(territorio),
    ladoCeldaMetros,
    margenMetros: margen,
  });

  const directorioTerritorio = join(directorioSalida, territorio.id);
  /** @type {ResumenDeCelda[]} */
  const resumenes = [];

  for (const contenido of celdas.values()) {
    const bytes = codificarCelda(contenido);
    const ruta = join(directorioTerritorio, `${contenido.celda.clave}${EXTENSION_CELDA}`);
    await escribir(ruta, bytes);

    resumenes.push(
      Object.freeze({
        clave: contenido.celda.clave,
        indice: contenido.celda.indice,
        origen: contenido.celda.origen,
        edificios: contenido.edificios.length,
        tramos: contenido.tramos.length,
        bytes: bytes.length,
        ruta,
      }),
    );
  }

  return Object.freeze({
    territorio: Object.freeze({
      id: territorio.id,
      nombre: territorio.nombre,
      epsg: territorio.epsg,
      ladoCeldaMetros,
      area,
    }),
    directorioSalida: directorioTerritorio,
    margenMetros: margen,
    // De donde sale cada capa y que se quedo sin fuente. Es la degradacion
    // visible de un vistazo, sin abrir un solo archivo de celda.
    capas: Object.freeze(registro.diagnostico(area)),
    sinCobertura: Object.freeze(sinCobertura),
    // Lo que tiene que aparecer en la pantalla de creditos, calculado a partir
    // de los proveedores que cubren este area: no depende de que nadie se
    // acuerde de actualizar una lista a mano.
    atribuciones: Object.freeze(registro.atribucionesPara(area)),
    celdas: Object.freeze(resumenes),
    totales: Object.freeze({
      celdas: resumenes.length,
      edificios: resumenes.reduce((suma, celda) => suma + celda.edificios, 0),
      tramos: resumenes.reduce((suma, celda) => suma + celda.tramos, 0),
      bytes: resumenes.reduce((suma, celda) => suma + celda.bytes, 0),
    }),
  });
}
