/**
 * `.urbscell`: el formato binario de una celda.
 *
 * Es el unico punto de encuentro entre el preprocesado en Node y el runtime en
 * el navegador, y por eso vive aqui, en el dominio, sin una sola dependencia:
 * lo escribe el pipeline y lo lee un worker del motor, asi que no puede
 * arrastrar `node:fs` ni `three`.
 *
 * Lo que viaja son HUELLAS Y SEMANTICA, no mallas cocidas. La extrusion pasa
 * en el runtime: asi las reglas de fachada se pueden retocar sin regenerar el
 * territorio, el LOD sale del mismo anillo y los edificios se pueden instanciar.
 *
 * La regla de coordenadas de la decision 0001 se cumple aqui al pie de la
 * letra: las secciones de vertices son SIEMPRE locales a la celda y el origen
 * absoluto aparece una unica vez, en la cabecera, en float64. El reparto byte
 * a byte esta en `docs/decisiones/0003-formato-de-celda.md`.
 *
 * Todo el archivo es little-endian.
 */

import {
  crearCelda,
  origenDeCelda,
  exigirCoordenadasLocales,
  esSeguroEnFloat32,
  pasoFloat32,
} from '../dominio/celda.js';
import { SIN_DATO } from '../dominio/elevacion.js';

/** Ocho bytes ASCII al principio del archivo. Ni se traduce ni se acorta. */
export const MAGIA_URBSCELL = 'URBSCELL';

/** Version del formato. Un lector que no la reconozca debe negarse a leer. */
export const VERSION_FORMATO = 2;

/** Tamano exacto de la cabecera, en bytes. */
export const BYTES_CABECERA = 88;

/**
 * Cota ausente dentro de la malla de relieve, en el espacio RELATIVO.
 *
 * Es `-32768` porque es el unico valor de un int16 que no puede salir de
 * cuantizar una cota real: las cotas se guardan relativas a la base de la
 * celda, o sea siempre >= 0 salvo redondeo. Cero NO vale de centinela: cero es
 * una cota perfectamente valida y ademas es el nivel del mar, asi que
 * confundirlos mete agua en mitad de una ladera.
 */
export const SIN_DATO_RELIEVE = -32768;

/**
 * Orden de las estructuras dentro del archivo.
 *
 * Es una lista CERRADA y su orden es parte del formato: cambiarlo reinterpreta
 * los archivos ya escritos. Anadir al final es compatible; reordenar, no.
 */
const ESTRUCTURAS_EN_ARCHIVO = Object.freeze(['rasante', 'puente', 'tunel']);

/**
 * Toda seccion empieza en un multiplo de 8 bytes. Asi el lector puede crear
 * vistas tipadas sobre el mismo ArrayBuffer sin copiar nada.
 */
export const ALINEACION_SECCION = 8;

/**
 * Margen por defecto que se le consiente a la geometria fuera de su celda,
 * expresado en lados de celda.
 *
 * Los elementos se asignan por centroide y NO se recortan, asi que una calle
 * larga sobresale por los dos lados. El margen no es decoracion: es el limite
 * que separa "esta calle es larga" de "alguien ha metido aqui una coordenada
 * que no es de esta celda". Cuatro lados cubren de sobra un vial de OSM sin
 * dejar pasar un UTM absoluto.
 */
export const MARGEN_EN_LADOS_POR_DEFECTO = 4;

/** Centinela de entero ausente. Ni plantas ni carriles pueden ser negativos. */
export const AUSENTE_ENTERO = -1;

const BYTES_MAGIA = 8;
const MAXIMO_DICCIONARIO_UINT8 = 256;
const MAXIMO_DICCIONARIO_UINT16 = 65536;
const BIT_SENTIDO_UNICO = 1;
const MAXIMO_ENTERO_INT16 = 32767;

const PLATAFORMA_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * @typedef {Object} ProcedenciaDeCelda
 * @property {string} proveedor
 * @property {string} confianza
 * @property {string|null} nota
 */

/**
 * @typedef {Object} EdificioDeCelda
 * @property {string} id
 * @property {Array<Array<[number, number]>>} anillos  Exterior primero, huecos despues; locales
 * @property {{este: number, norte: number}} ancla     Centroide local que decidio la celda
 * @property {number|null} alturaMetros
 * @property {number|null} plantas
 * @property {string} uso
 * @property {ProcedenciaDeCelda} procedencia
 */

/**
 * @typedef {Object} TramoDeCelda
 * @property {string} id
 * @property {Array<[number, number]>} eje  Polilinea local
 * @property {{este: number, norte: number}} ancla
 * @property {string} tipo
 * @property {number} anchuraMetros
 * @property {number|null} carriles
 * @property {boolean} sentidoUnico
 * @property {string|null} nombre
 * @property {ProcedenciaDeCelda} procedencia
 */

/**
 * @typedef {Object} ContenidoCelda
 * @property {import('../dominio/celda.js').Celda} celda
 * @property {number} epsg
 * @property {EdificioDeCelda[]} edificios
 * @property {TramoDeCelda[]} tramos
 * @property {number} [margenMetros]
 */

/**
 * Margen admitido por defecto para un lado de celda dado. Derivado, no magico:
 * cambiar el lado de celda cambia el margen sin tocar nada.
 *
 * @param {number} ladoCeldaMetros
 * @returns {number}
 */
