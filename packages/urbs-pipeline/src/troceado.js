/**
 * Troceado: repartir el territorio en celdas.
 *
 * Coge los objetos del dominio tal y como los dan los proveedores (en grados),
 * los proyecta a los metros del territorio y decide a que celda pertenece cada
 * uno. La regla de asignacion es el CENTROIDE: un elemento pertenece a la
 * celda que contiene su centro de masas.
 *
 * La geometria NO se recorta en el borde de la celda. Recortar un edificio
 * obliga a inventar vertices en la linea de corte y deja medianeras partidas
 * entre dos archivos; duplicarlo obliga al runtime a deduplicar por id al
 * cargar celdas vecinas. Guardar el elemento entero en una sola celda es lo
 * unico que no rompe nada: a cambio, sus vertices pueden salirse del rango
 * [0, lado), y por eso el formato admite un margen (ver `celda-binaria.js`).
 *
 * El centroide, ademas, es el ancla que viaja en el archivo: es el punto que
 * el runtime usa para ordenar, filtrar por distancia e instanciar sin abrir la
 * geometria.
 */

import { crearCelda, indiceDeCelda, claveDeCelda, aLocal, margenPorDefecto } from 'urbs-core';

/**
 * @typedef {import('./reproyeccion.js').Reproyector} Reproyector
 */

/**
 * @param {unknown} posiciones
 * @param {number} minimo
 * @param {string} fn
 * @returns {Array<[number, number]>}
 */
function validarPosiciones(posiciones, minimo, fn) {
  if (!Array.isArray(posiciones) || posiciones.length < minimo) {
    throw new TypeError(`${fn}: se esperaban al menos ${minimo} posiciones [este, norte]`);
  }
  return /** @type {Array<[number, number]>} */ (posiciones);
}

/**
 * Media aritmetica de las posiciones, descartando el vertice de cierre si el
 * anillo repite el primero al final.
 *
 * @param {Array<[number, number]>} posiciones
 * @returns {{este: number, norte: number}}
 */
function mediaDePosiciones(posiciones) {
  const ultimo = posiciones.length - 1;
  const cerrado =
    posiciones.length > 1 &&
    posiciones[0][0] === posiciones[ultimo][0] &&
    posiciones[0][1] === posiciones[ultimo][1];
  const utiles = cerrado ? posiciones.slice(0, ultimo) : posiciones;

  let este = 0;
  let norte = 0;
  for (const [x, y] of utiles) {
    este += x;
    norte += y;
  }
  return { este: este / utiles.length, norte: norte / utiles.length };
}

/**
 * Centroide de area de un anillo, por la formula del zapato.
 *
 * El area con signo se cancela con los terminos cruzados, asi que la
 * orientacion del anillo no importa. Si el area es cero —anillos colineales,
 * que el Catastro produce— se cae a la media de vertices en vez de dividir
 * entre cero y devolver NaN.
 *
 * @param {Array<[number, number]>} anillo  En metros proyectados
 * @returns {{este: number, norte: number}}
 */
export function centroideDeAnillo(anillo) {
  const posiciones = validarPosiciones(anillo, 3, 'centroideDeAnillo');

  let areaDoble = 0;
  let este = 0;
  let norte = 0;

  for (let i = 0; i < posiciones.length; i += 1) {
    const [x1, y1] = posiciones[i];
    const [x2, y2] = posiciones[(i + 1) % posiciones.length];
    const cruz = x1 * y2 - x2 * y1;
    areaDoble += cruz;
    este += (x1 + x2) * cruz;
    norte += (y1 + y2) * cruz;
  }

  if (areaDoble === 0) {
    return Object.freeze(mediaDePosiciones(posiciones));
  }

  const factor = 1 / (3 * areaDoble);
  return Object.freeze({ este: este * factor, norte: norte * factor });
}

/**
 * Centroide de longitud de una polilinea.
 *
 * Pesar por longitud y no por vertices importa: OSM mete decenas de nodos en
 * una rotonda y solo dos en el recto de un kilometro que sale de ella. Con la
 * media de vertices, esa calle se asignaria a la celda de la rotonda.
 *
 * @param {Array<[number, number]>} eje  En metros proyectados
 * @returns {{este: number, norte: number}}
 */
export function centroideDePolilinea(eje) {
  const posiciones = validarPosiciones(eje, 2, 'centroideDePolilinea');

  let longitud = 0;
  let este = 0;
  let norte = 0;

  for (let i = 0; i < posiciones.length - 1; i += 1) {
    const [x1, y1] = posiciones[i];
    const [x2, y2] = posiciones[i + 1];
    const tramo = Math.hypot(x2 - x1, y2 - y1);
    longitud += tramo;
    este += ((x1 + x2) / 2) * tramo;
    norte += ((y1 + y2) / 2) * tramo;
  }

  if (longitud === 0) {
    return Object.freeze(mediaDePosiciones(posiciones));
  }
  return Object.freeze({ este: este / longitud, norte: norte / longitud });
}

