/**
 * Del relieve de una celda a los triangulos del terreno.
 *
 * Igual que la extrusion de edificios: entra una celda en vistas tipadas y
 * salen arrays listos para la GPU, sin tocar three.js, para que se pueda probar
 * entero en Node.
 *
 * DOS COSAS QUE SE DECIDEN AQUI Y SE NOTAN EN TODO LO DEMAS:
 *
 * 1. ESTA MALLA ES LA SUPERFICIE OFICIAL. Es lo que se ve, lo que pisa el coche
 *    y lo que leera Rapier. Todo lo que se apoye en el suelo se apoya en ELLA y
 *    no en el dato fino del que salio: el MDT se muestrea a 2 m en el
 *    preprocesado, pero eso se consume alli y no se envia. Una calle que tomara
 *    su cota del dato fino quedaria flotando o enterrada respecto a lo que se
 *    ve, con luz por debajo a lo largo de toda la calle.
 * 2. EL MAR SALE SOLO. No hay capa de agua ni poligonos de costa: el MDT ya
 *    trae el mar, y la linea de costa es donde la cota cruza el umbral. Lo
 *    unico que hace falta es pintarlo distinto.
 */

/**
 * Si un poste es agua, segun la bandera que trae la celda.
 *
 * @param {{agua: Uint8Array}} relieve
 * @param {number} indice
 * @returns {boolean}
 */
function esAgua(relieve, indice) {
  return relieve.agua !== undefined && (relieve.agua[indice >> 3] & (1 << (indice & 7))) !== 0;
}

/** Color de la tierra. Gris neutro: el protagonista es la ciudad. */
export const COLOR_TIERRA = Object.freeze([0.43, 0.44, 0.46]);

/** Color del agua. */
export const COLOR_AGUA = Object.freeze([0.16, 0.26, 0.36]);

/** Centinela de poste sin dato dentro de la malla enviada. */
export const SIN_DATO_RELIEVE = -32768;

/**
 * Cota de un poste de la malla, en metros, o `null` si no hay dato.
 *
 * @param {{cotas: Int16Array, cotaBase: number}} relieve
 * @param {number} indice
 * @returns {number|null}
 */
export function cotaDePoste(relieve, indice) {
  const bruto = relieve.cotas[indice];
  return bruto === SIN_DATO_RELIEVE ? null : relieve.cotaBase + bruto / 10;
}

/**
 * Cota del terreno en un punto local de la celda, interpolando la malla.
 *
 * Es LA funcion que usa todo lo que se apoya en el suelo. Devuelve `null`
 * fuera de la celda o sobre un hueco sin dato: "no lo se" no puede disfrazarse
 * de cota, porque quien la reciba la usaria para plantar un edificio.
 *
 * @param {{cotas: Int16Array, cotaBase: number, postes: number, pasoMetros: number}} relieve
 * @param {number} este   Local a la celda
 * @param {number} norte  Local a la celda
 * @returns {number|null}
 */
export function cotaEnCelda(relieve, este, norte) {
  const { postes, pasoMetros } = relieve;
  if (postes < 2 || !Number.isFinite(este) || !Number.isFinite(norte)) {
    return null;
  }

  const lado = (postes - 1) * pasoMetros;
  if (este < 0 || este > lado || norte < 0 || norte > lado) {
    return null;
  }

  const x = este / pasoMetros;
  // La fila 0 es la del NORTE, asi que el norte alto es la fila baja.
  const y = (lado - norte) / pasoMetros;

  const columna = Math.min(Math.floor(x), postes - 2);
  const fila = Math.min(Math.floor(y), postes - 2);
  const fx = x - columna;
  const fy = y - fila;

  const a = cotaDePoste(relieve, fila * postes + columna);
  const b = cotaDePoste(relieve, fila * postes + columna + 1);
  const c = cotaDePoste(relieve, (fila + 1) * postes + columna);
  const d = cotaDePoste(relieve, (fila + 1) * postes + columna + 1);
  if (a === null || b === null || c === null || d === null) {
    return null;
  }

  const arriba = a + (b - a) * fx;
  const abajo = c + (d - c) * fx;
  return arriba + (abajo - arriba) * fy;
}