export function margenPorDefecto(ladoCeldaMetros) {
  return ladoCeldaMetros * MARGEN_EN_LADOS_POR_DEFECTO;
}

/**
 * Cuantiza la malla de relieve a decimetros RELATIVOS a la celda.
 *
 * El mismo truco que el origen flotante, aplicado a la vertical. Un int16 en
 * decimetros ABSOLUTOS llega a 3.276 m y se queda corto en el Mulhacen
 * (3.479 m); relativo a la cota base de la celda no se queda corto en ninguna
 * parte, porque una celda de 250 m no abarca semejante desnivel ni de lejos.
 *
 * A cambio, el decimetro de resolucion es holgado: el error que introduce el
 * propio paso de malla de 10 m es de 0,17 m rms en suelo urbano, o sea tres
 * veces mayor que el del redondeo.
 *
 * @param {{paso: number, cotas: ArrayLike<number>}|null|undefined} relieve
 * @param {string} claveCelda
 * @returns {{postes: number, pasoMetros: number, cotaBase: number, cotas: Int16Array}}
 */
function codificarRelieve(relieve, claveCelda) {
  if (relieve === null || relieve === undefined) {
    return { postes: 0, pasoMetros: 0, cotaBase: 0, cotas: new Int16Array(0) };
  }

  const { paso, cotas } = relieve;
  if (!(Number.isFinite(paso) && paso > 0)) {
    throw new RangeError(
      `codificarCelda: el \`paso\` de la malla de relieve de ${claveCelda} debe ser positivo, y es ${paso}`,
    );
  }
  if (cotas === null || typeof cotas !== 'object' || cotas.length === 0) {
    throw new TypeError(`codificarCelda: la malla de relieve de ${claveCelda} no trae cotas`);
  }

  const postes = Math.round(Math.sqrt(cotas.length));
  if (postes * postes !== cotas.length) {
    throw new RangeError(
      `codificarCelda: la malla de relieve de ${claveCelda} tiene ${cotas.length} cotas y no es cuadrada; hacen falta postes x postes`,
    );
  }

  let minima = Infinity;
  for (let i = 0; i < cotas.length; i += 1) {
    const cota = cotas[i];
    if (cota === SIN_DATO || !Number.isFinite(cota)) continue;
    if (cota < minima) minima = cota;
  }
  // Sin una sola cota util la base da igual; se deja en cero y todo va a centinela.
  const cotaBase = minima === Infinity ? 0 : Math.floor(minima);

  const salida = new Int16Array(cotas.length);
  for (let i = 0; i < cotas.length; i += 1) {
    const cota = cotas[i];
    if (cota === SIN_DATO || !Number.isFinite(cota)) {
      salida[i] = SIN_DATO_RELIEVE;
      continue;
    }
    const decimetros = Math.round((cota - cotaBase) * 10);
    if (decimetros > 32767) {
      throw new RangeError(
        `codificarCelda: la celda ${claveCelda} abarca mas de 3.276 m de desnivel (${cota - cotaBase} m). Eso no es una celda, es un error.`,
      );
    }
    salida[i] = decimetros;
  }

  return { postes, pasoMetros: paso, cotaBase, cotas: salida };
}

/**
 * Devuelve el relieve de unas vistas en METROS, con `null` donde no hay dato.
 *
 * Es lo comodo, no lo rapido: materializa un array por celda. Quien vaya a
 * construir la malla para la GPU quiere `vistas.relieve` en crudo.
 *
 * @param {Object} vistas
 * @returns {{postes: number, pasoMetros: number, cotas: Array<number|null>}|null}
 */
function relieveDeVistas(vistas) {
  const { postes, pasoMetros, cotaBase, cotas } = vistas.relieve;
  if (postes === 0) {
    return null;
  }

  const salida = new Array(cotas.length);
  for (let i = 0; i < cotas.length; i += 1) {
    salida[i] = cotas[i] === SIN_DATO_RELIEVE ? null : cotaBase + cotas[i] / 10;
  }
  return Object.freeze({ postes, pasoMetros, cotas: salida });
}

/**
 * @param {number} desplazamiento
 * @returns {number}
 */
function alinear(desplazamiento) {
  const resto = desplazamiento % ALINEACION_SECCION;
  return resto === 0 ? desplazamiento : desplazamiento + (ALINEACION_SECCION - resto);
}

/**
 * @param {string} fn
 * @returns {void}
 */
function exigirLittleEndian(fn) {
  if (!PLATAFORMA_LITTLE_ENDIAN) {
    throw new Error(
      `${fn}: el formato .urbscell es little-endian y esta maquina es big-endian. ` +
        'Las vistas tipadas saldrian con los bytes al reves.',
    );
  }
}

/**
 * @param {unknown} celda
 * @returns {import('../dominio/celda.js').Celda}
 */
function validarCelda(celda) {
  if (celda === null || typeof celda !== 'object') {
    throw new TypeError(
      'codificarCelda: `celda` es obligatoria y debe venir de crearCelda o celdaDePunto',
    );
  }
  const { indice, origen, ladoCeldaMetros } = /** @type {any} */ (celda);
  if (
    indice === null ||
    typeof indice !== 'object' ||
    !Number.isInteger(indice.x) ||
    !Number.isInteger(indice.z) ||
    origen === null ||
    typeof origen !== 'object' ||
    !Number.isFinite(origen.este) ||
    !Number.isFinite(origen.norte) ||
    !(Number.isFinite(ladoCeldaMetros) && ladoCeldaMetros > 0)
  ) {
    throw new TypeError(
      'codificarCelda: `celda` no tiene forma de celda; construyela con crearCelda({indice, ladoCeldaMetros})',
    );
  }
  return /** @type {import('../dominio/celda.js').Celda} */ (celda);
}