/**
 * Parte una polilinea en piezas que quepan en una celda mas su margen.
 *
 * Un `way` de OSM no tiene techo de longitud: el Paseo Maritimo de A Coruna
 * son 2.212 m en un solo way. Guardado entero en la celda de su centroide,
 * sus extremos caen a 1.100 m del ancla, mas alla del margen que el formato
 * admite, y `codificarCelda` lo rechaza —con razon, porque a esa distancia el
 * elemento ya no pertenece a esa celda ni al streaming de esa zona.
 *
 * La regla no es la longitud recorrida sino la EXTENSION: lo que amenaza a la
 * precision es cuanto se aleja un vertice del ancla, no cuantos metros de
 * asfalto hay por medio. Un paseo que va y vuelve dentro de una manzana cabe
 * entero por largo que sea; una recta de dos kilometros no.
 *
 * Dos piezas consecutivas COMPARTEN el vertice de union, asi que la linea
 * sigue siendo continua al recomponerla. Un segmento mas largo que el maximo
 * se subdivide interpolando sobre su propia recta: interpolar sobre un
 * segmento recto es exacto y no inventa geometria.
 *
 * @param {Array<[number, number]>} eje  En metros proyectados
 * @param {number} extensionMaxima       Extension maxima por eje, en metros
 * @returns {Array<Array<[number, number]>>}
 */
export function partirPolilinea(eje, extensionMaxima) {
  const posiciones = validarPosiciones(eje, 2, 'partirPolilinea');
  if (!(Number.isFinite(extensionMaxima) && extensionMaxima > 0)) {
    throw new RangeError('partirPolilinea: `extensionMaxima` debe ser un numero positivo de metros');
  }

  // Paso 1: ningun segmento suelto puede superar el maximo, o no habria donde
  // cortar sin interpolar.
  /** @type {Array<[number, number]>} */
  const densa = [posiciones[0]];
  for (let i = 1; i < posiciones.length; i += 1) {
    const [x1, y1] = posiciones[i - 1];
    const [x2, y2] = posiciones[i];
    const trozos = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / extensionMaxima);
    for (let t = 1; t <= trozos; t += 1) {
      const razon = t / trozos;
      densa.push(t === trozos ? [x2, y2] : [x1 + (x2 - x1) * razon, y1 + (y2 - y1) * razon]);
    }
  }

  // Paso 2: acumular mientras la caja envolvente quepa. El centroide de una
  // pieza cae siempre dentro de su caja, asi que acotar la caja acota tambien
  // la distancia de cualquier vertice al ancla. Esa es la invariante que el
  // formato exige.
  const piezas = [];
  let pieza = [densa[0]];
  let esteMin = densa[0][0];
  let esteMax = densa[0][0];
  let norteMin = densa[0][1];
  let norteMax = densa[0][1];

  for (let i = 1; i < densa.length; i += 1) {
    const [este, norte] = densa[i];
    const cabe =
      Math.max(esteMax, este) - Math.min(esteMin, este) <= extensionMaxima &&
      Math.max(norteMax, norte) - Math.min(norteMin, norte) <= extensionMaxima;

    if (!cabe) {
      piezas.push(pieza);
      // La nueva pieza arranca en el ultimo vertice de la anterior: sin ese
      // vertice compartido quedaria un hueco visible en el mapa.
      const union = pieza.at(-1);
      pieza = [union];
      esteMin = union[0];
      esteMax = union[0];
      norteMin = union[1];
      norteMax = union[1];
    }

    pieza.push([este, norte]);
    esteMin = Math.min(esteMin, este);
    esteMax = Math.max(esteMax, este);
    norteMin = Math.min(norteMin, norte);
    norteMax = Math.max(norteMax, norte);
  }
  piezas.push(pieza);

  return piezas;
}

/**
 * @param {Array<[number, number]>} posiciones  [lon, lat] en grados
 * @param {Reproyector} reproyector
 * @returns {Array<[number, number]>} [este, norte] en metros absolutos
 */
function proyectarPosiciones(posiciones, reproyector) {
  return posiciones.map(([lon, lat]) => {
    const { este, norte } = reproyector.aProyectado({ lon, lat });
    return [este, norte];
  });
}

/**
 * @param {Array<[number, number]>} posiciones  Absolutas
 * @param {import('urbs-core').Celda} celda
 * @returns {Array<[number, number]>} Locales a la celda
 */
function localizarPosiciones(posiciones, celda) {
  return posiciones.map(([este, norte]) => {
    const local = aLocal({ este, norte }, celda);
    return [local.este, local.norte];
  });
}

