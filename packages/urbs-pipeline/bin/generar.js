#!/usr/bin/env node
/**
 * `urbs generar`: la orden que convierte un territorio declarado en celdas.
 *
 *     npm run generar -- territorios/marineda-casco-historico.json
 *
 * Todo lo que hace de verdad esta probado en otra parte: esto solo lee los
 * argumentos, monta el registro de proveedores, llama a `generarCeldas` y
 * cuenta que ha pasado. Si algo aqui crece hasta tener logica, se baja a
 * `src/` con sus pruebas.
 *
 * La red se toca UNA vez por bbox: la cache de `datos/crudos/` convierte la
 * segunda ejecucion en un preprocesado offline. Volver a descargar es una
 * decision explicita (`--refrescar`), nunca un efecto lateral.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { crearRegistro } from 'urbs-core';
import { crearProveedoresOsm, DIRECTORIO_CRUDOS_POR_DEFECTO } from 'urbs-providers';

import { DIRECTORIO_CELDAS_POR_DEFECTO, generarCeldas } from '../src/generar.js';
import { NOMBRE_INDICE, construirIndice } from '../src/indice.js';
import { cargarDefinicion } from '../src/territorios.js';

const USO = `
Uso: npm run generar -- <territorio.json> [opciones]

  --salida <dir>      Donde escribir las celdas (por defecto: ${DIRECTORIO_CELDAS_POR_DEFECTO})
  --crudos <dir>      Cache de descargas (por defecto: ${DIRECTORIO_CRUDOS_POR_DEFECTO})
  --refrescar         Vuelve a descargar aunque haya cache
  --solo-conducibles  Recorta el viario al grafo por el que se puede circular
  --ayuda             Esto
`.trimStart();

/** Separador de miles, para que 33.000 edificios no se lean como 33. */
const numero = new Intl.NumberFormat('es-ES');

/**
 * @param {number} bytes
 * @returns {string}
 */
function humanizarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Vuelca el informe en la consola. Responde a las dos preguntas que uno se
 * hace despues de un preprocesado largo: que ha salido, y de donde.
 *
 * @param {Object} informe
 * @param {string} rutaIndice
 * @returns {void}
 */
function contarQueHaPasado(informe, rutaIndice) {
  const { territorio, totales, capas, sinCobertura, atribuciones, celdas } = informe;

  console.log(`\nTerritorio: ${territorio.nombre} (${territorio.id})`);
  console.log(`  EPSG ${territorio.epsg}, celdas de ${territorio.ladoCeldaMetros} m`);
  console.log(
    `  Area  [${territorio.area.lonMin}, ${territorio.area.latMin}] .. [${territorio.area.lonMax}, ${territorio.area.latMax}]`,
  );

  console.log('\nFuentes por capa:');
  for (const [capa, proveedor] of Object.entries(capas)) {
    console.log(`  ${capa.padEnd(10)} ${proveedor ?? '- sin proveedor -'}`);
  }
  if (sinCobertura.length > 0) {
    console.log(`  Sin cobertura: ${sinCobertura.join(', ')} (la generacion ha seguido)`);
  }

  console.log('\nResultado:');
  console.log(`  Celdas escritas  ${numero.format(totales.celdas)}`);
  console.log(`  Edificios        ${numero.format(totales.edificios)}`);
  console.log(`  Tramos de via    ${numero.format(totales.tramos)}`);
  console.log(`  Bytes            ${numero.format(totales.bytes)} (${humanizarBytes(totales.bytes)})`);
  if (celdas.length > 0) {
    const media = Math.round(totales.bytes / celdas.length);
    const mayor = celdas.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    console.log(`  Celda media      ${humanizarBytes(media)}`);
    console.log(
      `  Celda mayor      ${mayor.clave} — ${humanizarBytes(mayor.bytes)}, ${numero.format(mayor.edificios)} edificios`,
    );
  }

  console.log('\nAtribuciones obligatorias (van a la pantalla de creditos):');
  for (const atribucion of atribuciones) {
    console.log(`  ${atribucion.texto} — ${atribucion.licencia}${atribucion.url ? ` — ${atribucion.url}` : ''}`);
  }

  console.log(`\n  Celdas en ${informe.directorioSalida}`);
  console.log(`  Indice en  ${rutaIndice}\n`);
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} Codigo de salida
 */
async function principal(argv) {
  const { values: opciones, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      salida: { type: 'string', default: DIRECTORIO_CELDAS_POR_DEFECTO },
      crudos: { type: 'string', default: DIRECTORIO_CRUDOS_POR_DEFECTO },
      refrescar: { type: 'boolean', default: false },
      'solo-conducibles': { type: 'boolean', default: false },
      ayuda: { type: 'boolean', default: false },
    },
  });

  if (opciones.ayuda || positionals.length !== 1) {
    console.log(USO);
    return opciones.ayuda ? 0 : 1;
  }

  const [rutaTerritorio] = positionals;
  const territorio = await cargarDefinicion(rutaTerritorio);

  const proveedores = crearProveedoresOsm({
    directorio: opciones.crudos,
    refrescar: opciones.refrescar,
    soloConducibles: opciones['solo-conducibles'],
  });

  const registro = crearRegistro();
  registro.registrar(proveedores.edificios);
  registro.registrar(proveedores.viario);

  console.log(`Generando "${territorio.id}" desde ${rutaTerritorio}...`);
  const comenzado = Date.now();

  const informe = await generarCeldas({
    territorio,
    registro,
    directorioSalida: opciones.salida,
  });

  const rutaIndice = join(informe.directorioSalida, NOMBRE_INDICE);
  await mkdir(dirname(rutaIndice), { recursive: true });
  await writeFile(rutaIndice, `${JSON.stringify(construirIndice(informe), null, 2)}\n`, 'utf8');

  contarQueHaPasado(informe, rutaIndice);
  console.log(`Hecho en ${((Date.now() - comenzado) / 1000).toFixed(1)} s.\n`);

  return 0;
}

process.exitCode = await principal(process.argv.slice(2));