/**
 * @param {unknown} epsg
 * @returns {number}
 */
function validarEpsg(epsg) {
  if (!Number.isInteger(epsg) || epsg <= 0) {
    throw new TypeError(
      'codificarCelda: `epsg` debe ser el codigo entero del sistema proyectado de la celda; deducelo del territorio con epsgRecomendado',
    );
  }
  return epsg;
}

/**
 * @param {unknown} margenMetros
 * @param {number} ladoCeldaMetros
 * @returns {number}
 */
function validarMargen(margenMetros, ladoCeldaMetros) {
  const margen = margenMetros ?? margenPorDefecto(ladoCeldaMetros);
  if (!(Number.isFinite(margen) && margen >= 0)) {
    throw new RangeError('codificarCelda: `margenMetros` debe ser un numero no negativo');
  }

  const magnitudMaxima = ladoCeldaMetros + margen;
  if (!esSeguroEnFloat32(magnitudMaxima)) {
    throw new RangeError(
      `codificarCelda: con un margen de ${margen} m la coordenada local mas grande seria ` +
        `${magnitudMaxima} m, y a esa magnitud el escalon de float32 es de ` +
        `${pasoFloat32(magnitudMaxima)} m, por encima del milimetro que exige el formato. ` +
        'Reduce el margen o revisa el troceado.',
    );
  }
  return margen;
}

/**
 * Comprueba que un vertice cae dentro de la celda mas su margen.
 *
 * @param {number} valor
 * @param {string} eje
 * @param {string} id
 * @param {number} ladoCeldaMetros
 * @param {number} margen
 * @param {string} clave
 * @returns {void}
 */
function exigirDentroDelMargen(valor, eje, id, ladoCeldaMetros, margen, clave) {
  if (!Number.isFinite(valor)) {
    throw new TypeError(`codificarCelda: "${id}" tiene un vertice no finito en el eje ${eje}`);
  }
  if (valor >= -margen && valor < ladoCeldaMetros + margen) {
    return;
  }
  throw new RangeError(
    `codificarCelda: el vertice ${eje} = ${valor} m de "${id}" se sale del margen de la celda ` +
      `${clave}; el rango admitido es [${-margen}, ${ladoCeldaMetros + margen}). ` +
      'La geometria no se recorta, pero un elemento que sobresale tanto no pertenece a esta ' +
      'celda: revisa el centroide con el que se asigno, o convierte antes con aLocal(punto, celda).',
  );
}

/**
 * Indexador de diccionario: devuelve el indice de un valor y lo anade la
 * primera vez que aparece. Es lo que hace que una procedencia compartida por
 * doscientos edificios ocupe una entrada y no doscientas.
 *
 * @param {number} maximo
 * @param {string} nombre
 */
function crearDiccionario(maximo, nombre) {
  const indicePorClave = new Map();
  const valores = [];

  return {
    valores,
    /**
     * @param {string} clave
     * @param {unknown} valor
     * @returns {number}
     */
    indiceDe(clave, valor) {
      const existente = indicePorClave.get(clave);
      if (existente !== undefined) {
        return existente;
      }
      if (valores.length >= maximo) {
        throw new RangeError(
          `codificarCelda: el diccionario de ${nombre} no admite mas de ${maximo} valores distintos en una celda`,
        );
      }
      const indice = valores.length;
      valores.push(valor);
      indicePorClave.set(clave, indice);
      return indice;
    },
  };
}

/**
 * @param {unknown} procedencia
 * @param {string} id
 * @returns {ProcedenciaDeCelda}
 */
function normalizarProcedencia(procedencia, id) {
  if (procedencia === null || typeof procedencia !== 'object') {
    throw new TypeError(
      `codificarCelda: "${id}" no declara procedencia; toda geometria debe decir de donde sale`,
    );
  }
  const { proveedor, confianza, nota } = /** @type {any} */ (procedencia);
  if (typeof proveedor !== 'string' || typeof confianza !== 'string') {
    throw new TypeError(
      `codificarCelda: la procedencia de "${id}" necesita \`proveedor\` y \`confianza\` como cadenas`,
    );
  }
  return { proveedor, confianza, nota: nota ?? null };
}

/**
 * Clave de deduplicacion de una procedencia. JSON sobre una tupla, para que
 * dos valores distintos no puedan colisionar por culpa de un separador.
 *
 * @param {ProcedenciaDeCelda} procedencia
 * @returns {string}
 */
function claveDeProcedencia(procedencia) {
  return JSON.stringify([procedencia.proveedor, procedencia.confianza, procedencia.nota]);
}

/**
 * @param {unknown} valor
 * @param {string} campo
 * @param {string} id
 * @returns {number} El valor, o NaN si esta ausente
 */
function realOAusente(valor, campo, id) {
  if (valor === null || valor === undefined) {
    return Number.NaN;
  }
  if (!(Number.isFinite(valor) && valor > 0)) {
    throw new RangeError(
      `codificarCelda: \`${campo}\` de "${id}" debe ser un numero positivo o null, no ${valor}`,
    );
  }
  return valor;
}

