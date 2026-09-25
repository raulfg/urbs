/**
 * Celda: la unidad de troceado del territorio y el sistema de coordenadas
 * locales que la acompana.
 *
 * Aqui vive la regla que sostiene toda la precision de URBS: la geometria se
 * guarda SIEMPRE relativa a la esquina de su celda, nunca en UTM absoluto.
 * Una coordenada UTM absoluta metida en un Float32Array cuantiza la ciudad
 * entera: en el norte de A Coruna, 4.800.000 cae entre 2^22 y 2^23, asi que el
 * escalon representable en float32 es de 0,5 m exactos. Medio metro de error
 * son medianeras separadas, aceras en z-fighting, normales rotas y temblor de
 * la geometria al conducir.
 *
 * Con coordenadas locales de 0 a `ladoCeldaMetros` el mismo float32 ofrece
 * micras. El origen absoluto de la celda vive una sola vez, en float64, y se
 * reconstruye del indice por multiplicacion exacta: nunca se acumula.
 *
 * Todo este modulo trabaja en METROS PROYECTADOS que aporta quien llama.
 * Proyectar de grados a metros es cosa del pipeline, no del dominio.
 */

/** Bits de mantisa de un float32, contando el bit implicito. */
export const BITS_MANTISA_FLOAT32 = 24;

/** Exponente minimo normalizado de float32. */
const EXPONENTE_MINIMO_FLOAT32 = -126;

/** Paso entre subnormales de float32: el escalon mas fino que existe. */
const PASO_SUBNORMAL_FLOAT32 = 2 ** -149;

/**
 * Precision exigida por defecto a una coordenada que va a un buffer float32.
 * Un milimetro: por debajo de eso ningun detalle urbano se nota.
 */
export const PRECISION_FLOAT32_POR_DEFECTO = 0.001;

/**
 * @typedef {Object} PuntoProyectado
 * @property {number} este   Metros en el eje X del sistema proyectado
 * @property {number} norte  Metros en el eje Y del sistema proyectado
 */

/**
 * @typedef {Object} IndiceCelda
 * @property {number} x  Indice de columna, entero con signo
 * @property {number} z  Indice de fila, entero con signo
 */

/**
 * @typedef {Object} Celda
 * @property {IndiceCelda} indice
 * @property {PuntoProyectado} origen  Esquina suroeste, en metros absolutos
 * @property {number} ladoCeldaMetros
 * @property {string} clave
 */

/**
 * @param {unknown} valor
 * @param {string} fn
 * @returns {number}
 */
function validarLado(valor, fn) {
  if (!(Number.isFinite(valor) && valor > 0)) {
    throw new RangeError(`${fn}: \`ladoCeldaMetros\` debe ser un numero positivo y finito`);
  }
  return valor;
}

/**
 * @param {unknown} punto
 * @param {string} fn
 * @returns {PuntoProyectado}
 */
function validarPunto(punto, fn) {
  if (punto === null || typeof punto !== 'object') {
    throw new TypeError(`${fn}: se esperaba un punto proyectado {este, norte} en metros`);
  }
  const { este, norte } = /** @type {PuntoProyectado} */ (punto);
  if (!(Number.isFinite(este) && Number.isFinite(norte))) {
    throw new TypeError(`${fn}: \`este\` y \`norte\` deben ser numeros finitos en metros`);
  }
  return { este, norte };
}

/**
 * @param {unknown} indice
 * @param {string} fn
 * @returns {IndiceCelda}
 */
function validarIndice(indice, fn) {
  if (indice === null || typeof indice !== 'object') {
    throw new TypeError(`${fn}: se esperaba un indice de celda {x, z}`);
  }
  const { x, z } = /** @type {IndiceCelda} */ (indice);
  if (!(Number.isInteger(x) && Number.isInteger(z))) {
    throw new TypeError(`${fn}: \`x\` y \`z\` de un indice de celda deben ser enteros`);
  }
  return { x, z };
}

/**
 * @param {unknown} celda
 * @param {string} fn
 * @returns {Celda}
 */
function validarCelda(celda, fn) {
  if (celda === null || typeof celda !== 'object') {
    throw new TypeError(`${fn}: se esperaba una celda creada con crearCelda o celdaDePunto`);
  }
  const { indice, origen, ladoCeldaMetros } = /** @type {Celda} */ (celda);
  validarIndice(indice, fn);
  validarPunto(origen, fn);
  validarLado(ladoCeldaMetros, fn);
  return /** @type {Celda} */ (celda);
}