/**
 * @param {unknown} reproyector
 * @returns {Reproyector}
 */
function validarReproyector(reproyector) {
  if (
    reproyector === null ||
    typeof reproyector !== 'object' ||
    typeof (/** @type {any} */ (reproyector).aProyectado) !== 'function' ||
    !Number.isInteger(/** @type {any} */ (reproyector).epsg)
  ) {
    throw new TypeError(
      'trocear: `reproyector` debe venir de crearReproyector o crearReproyectorDeTerritorio',
    );
  }
  return /** @type {Reproyector} */ (reproyector);
}

/**
 * Reparte edificios y tramos en celdas, con la geometria ya local.
 *
 * Solo se devuelven las celdas que tienen algo dentro: el territorio es un
 * rectangulo, pero la ciudad no, y escribir celdas vacias solo produce
 * peticiones de red que devuelven nada.
 *
 * @param {Object} datos
 * @param {import('urbs-core').Edificio[]} [datos.edificios]
 * @param {import('urbs-core').Tramo[]} [datos.tramos]
 * @param {Reproyector} datos.reproyector
 * @param {number} datos.ladoCeldaMetros
 * @param {number} [datos.margenMetros]
 * @returns {Map<string, import('urbs-core').ContenidoCelda>} Ordenado por fila y columna
 */
export function trocear({
  edificios = [],
  tramos = [],
  reproyector,
  ladoCeldaMetros,
  margenMetros,
}) {
  validarReproyector(reproyector);
  if (!(Number.isFinite(ladoCeldaMetros) && ladoCeldaMetros > 0)) {
    throw new RangeError('trocear: `ladoCeldaMetros` debe ser un numero positivo');
  }
  if (!Array.isArray(edificios) || !Array.isArray(tramos)) {
    throw new TypeError('trocear: `edificios` y `tramos` deben ser listas');
  }

  const margen = margenMetros ?? margenPorDefecto(ladoCeldaMetros);
  /** @type {Map<string, any>} */
  const porClave = new Map();

  /**
   * @param {{este: number, norte: number}} centroide
   * @returns {any}
   */
  function celdaPara(centroide) {
    const indice = indiceDeCelda(centroide, ladoCeldaMetros);
    const clave = claveDeCelda(indice);
    const existente = porClave.get(clave);
    if (existente !== undefined) {
      return existente;
    }

    const contenido = {
      celda: crearCelda({ indice, ladoCeldaMetros }),
      epsg: reproyector.epsg,
      margenMetros: margen,
      edificios: [],
      tramos: [],
    };
    porClave.set(clave, contenido);
    return contenido;
  }

  for (const edificio of edificios) {
    const anillos = edificio.huella.map((anillo) => proyectarPosiciones(anillo, reproyector));
    // El contorno exterior manda: los huecos son patios, no masa.
    const centroide = centroideDeAnillo(anillos[0]);
    const contenido = celdaPara(centroide);

    contenido.edificios.push({
      id: edificio.id,
      anillos: anillos.map((anillo) => localizarPosiciones(anillo, contenido.celda)),
      ancla: aLocal(centroide, contenido.celda),
      alturaMetros: edificio.alturaMetros,
      plantas: edificio.plantas,
      uso: edificio.uso,
      procedencia: edificio.procedencia,
    });
  }

  for (const tramo of tramos) {
    const piezas = partirPolilinea(proyectarPosiciones(tramo.eje, reproyector), margen);
    const partido = piezas.length > 1;

    for (const [posicion, pieza] of piezas.entries()) {
      const centroide = centroideDePolilinea(pieza);
      const contenido = celdaPara(centroide);

      contenido.tramos.push({
        // Partir es la excepcion: un vial que cabe entero conserva su id de
        // origen tal cual, y solo cuando hay varias piezas se numeran, para
        // que cada una siga apuntando a su `way`.
        id: partido ? `${tramo.id}#${posicion}` : tramo.id,
        eje: localizarPosiciones(pieza, contenido.celda),
        ancla: aLocal(centroide, contenido.celda),
        tipo: tramo.tipo,
        anchuraMetros: tramo.anchuraMetros,
        carriles: tramo.carriles,
        sentidoUnico: tramo.sentidoUnico,
        nombre: tramo.nombre,
        procedencia: tramo.procedencia,
      });
    }
  }

  // Orden estable por fila y luego por columna: dos ejecuciones con los mismos
  // datos escriben los mismos archivos en el mismo orden.
  const ordenadas = [...porClave.values()].sort(
    (a, b) => a.celda.indice.z - b.celda.indice.z || a.celda.indice.x - b.celda.indice.x,
  );

  return new Map(ordenadas.map((contenido) => [contenido.celda.clave, Object.freeze(contenido)]));
}