/**
 * @param {unknown} valor
 * @param {string} campo
 * @param {string} id
 * @returns {number} El valor, o AUSENTE_ENTERO si esta ausente
 */
function enteroOAusente(valor, campo, id) {
  if (valor === null || valor === undefined) {
    return AUSENTE_ENTERO;
  }
  if (!(Number.isInteger(valor) && valor > 0 && valor <= MAXIMO_ENTERO_INT16)) {
    throw new RangeError(
      `codificarCelda: \`${campo}\` de "${id}" debe ser un entero positivo menor o igual que ${MAXIMO_ENTERO_INT16}, o null`,
    );
  }
  return valor;
}

/**
 * @param {unknown} id
 * @param {number} posicion
 * @param {string} coleccion
 * @returns {string}
 */
function validarId(id, posicion, coleccion) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(
      `codificarCelda: el elemento ${posicion} de \`${coleccion}\` necesita un \`id\` no vacio`,
    );
  }
  return id;
}

/**
 * Escribe una celda en el binario `.urbscell`.
 *
 * @param {ContenidoCelda} contenido
 * @returns {Uint8Array}
 */
export function codificarCelda(contenido) {
  exigirLittleEndian('codificarCelda');

  if (contenido === null || typeof contenido !== 'object') {
    throw new TypeError('codificarCelda: se esperaba {celda, epsg, edificios, tramos}');
  }

  const celda = validarCelda(contenido.celda);
  const epsg = validarEpsg(contenido.epsg);
  const margen = validarMargen(contenido.margenMetros, celda.ladoCeldaMetros);
  const edificios = contenido.edificios ?? [];
  const tramos = contenido.tramos ?? [];
  const relieve = contenido.relieve ?? null;

  if (!Array.isArray(edificios) || !Array.isArray(tramos)) {
    throw new TypeError('codificarCelda: `edificios` y `tramos` deben ser listas');
  }

  const usos = crearDiccionario(MAXIMO_DICCIONARIO_UINT8, 'usos de edificio');
  const tiposVia = crearDiccionario(MAXIMO_DICCIONARIO_UINT8, 'tipos de via');
  const procedencias = crearDiccionario(MAXIMO_DICCIONARIO_UINT16, 'procedencias');

  const numeroEdificios = edificios.length;
  const numeroTramos = tramos.length;

  // --- Edificios. Un solo recorrido: mide y empaqueta a la vez.
  const edificiosInicioAnillo = new Uint32Array(numeroEdificios + 1);
  const anillosInicioVerticeLista = [0];
  const verticesEdificios = [];
  const edificiosAncla = new Float32Array(numeroEdificios * 2);
  const edificiosAltura = new Float32Array(numeroEdificios);
  const edificiosPlantas = new Int16Array(numeroEdificios);
  const edificiosUso = new Uint8Array(numeroEdificios);
  const edificiosProcedencia = new Uint16Array(numeroEdificios);
  const idsEdificios = new Array(numeroEdificios);

  let totalAnillos = 0;
  for (const [posicion, edificio] of edificios.entries()) {
    const id = validarId(edificio?.id, posicion, 'edificios');
    const anillos = edificio.anillos;
    if (!Array.isArray(anillos) || anillos.length === 0) {
      throw new TypeError(`codificarCelda: "${id}" necesita al menos el anillo exterior`);
    }

    edificiosInicioAnillo[posicion] = totalAnillos;
    for (const anillo of anillos) {
      if (!Array.isArray(anillo) || anillo.length < 4) {
        throw new TypeError(
          `codificarCelda: cada anillo de "${id}" necesita al menos 4 posiciones (poligono cerrado)`,
        );
      }
      for (const [este, norte] of anillo) {
        exigirDentroDelMargen(este, 'este', id, celda.ladoCeldaMetros, margen, celda.clave);
        exigirDentroDelMargen(norte, 'norte', id, celda.ladoCeldaMetros, margen, celda.clave);
        verticesEdificios.push(este, norte);
      }
      totalAnillos += 1;
      anillosInicioVerticeLista.push(verticesEdificios.length / 2);
    }

    // El ancla es el punto que decidio la celda: si no cae dentro, la
    // asignacion esta rota y no hay geometria que salvar.
    const ancla = exigirCoordenadasLocales(edificio.ancla, celda, `ancla de "${id}"`);
    edificiosAncla[posicion * 2] = ancla.este;
    edificiosAncla[posicion * 2 + 1] = ancla.norte;

    edificiosAltura[posicion] = realOAusente(edificio.alturaMetros, 'alturaMetros', id);
    edificiosPlantas[posicion] = enteroOAusente(edificio.plantas, 'plantas', id);

    if (typeof edificio.uso !== 'string' || edificio.uso.length === 0) {
      throw new TypeError(`codificarCelda: \`uso\` de "${id}" debe ser una cadena no vacia`);
    }
    edificiosUso[posicion] = usos.indiceDe(edificio.uso, edificio.uso);

    const procedencia = normalizarProcedencia(edificio.procedencia, id);
    edificiosProcedencia[posicion] = procedencias.indiceDe(
      claveDeProcedencia(procedencia),
      procedencia,
    );

    idsEdificios[posicion] = id;
  }
  edificiosInicioAnillo[numeroEdificios] = totalAnillos;

  // --- Tramos.
  const tramosInicioVertice = new Uint32Array(numeroTramos + 1);
  const verticesTramos = [];
  const tramosAncla = new Float32Array(numeroTramos * 2);
  const tramosAnchura = new Float32Array(numeroTramos);
  const tramosCarriles = new Int16Array(numeroTramos);
  const tramosBanderas = new Uint8Array(numeroTramos);
  const tramosTipo = new Uint8Array(numeroTramos);
  const tramosEstructura = new Uint8Array(numeroTramos);
  const tramosNivel = new Int8Array(numeroTramos);
  const tramosProcedencia = new Uint16Array(numeroTramos);
  const idsTramos = new Array(numeroTramos);
  const nombresTramos = new Array(numeroTramos);

  for (const [posicion, tramo] of tramos.entries()) {
    const id = validarId(tramo?.id, posicion, 'tramos');
    const eje = tramo.eje;
    if (!Array.isArray(eje) || eje.length < 2) {
      throw new TypeError(`codificarCelda: el eje de "${id}" necesita al menos dos posiciones`);
    }

    tramosInicioVertice[posicion] = verticesTramos.length / 2;
    for (const [este, norte] of eje) {
      exigirDentroDelMargen(este, 'este', id, celda.ladoCeldaMetros, margen, celda.clave);
      exigirDentroDelMargen(norte, 'norte', id, celda.ladoCeldaMetros, margen, celda.clave);
      verticesTramos.push(este, norte);
    }

    const ancla = exigirCoordenadasLocales(tramo.ancla, celda, `ancla de "${id}"`);
    tramosAncla[posicion * 2] = ancla.este;
    tramosAncla[posicion * 2 + 1] = ancla.norte;

    if (!(Number.isFinite(tramo.anchuraMetros) && tramo.anchuraMetros > 0)) {
      throw new RangeError(`codificarCelda: \`anchuraMetros\` de "${id}" debe ser positiva`);
    }
    tramosAnchura[posicion] = tramo.anchuraMetros;
    tramosCarriles[posicion] = enteroOAusente(tramo.carriles, 'carriles', id);
    tramosBanderas[posicion] = tramo.sentidoUnico ? BIT_SENTIDO_UNICO : 0;

    if (typeof tramo.tipo !== 'string' || tramo.tipo.length === 0) {
      throw new TypeError(`codificarCelda: \`tipo\` de "${id}" debe ser una cadena no vacia`);
    }
    tramosTipo[posicion] = tiposVia.indiceDe(tramo.tipo, tramo.tipo);

    // Sin esto, en cuanto el viario siga el terreno un puente se hunde en lo
    // que cruza y la boca de un tunel queda enterrada.
    const estructura = tramo.estructura ?? ESTRUCTURAS_EN_ARCHIVO[0];
    const indiceEstructura = ESTRUCTURAS_EN_ARCHIVO.indexOf(estructura);
    if (indiceEstructura < 0) {
      throw new RangeError(
        `codificarCelda: estructura desconocida "${estructura}" en "${id}"; son ${ESTRUCTURAS_EN_ARCHIVO.join(', ')}`,
      );
    }
    tramosEstructura[posicion] = indiceEstructura;

    const nivel = tramo.nivel ?? 0;
    if (!Number.isInteger(nivel) || nivel < -128 || nivel > 127) {
      throw new RangeError(`codificarCelda: el \`nivel\` de "${id}" debe ser un entero de un byte con signo, y es ${nivel}`);
    }
    tramosNivel[posicion] = nivel;

    const procedencia = normalizarProcedencia(tramo.procedencia, id);
    tramosProcedencia[posicion] = procedencias.indiceDe(
      claveDeProcedencia(procedencia),
      procedencia,
    );

    idsTramos[posicion] = id;
    nombresTramos[posicion] = tramo.nombre ?? null;
  }
  tramosInicioVertice[numeroTramos] = verticesTramos.length / 2;

  // --- Relieve. Opcional: una celda sin proveedor de relieve lo declara con
  // cero postes, que NO es lo mismo que una malla llana a cota cero.
  const relieveCodificado = codificarRelieve(relieve, celda.clave);

  const tablaAtributos = new TextEncoder().encode(
    JSON.stringify({
      diccionarios: {
        usos: usos.valores,
        tiposVia: tiposVia.valores,
        procedencias: procedencias.valores,
      },
      edificios: { ids: idsEdificios },
      tramos: { ids: idsTramos, nombres: nombresTramos },
    }),
  );

  const secciones = [
    { tipo: Uint32Array, datos: edificiosInicioAnillo },
    { tipo: Uint32Array, datos: Uint32Array.from(anillosInicioVerticeLista) },
    { tipo: Float32Array, datos: Float32Array.from(verticesEdificios) },
    { tipo: Float32Array, datos: edificiosAncla },
    { tipo: Float32Array, datos: edificiosAltura },
    { tipo: Int16Array, datos: edificiosPlantas },
    { tipo: Uint8Array, datos: edificiosUso },
    { tipo: Uint16Array, datos: edificiosProcedencia },
    { tipo: Uint32Array, datos: tramosInicioVertice },
    { tipo: Float32Array, datos: Float32Array.from(verticesTramos) },
    { tipo: Float32Array, datos: tramosAncla },
    { tipo: Float32Array, datos: tramosAnchura },
    { tipo: Int16Array, datos: tramosCarriles },
    { tipo: Uint8Array, datos: tramosBanderas },
    { tipo: Uint8Array, datos: tramosTipo },
    { tipo: Uint8Array, datos: tramosEstructura },
    { tipo: Int8Array, datos: tramosNivel },
    { tipo: Uint16Array, datos: tramosProcedencia },
    { tipo: Int16Array, datos: relieveCodificado.cotas },
  ];

  let cursor = BYTES_CABECERA;
  for (const seccion of secciones) {
    seccion.desplazamiento = alinear(cursor);
    cursor = seccion.desplazamiento + seccion.datos.length * seccion.tipo.BYTES_PER_ELEMENT;
  }
  const desplazamientoTabla = alinear(cursor);
  const total = desplazamientoTabla + tablaAtributos.length;

  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  const vista = new DataView(buffer);

  for (let i = 0; i < BYTES_MAGIA; i += 1) {
    vista.setUint8(i, MAGIA_URBSCELL.charCodeAt(i));
  }
  vista.setUint16(8, VERSION_FORMATO, true);
  vista.setUint16(10, BYTES_CABECERA, true);
  vista.setInt32(12, celda.indice.x, true);
  vista.setInt32(16, celda.indice.z, true);
  vista.setInt32(20, epsg, true);
  vista.setFloat64(24, celda.origen.este, true);
  vista.setFloat64(32, celda.origen.norte, true);
  vista.setFloat64(40, celda.ladoCeldaMetros, true);
  vista.setFloat64(48, margen, true);
  vista.setUint32(56, numeroEdificios, true);
  vista.setUint32(60, numeroTramos, true);
  vista.setUint32(64, relieveCodificado.postes, true);
  vista.setFloat32(68, relieveCodificado.pasoMetros, true);
  // La cota base va en float64 por la misma razon que el origen: es la unica
  // magnitud absoluta del relieve y vive una sola vez (decision 0001, regla 2).
  vista.setFloat64(72, relieveCodificado.cotaBase, true);
  vista.setUint32(80, desplazamientoTabla, true);
  vista.setUint32(84, tablaAtributos.length, true);

  for (const seccion of secciones) {
    new seccion.tipo(buffer, seccion.desplazamiento, seccion.datos.length).set(seccion.datos);
  }
  bytes.set(tablaAtributos, desplazamientoTabla);

  return bytes;
}