/**
 * Indice de la celda que contiene un valor en un eje.
 *
 * Math.floor, no truncamiento: con coordenadas negativas (hemisferio sur o
 * sistemas locales con origen dentro del territorio) truncar hacia cero
 * mandaria -12,5 a la celda 0 y produciria un local negativo.
 *
 * La division puede redondear hacia arriba en el borde exacto de una celda,
 * asi que el resultado se verifica contra la multiplicacion, que es la que
 * define el origen. Asi indice y origen nunca se contradicen.
 *
 * @param {number} valor
 * @param {number} lado
 * @returns {number}
 */
function indiceEnEje(valor, lado) {
  let indice = Math.floor(valor / lado);
  if (indice * lado > valor) {
    indice -= 1;
  } else if ((indice + 1) * lado <= valor) {
    indice += 1;
  }
  return indice;
}

/**
 * Indice de la celda que contiene un punto proyectado.
 *
 * La reticula se ancla en multiplos globales del lado, jamas en el area del
 * territorio: el indice de un punto depende del punto y del lado, de nada mas.
 * Retocar el area de un territorio no desplaza ni renombra ninguna celda.
 *
 * @param {PuntoProyectado} punto  En metros proyectados
 * @param {number} ladoCeldaMetros
 * @returns {IndiceCelda}
 */
export function indiceDeCelda(punto, ladoCeldaMetros) {
  const { este, norte } = validarPunto(punto, 'indiceDeCelda');
  const lado = validarLado(ladoCeldaMetros, 'indiceDeCelda');

  return Object.freeze({
    x: indiceEnEje(este, lado),
    z: indiceEnEje(norte, lado),
  });
}

/**
 * Esquina suroeste de una celda, en metros absolutos.
 *
 * Una sola multiplicacion por indice: exacta mientras el producto quepa en la
 * mantisa de 53 bits del float64, y sin deriva acumulada porque no hay sumas
 * encadenadas.
 *
 * @param {IndiceCelda} indice
 * @param {number} ladoCeldaMetros
 * @returns {PuntoProyectado}
 */
export function origenDeCelda(indice, ladoCeldaMetros) {
  const lado = validarLado(ladoCeldaMetros, 'origenDeCelda');
  const { x, z } = validarIndice(indice, 'origenDeCelda');

  return Object.freeze({ este: x * lado, norte: z * lado });
}

/**
 * Clave estable de una celda. Sirve de identificador en mapas y de nombre de
 * fichero: solo ASCII, sin separadores de ruta y con el signo explicito.
 *
 * @param {IndiceCelda} indice
 * @returns {string}
 */
export function claveDeCelda(indice) {
  const { x, z } = validarIndice(indice, 'claveDeCelda');
  return `x${x}z${z}`;
}

/**
 * @param {Object} datos
 * @param {IndiceCelda} datos.indice
 * @param {number} datos.ladoCeldaMetros
 * @returns {Celda}
 */
export function crearCelda({ indice, ladoCeldaMetros }) {
  const lado = validarLado(ladoCeldaMetros, 'crearCelda');
  const indiceValido = validarIndice(indice, 'crearCelda');

  return Object.freeze({
    indice: Object.freeze(indiceValido),
    origen: origenDeCelda(indiceValido, lado),
    ladoCeldaMetros: lado,
    clave: claveDeCelda(indiceValido),
  });
}

/**
 * Celda que contiene un punto proyectado.
 *
 * @param {PuntoProyectado} punto  En metros proyectados
 * @param {number} ladoCeldaMetros
 * @returns {Celda}
 */
export function celdaDePunto(punto, ladoCeldaMetros) {
  const lado = validarLado(ladoCeldaMetros, 'celdaDePunto');
  return crearCelda({ indice: indiceDeCelda(punto, lado), ladoCeldaMetros: lado });
}

/**
 * Pasa un punto absoluto a coordenadas locales de una celda.
 * El resultado cae siempre en [0, ladoCeldaMetros) si el punto pertenece a la
 * celda. Esto es lo unico que puede acabar en un Float32Array.
 *
 * @param {PuntoProyectado} punto  Absoluto, en metros proyectados
 * @param {Celda} celda
 * @returns {PuntoProyectado} Local a la esquina suroeste de la celda
 */
export function aLocal(punto, celda) {
  const { este, norte } = validarPunto(punto, 'aLocal');
  const { origen } = validarCelda(celda, 'aLocal');

  return Object.freeze({ este: este - origen.este, norte: norte - origen.norte });
}

/**
 * Devuelve un punto local a metros absolutos. La suma se hace en float64: si
 * se hiciera en float32 volveria el error de medio metro.
 *
 * @param {PuntoProyectado} local
 * @param {Celda} celda
 * @returns {PuntoProyectado} Absoluto, en metros proyectados
 */