/**
 * Construye la malla de terreno de una celda.
 *
 * @param {Object} vistas  Lo que devuelve `vistasDeCelda`
 * @param {Object} [opciones]
 * @param {number} [opciones.umbralAgua]  Metros; por debajo se pinta de agua
 * @returns {{posiciones: Float32Array, normales: Float32Array, colores: Float32Array,
 *           indices: Uint32Array, triangulos: number}|null}
 */
export function construirTerrenoDeCelda(vistas, { umbralAgua = 0 } = {}) {
  const relieve = {
    cotas: vistas.relieve.cotas,
    cotaBase: vistas.relieve.cotaBase,
    postes: vistas.relieve.postes,
    pasoMetros: vistas.relieve.pasoMetros,
  };
  const { postes, pasoMetros } = relieve;
  if (postes < 2) {
    return null;
  }

  const lado = (postes - 1) * pasoMetros;
  const posiciones = new Float32Array(postes * postes * 3);
  const colores = new Float32Array(postes * postes * 3);

  for (let fila = 0; fila < postes; fila += 1) {
    for (let columna = 0; columna < postes; columna += 1) {
      const indice = fila * postes + columna;
      const cota = cotaDePoste(relieve, indice);
      const este = columna * pasoMetros;
      const norte = lado - fila * pasoMetros;

      const base = indice * 3;
      posiciones[base] = este;
      // Un hueco sin dato se deja al nivel del umbral en vez de hundirse a
      // cero: un pozo de treinta metros en mitad de la ciudad se ve mucho peor
      // que un trozo llano.
      posiciones[base + 1] = cota ?? umbralAgua;
      posiciones[base + 2] = -norte;

      // La bandera la decidio el preprocesado con el territorio entero delante.
      // Aqui NO se vuelve a decidir: estar bajo la cota del agua no basta para
      // ser agua —hay trincheras, diques secos y rampas por debajo— y lo que
      // distingue el mar de un socavon es que sale del territorio.
      const color = esAgua(vistas.relieve, indice) ? COLOR_AGUA : COLOR_TIERRA;
      colores[base] = color[0];
      colores[base + 1] = color[1];
      colores[base + 2] = color[2];
    }
  }

  // Normales por vertice a partir de las diferencias centrales: el terreno SI
  // quiere aristas suaves, al reves que las fachadas.
  const normales = new Float32Array(postes * postes * 3);
  for (let fila = 0; fila < postes; fila += 1) {
    for (let columna = 0; columna < postes; columna += 1) {
      const indice = fila * postes + columna;
      const izquierda = posiciones[(fila * postes + Math.max(columna - 1, 0)) * 3 + 1];
      const derecha = posiciones[(fila * postes + Math.min(columna + 1, postes - 1)) * 3 + 1];
      const arriba = posiciones[(Math.max(fila - 1, 0) * postes + columna) * 3 + 1];
      const abajo = posiciones[(Math.min(fila + 1, postes - 1) * postes + columna) * 3 + 1];

      const anchoEste = (columna === 0 || columna === postes - 1 ? 1 : 2) * pasoMetros;
      const anchoNorte = (fila === 0 || fila === postes - 1 ? 1 : 2) * pasoMetros;

      // El gradiente en X y en Z da la normal sin raices ni productos cruzados.
      const nx = -(derecha - izquierda) / anchoEste;
      const nz = (abajo - arriba) / anchoNorte;
      const largo = Math.hypot(nx, 1, nz);

      const base = indice * 3;
      normales[base] = nx / largo;
      normales[base + 1] = 1 / largo;
      normales[base + 2] = nz / largo;
    }
  }

  const indices = new Uint32Array((postes - 1) * (postes - 1) * 6);
  let k = 0;
  for (let fila = 0; fila < postes - 1; fila += 1) {
    for (let columna = 0; columna < postes - 1; columna += 1) {
      const a = fila * postes + columna;
      const b = a + 1;
      const c = a + postes;
      const d = c + 1;
      // Devanado antihorario visto desde arriba, igual que la calzada.
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  return { posiciones, normales, colores, indices, triangulos: indices.length / 3 };
}

/**
 * Alturas de la celda en el orden que quiere el campo de alturas de Rapier.
 *
 * El punto (i, j) de un `heightfield` de Rapier es `alturas[i + j * (filas+1)]`,
 * donde `i` recorre el eje X —el este— y `j` el eje Z. En la malla de aqui el
 * indice es `fila * postes + columna`, con la fila recorriendo el norte de
 * arriba abajo, o sea la Z: los dos indices coinciden, y por eso esto es una
 * copia y no una transposicion.
 *
 * Se escribe igualmente como funcion con nombre y con prueba, porque es
 * exactamente la clase de coincidencia que alguien "arregla" mas adelante
 * transponiendo, y el sintoma seria un terreno girado sobre el que se conduce
 * sin que la pantalla lo delate.
 *
 * @param {{cotas: Int16Array, cotaBase: number, postes: number}} relieve
 * @param {number} [nivelSinDato]  Que cota poner donde no hay dato
 * @returns {Float32Array}
 */
export function alturasParaRapier(relieve, nivelSinDato = 0) {
  const { postes } = relieve;
  const alturas = new Float32Array(postes * postes);
  for (let i = 0; i < alturas.length; i += 1) {
    const cota = cotaDePoste(relieve, i);
    alturas[i] = cota === null ? nivelSinDato : cota;
  }
  return alturas;
}

/** Metros que un puente deja libres sobre lo que cruza. */
export const RESGUARDO_PUENTE = 1.2;

/**
 * Cotas del tablero de un puente, vertice a vertice.
 *
 * Un puente NO sigue el terreno: lo salva. Si se muestreara como una calle a
 * rasante quedaria pegado al fondo de la ria o del valle que cruza, y en las
 * entradas a la ciudad eso se ve al instante — y ademas se conduce por dentro.
 *
 * El tablero se traza como una RAMPA entre las cotas de sus dos extremos, que
 * es donde el puente de verdad se apoya, y luego se sube en bloque lo justo
 * para que en ningun punto baje de `RESGUARDO_PUENTE` sobre el terreno. Asi la
 * rampa se conserva —un puente que sube, sube— pero no se hunde en nada.
 *
 * Es deliberadamente tosco: no hay pilas, ni peralte, ni perfil de tablero. Lo
 * que importa ahora es que no atraviese lo que cruza.
 *
 * @param {Float32Array} eje  Pares [este, norte] locales, ya limpios
 * @param {Object} relieve
 * @returns {Float32Array}  Una cota por vertice
 */
export function cotasDePuente(eje, relieve) {
  const vertices = eje.length / 2;
  const cotas = new Float32Array(vertices);
  if (vertices === 0) {
    return cotas;
  }

  const enSuelo = new Float32Array(vertices);
  for (let i = 0; i < vertices; i += 1) {
    enSuelo[i] = cotaEnCelda(relieve, eje[i * 2], eje[i * 2 + 1]) ?? 0;
  }
  if (vertices === 1) {
    cotas[0] = enSuelo[0] + RESGUARDO_PUENTE;
    return cotas;
  }

  // Recorrido acumulado, para que la rampa reparta por distancia y no por
  // numero de vertices: un tramo con vertices apinados en un extremo saldria
  // torcido si se repartiera por indice.
  const recorrido = new Float32Array(vertices);
  for (let i = 1; i < vertices; i += 1) {
    recorrido[i] =
      recorrido[i - 1] +
      Math.hypot(eje[i * 2] - eje[(i - 1) * 2], eje[i * 2 + 1] - eje[(i - 1) * 2 + 1]);
  }
  const total = recorrido[vertices - 1];

  const inicio = enSuelo[0];
  const fin = enSuelo[vertices - 1];
  let subida = 0;
  for (let i = 0; i < vertices; i += 1) {
    const t = total === 0 ? 0 : recorrido[i] / total;
    cotas[i] = inicio + (fin - inicio) * t;
    // Cuanto habria que subir el tablero entero para librar AQUI.
    subida = Math.max(subida, enSuelo[i] + RESGUARDO_PUENTE - cotas[i]);
  }
  for (let i = 0; i < vertices; i += 1) {
    cotas[i] += subida;
  }

  return cotas;
}