/**
 * Lee solo la cabecera. Sirve para indexar un directorio de celdas o decidir
 * si merece la pena cargar el resto, sin tocar la geometria.
 *
 * @param {Uint8Array} bytes
 * @returns {Object}
 */
export function leerCabecera(bytes) {
  exigirLittleEndian('leerCabecera');

  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('leerCabecera: se esperaba un Uint8Array con el archivo .urbscell');
  }
  if (bytes.byteLength < BYTES_CABECERA) {
    throw new RangeError(
      `leerCabecera: el archivo tiene ${bytes.byteLength} bytes y la cabecera ocupa ${BYTES_CABECERA}`,
    );
  }

  const magia = String.fromCharCode(...bytes.subarray(0, BYTES_MAGIA));
  if (magia !== MAGIA_URBSCELL) {
    throw new TypeError(
      `leerCabecera: esto no es un archivo .urbscell; esperaba la magia "${MAGIA_URBSCELL}" y hay "${magia}"`,
    );
  }

  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = vista.getUint16(8, true);
  if (version !== VERSION_FORMATO) {
    throw new RangeError(
      `leerCabecera: el archivo declara la version ${version} y este lector solo entiende la ${VERSION_FORMATO}`,
    );
  }

  const indice = Object.freeze({ x: vista.getInt32(12, true), z: vista.getInt32(16, true) });
  const ladoCeldaMetros = vista.getFloat64(40, true);
  const origen = Object.freeze({
    este: vista.getFloat64(24, true),
    norte: vista.getFloat64(32, true),
  });

  const origenEsperado = origenDeCelda(indice, ladoCeldaMetros);
  if (origen.este !== origenEsperado.este || origen.norte !== origenEsperado.norte) {
    throw new RangeError(
      `leerCabecera: el origen guardado (${origen.este}, ${origen.norte}) no coincide con el que ` +
        `dicta el indice (${origenEsperado.este}, ${origenEsperado.norte}). El archivo esta ` +
        'corrupto o se genero con otro lado de celda.',
    );
  }

  return Object.freeze({
    version,
    bytesCabecera: vista.getUint16(10, true),
    indice,
    epsg: vista.getInt32(20, true),
    origen,
    ladoCeldaMetros,
    margenMetros: vista.getFloat64(48, true),
    numeroEdificios: vista.getUint32(56, true),
    numeroTramos: vista.getUint32(60, true),
    // Cero postes NO es una malla llana a cota cero: es "esta celda no tiene
    // relieve", que es lo que pasa mientras no haya proveedor que lo sirva.
    relieve: Object.freeze({
      postes: vista.getUint32(64, true),
      pasoMetros: vista.getFloat32(68, true),
      cotaBase: vista.getFloat64(72, true),
    }),
    desplazamientoTablaAtributos: vista.getUint32(80, true),
    bytesTablaAtributos: vista.getUint32(84, true),
  });
}