export function aProyectado(local, celda) {
  const { este, norte } = validarPunto(local, 'aProyectado');
  const { origen } = validarCelda(celda, 'aProyectado');

  return Object.freeze({ este: este + origen.este, norte: norte + origen.norte });
}

/**
 * Exponente binario de una magnitud: el `e` tal que 2^e <= |valor| < 2^(e+1).
 * Se corrige el redondeo de Math.log2 en las potencias exactas de dos.
 *
 * @param {number} magnitud
 * @returns {number}
 */
function exponenteBinario(magnitud) {
  let exponente = Math.floor(Math.log2(magnitud));
  if (2 ** exponente > magnitud) {
    exponente -= 1;
  } else if (2 ** (exponente + 1) <= magnitud) {
    exponente += 1;
  }
  return exponente;
}

/**
 * Escalon representable en float32 a una magnitud dada, en las mismas unidades
 * que la magnitud. Es el ULP, calculado desde el exponente binario: no hay
 * tabla de umbrales que se quede obsoleta al cambiar de territorio.
 *
 * A 4.800.000 m devuelve 0,5. A 547.000 m, 0,0625. A 250 m, 15 micras.
 *
 * @param {number} magnitudMetros
 * @returns {number} Metros entre dos valores float32 consecutivos
 */
export function pasoFloat32(magnitudMetros) {
  if (!Number.isFinite(magnitudMetros)) {
    throw new RangeError('pasoFloat32: la magnitud debe ser un numero finito en metros');
  }

  const magnitud = Math.abs(magnitudMetros);
  if (magnitud === 0) {
    return PASO_SUBNORMAL_FLOAT32;
  }

  const exponente = exponenteBinario(magnitud);
  if (exponente < EXPONENTE_MINIMO_FLOAT32) {
    return PASO_SUBNORMAL_FLOAT32;
  }
  return 2 ** (exponente - (BITS_MANTISA_FLOAT32 - 1));
}

/**
 * Indica si una magnitud conserva la precision exigida dentro de un float32.
 * Hace ejecutable la regla que de otro modo seria un comentario que nadie lee.
 *
 * @param {number} magnitudMetros
 * @param {number} [precisionMetros]  Error maximo tolerable, 1 mm por defecto
 * @returns {boolean}
 */
export function esSeguroEnFloat32(
  magnitudMetros,
  precisionMetros = PRECISION_FLOAT32_POR_DEFECTO,
) {
  if (!(Number.isFinite(precisionMetros) && precisionMetros > 0)) {
    throw new RangeError('esSeguroEnFloat32: `precisionMetros` debe ser un numero positivo');
  }
  return pasoFloat32(magnitudMetros) <= precisionMetros;
}

/**
 * @param {number} valor
 * @param {string} eje
 * @param {Celda} celda
 * @param {string} etiqueta
 * @returns {void}
 */
function exigirEnRangoLocal(valor, eje, celda, etiqueta) {
  if (valor >= 0 && valor < celda.ladoCeldaMetros) {
    return;
  }

  const paso = pasoFloat32(valor);
  throw new RangeError(
    `exigirCoordenadasLocales: ${etiqueta}.${eje} = ${valor} m no es una coordenada local ` +
      `de la celda ${celda.clave}; el rango valido es [0, ${celda.ladoCeldaMetros}). ` +
      'Parece una coordenada absoluta proyectada, y a esa magnitud el escalon de float32 ' +
      `es de ${paso} m, asi que escribirla en un Float32Array cuantizaria la geometria. ` +
      'Convierte antes con aLocal(punto, celda) y guarda el origen de la celda en float64.',
  );
}

/**
 * Guarda de frontera: falla antes de que una coordenada absoluta llegue a un
 * Float32Array, a un uniform o a un buffer de fisica.
 *
 * @param {PuntoProyectado} punto  Se espera local a la celda
 * @param {Celda} celda
 * @param {string} [etiqueta]  Nombre del dato para el mensaje de error
 * @returns {PuntoProyectado} El mismo punto, si es valido
 */
export function exigirCoordenadasLocales(punto, celda, etiqueta = 'punto') {
  const { este, norte } = validarPunto(punto, 'exigirCoordenadasLocales');
  const celdaValida = validarCelda(celda, 'exigirCoordenadasLocales');

  exigirEnRangoLocal(este, 'este', celdaValida, etiqueta);
  exigirEnRangoLocal(norte, 'norte', celdaValida, etiqueta);

  return punto;
}
