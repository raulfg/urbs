/**
 * De una fuente de relieve a la malla que viaja en cada celda.
 *
 * Dos resoluciones distintas y con trabajos distintos, y conviene no
 * confundirlas nunca:
 *
 * - La fuente se muestrea a su paso NATIVO (2 m en el MDT02) cuando hace falta
 *   precision: la cota base de un edificio sale del minimo bajo su huella, y
 *   un edificio pequeno cabe entre dos postes de una malla gruesa. Esa
 *   precision se consume aqui, en el preprocesado, y NO se envia.
 * - Lo que se ENVIA es una malla mas gruesa, porque es lo que se dibuja y lo
 *   que pisa el coche. El paso se eligio midiendo sobre la hoja real, no a
 *   ojo: a 10 m el error contra la verdad de 2 m es de 0,17 m rms en suelo
 *   urbano y la malla ocupa 1,35 KB por celda, un 10% de la celda actual. A
 *   5 m serian 5,2 KB para bajar el error a 0,06.
 *
 * El paso viaja en la cabecera de la celda, asi que esto es un valor por
 * defecto y no una ley del motor.
 */

/** Metros entre postes de la malla que se envia. Ver la nota de arriba. */
export const PASO_MALLA_POR_DEFECTO = 10;

/**
 * Muestrea la malla de una celda.
 *
 * Los postes cubren la celda de borde a borde: con lado 250 y paso 10 son 26
 * postes, del 0 al 250 inclusive. El ultimo poste cae justo en el borde, que es
 * lo que hace que dos celdas contiguas compartan cota y no quede costura.
 *
 * @param {Object} datos
 * @param {{origen: {este: number, norte: number}, ladoCeldaMetros: number}} datos.celda
 * @param {{malla: (caja: object) => Promise<object|null>}} datos.fuente
 * @param {number} [datos.paso]
 * @returns {Promise<{paso: number, cotas: Float32Array}|null>}
 */
export async function muestrearRelieveDeCelda({ celda, fuente, paso = PASO_MALLA_POR_DEFECTO }) {
  if (!(Number.isFinite(paso) && paso > 0)) {
    throw new RangeError(`muestrearRelieveDeCelda: el \`paso\` debe ser positivo, y es ${paso}`);
  }

  const lado = celda.ladoCeldaMetros;
  const postes = Math.round(lado / paso) + 1;
  if (Math.abs(postes - 1 - lado / paso) > 1e-9) {
    throw new RangeError(
      `muestrearRelieveDeCelda: el paso ${paso} no divide al lado de celda ${lado}; la malla no cerraria en el borde`,
    );
  }

  const { este: este0, norte: norte0 } = celda.origen;
  // Se pide un poco mas de la celda para que la bilineal tenga vecinos en el
  // borde; la fuente ya recorta lo que sobra.
  const malla = await fuente.malla({
    esteMin: este0 - paso,
    esteMax: este0 + lado + paso,
    norteMin: norte0 - paso,
    norteMax: norte0 + lado + paso,
  });
  if (malla === null) {
    return null;
  }

  const cotas = new Float32Array(postes * postes);
  let utiles = 0;
  for (let fila = 0; fila < postes; fila += 1) {
    // Fila 0 es la del NORTE, igual que en el GeoTIFF y en la malla de origen.
    const norte = norte0 + lado - fila * paso;
    for (let columna = 0; columna < postes; columna += 1) {
      const cota = malla.cota(este0 + columna * paso, norte);
      if (cota === null) {
        // Se deja tal cual y el codificador lo marca como poste sin dato. No se
        // inventa un cero: cero es el nivel del mar.
        cotas[fila * postes + columna] = Number.NaN;
        continue;
      }
      cotas[fila * postes + columna] = cota;
      utiles += 1;
    }
  }

  return utiles === 0 ? null : { paso, cotas };
}