/**
 * Lector secuencial de secciones. Cada seccion empieza alineada a 8 bytes y su
 * longitud se deduce de la cabecera o del final de la seccion anterior.
 *
 * @param {ArrayBuffer} buffer
 * @param {number} base
 * @param {number} limite
 */
function crearCursor(buffer, base, limite) {
  let desplazamiento = base + BYTES_CABECERA;

  return {
    /**
     * @param {Function} tipo
     * @param {number} longitud
     */
    leer(tipo, longitud) {
      desplazamiento = alinear(desplazamiento - base) + base;
      const bytes = longitud * tipo.BYTES_PER_ELEMENT;
      if (desplazamiento + bytes > limite) {
        throw new RangeError(
          `decodificarCelda: el archivo se acaba antes de tiempo; faltan ${desplazamiento + bytes - limite} bytes. Esta truncado.`,
        );
      }
      const vista = new tipo(buffer, desplazamiento, longitud);
      desplazamiento += bytes;
      return vista;
    },
  };
}

/**
 * Abre un `.urbscell` y devuelve VISTAS TIPADAS sobre sus bytes, sin copiar
 * ni materializar un solo objeto.
 *
 * Esta es la puerta del runtime. `decodificarCelda` construye objetos JS
 * comodos para inspeccionar y probar; el visor no los quiere: un `Float32Array`
 * de vertices ya es, literalmente, lo que hay que subir a la GPU, y convertirlo
 * antes en cinco mil arrays de pares `[este, norte]` es basura para el
 * recolector en cada celda que entra en escena.
 *
 * Todo lo geometrico sale como vista sobre el MISMO `ArrayBuffer` del archivo.
 * Solo la tabla de atributos —ids, nombres y diccionarios— se materializa,
 * porque es JSON y no hay vista tipada que valga para una cadena.
 *
 * @param {Uint8Array|ArrayBuffer} origen  Lo que devuelve `fetch(...).arrayBuffer()` sirve tal cual
 * @returns {Object}
 */
export function vistasDeCelda(origen) {
  const entrada = origen instanceof ArrayBuffer ? new Uint8Array(origen) : origen;
  const cabecera = leerCabecera(entrada);

  // Las vistas tipadas exigen alineacion respecto al ArrayBuffer, asi que un
  // Uint8Array que empiece en un byte raro se copia antes de leer.
  const alineado = entrada.byteOffset % ALINEACION_SECCION === 0 ? entrada : new Uint8Array(entrada);
  const base = alineado.byteOffset;
  const limite = base + alineado.byteLength;
  const buffer = alineado.buffer;

  const { numeroEdificios, numeroTramos } = cabecera;
  const cursor = crearCursor(buffer, base, limite);

  const edificiosInicioAnillo = cursor.leer(Uint32Array, numeroEdificios + 1);
  const totalAnillos = edificiosInicioAnillo[numeroEdificios];
  const anillosInicioVertice = cursor.leer(Uint32Array, totalAnillos + 1);
  const totalVerticesEdificios = anillosInicioVertice[totalAnillos];
  const verticesEdificios = cursor.leer(Float32Array, totalVerticesEdificios * 2);
  const edificiosAncla = cursor.leer(Float32Array, numeroEdificios * 2);
  const edificiosAltura = cursor.leer(Float32Array, numeroEdificios);
  const edificiosPlantas = cursor.leer(Int16Array, numeroEdificios);
  const edificiosUso = cursor.leer(Uint8Array, numeroEdificios);
  const edificiosProcedencia = cursor.leer(Uint16Array, numeroEdificios);

  const tramosInicioVertice = cursor.leer(Uint32Array, numeroTramos + 1);
  const totalVerticesTramos = tramosInicioVertice[numeroTramos];
  const verticesTramos = cursor.leer(Float32Array, totalVerticesTramos * 2);
  const tramosAncla = cursor.leer(Float32Array, numeroTramos * 2);
  const tramosAnchura = cursor.leer(Float32Array, numeroTramos);
  const tramosCarriles = cursor.leer(Int16Array, numeroTramos);
  const tramosBanderas = cursor.leer(Uint8Array, numeroTramos);
  const tramosTipo = cursor.leer(Uint8Array, numeroTramos);
  const tramosEstructura = cursor.leer(Uint8Array, numeroTramos);
  const tramosNivel = cursor.leer(Int8Array, numeroTramos);
  const tramosProcedencia = cursor.leer(Uint16Array, numeroTramos);

  const postesRelieve = cabecera.relieve.postes;
  const relieveCotas = cursor.leer(Int16Array, postesRelieve * postesRelieve);

  const finTabla = base + cabecera.desplazamientoTablaAtributos + cabecera.bytesTablaAtributos;
  if (finTabla > limite) {
    throw new RangeError(
      `vistasDeCelda: la tabla de atributos declara ${cabecera.bytesTablaAtributos} bytes y el archivo se queda corto. Esta truncado.`,
    );
  }
  const tabla = JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(
        buffer,
        base + cabecera.desplazamientoTablaAtributos,
        cabecera.bytesTablaAtributos,
      ),
    ),
  );

  return Object.freeze({
    cabecera,
    edificios: Object.freeze({
      inicioAnillo: edificiosInicioAnillo,
      anillosInicioVertice,
      vertices: verticesEdificios,
      ancla: edificiosAncla,
      altura: edificiosAltura,
      plantas: edificiosPlantas,
      uso: edificiosUso,
      procedencia: edificiosProcedencia,
    }),
    tramos: Object.freeze({
      inicioVertice: tramosInicioVertice,
      vertices: verticesTramos,
      ancla: tramosAncla,
      anchura: tramosAnchura,
      carriles: tramosCarriles,
      banderas: tramosBanderas,
      tipo: tramosTipo,
      estructura: tramosEstructura,
      nivel: tramosNivel,
      procedencia: tramosProcedencia,
    }),
    /**
     * Relieve en crudo: decimetros relativos a `cabecera.relieve.cotaBase`, con
     * `SIN_DATO_RELIEVE` donde no hay dato. Sin convertir, igual que el resto de
     * vistas: convertirlo aqui seria copiar la malla entera en cada celda.
     */
    relieve: Object.freeze({
      postes: postesRelieve,
      pasoMetros: cabecera.relieve.pasoMetros,
      cotaBase: cabecera.relieve.cotaBase,
      cotas: relieveCotas,
    }),
    diccionarios: Object.freeze({
      usos: tabla.diccionarios.usos,
      tiposVia: tabla.diccionarios.tiposVia,
      procedencias: tabla.diccionarios.procedencias.map((procedencia) =>
        Object.freeze({
          proveedor: procedencia.proveedor,
          confianza: procedencia.confianza,
          nota: procedencia.nota ?? null,
        }),
      ),
    }),
    ids: Object.freeze({ edificios: tabla.edificios.ids, tramos: tabla.tramos.ids }),
    nombres: Object.freeze({ tramos: tabla.tramos.nombres }),
  });
}

/**
 * Lee un archivo `.urbscell` completo y lo convierte en objetos del dominio.
 *
 * Comodo para inspeccionar, probar y cualquier cosa que no sea pintar. Quien
 * vaya a subir la geometria a la GPU quiere `vistasDeCelda`, no esto.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {Object}
 */
export function decodificarCelda(bytes) {
  const vistas = vistasDeCelda(bytes);
  const { cabecera, diccionarios, ids, nombres } = vistas;
  const { numeroEdificios, numeroTramos } = cabecera;

  const {
    inicioAnillo: edificiosInicioAnillo,
    anillosInicioVertice,
    vertices: verticesEdificios,
    ancla: edificiosAncla,
    altura: edificiosAltura,
    plantas: edificiosPlantas,
    uso: edificiosUso,
    procedencia: edificiosProcedencia,
  } = vistas.edificios;

  const {
    inicioVertice: tramosInicioVertice,
    vertices: verticesTramos,
    ancla: tramosAncla,
    anchura: tramosAnchura,
    carriles: tramosCarriles,
    banderas: tramosBanderas,
    tipo: tramosTipo,
    estructura: tramosEstructura,
    nivel: tramosNivel,
    procedencia: tramosProcedencia,
  } = vistas.tramos;

  const procedencias = diccionarios.procedencias;

  const edificios = [];
  for (let i = 0; i < numeroEdificios; i += 1) {
    const anillos = [];
    for (let a = edificiosInicioAnillo[i]; a < edificiosInicioAnillo[i + 1]; a += 1) {
      const anillo = [];
      for (let v = anillosInicioVertice[a]; v < anillosInicioVertice[a + 1]; v += 1) {
        anillo.push([verticesEdificios[v * 2], verticesEdificios[v * 2 + 1]]);
      }
      anillos.push(anillo);
    }
    const altura = edificiosAltura[i];
    const plantas = edificiosPlantas[i];

    edificios.push(
      Object.freeze({
        id: ids.edificios[i],
        anillos,
        ancla: Object.freeze({ este: edificiosAncla[i * 2], norte: edificiosAncla[i * 2 + 1] }),
        alturaMetros: Number.isNaN(altura) ? null : altura,
        plantas: plantas === AUSENTE_ENTERO ? null : plantas,
        uso: diccionarios.usos[edificiosUso[i]],
        procedencia: procedencias[edificiosProcedencia[i]],
      }),
    );
  }

  const tramos = [];
  for (let i = 0; i < numeroTramos; i += 1) {
    const eje = [];
    for (let v = tramosInicioVertice[i]; v < tramosInicioVertice[i + 1]; v += 1) {
      eje.push([verticesTramos[v * 2], verticesTramos[v * 2 + 1]]);
    }
    const carriles = tramosCarriles[i];

    tramos.push(
      Object.freeze({
        id: ids.tramos[i],
        eje,
        ancla: Object.freeze({ este: tramosAncla[i * 2], norte: tramosAncla[i * 2 + 1] }),
        tipo: diccionarios.tiposVia[tramosTipo[i]],
        anchuraMetros: tramosAnchura[i],
        carriles: carriles === AUSENTE_ENTERO ? null : carriles,
        sentidoUnico: (tramosBanderas[i] & BIT_SENTIDO_UNICO) !== 0,
        nombre: nombres.tramos[i] ?? null,
        estructura: ESTRUCTURAS_EN_ARCHIVO[tramosEstructura[i]] ?? ESTRUCTURAS_EN_ARCHIVO[0],
        nivel: tramosNivel[i],
        procedencia: procedencias[tramosProcedencia[i]],
      }),
    );
  }

  return Object.freeze({
    version: cabecera.version,
    celda: crearCelda({ indice: cabecera.indice, ladoCeldaMetros: cabecera.ladoCeldaMetros }),
    epsg: cabecera.epsg,
    margenMetros: cabecera.margenMetros,
    edificios,
    tramos,
    relieve: relieveDeVistas(vistas),
  });
}
