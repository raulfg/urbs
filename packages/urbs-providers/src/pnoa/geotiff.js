/**
 * Lector de GeoTIFF, del tamano justo para leer el MDT del PNOA.
 *
 * NO es una libreria de GeoTIFF y no pretende serlo. Lee exactamente lo que
 * devuelve el servicio WCS del IGN —tiras crudas, sin comprimir, una muestra
 * por pixel— y se NIEGA a leer cualquier otra cosa. Esa negativa es la
 * caracteristica principal: un lector que improvisa ante una variante que no
 * conoce devuelve relieve con aspecto de television estropeada, y eso se
 * diagnostica fatal porque el error aparece a mil kilometros del sitio.
 *
 * Se escribe en vez de traer una dependencia porque son noventa lineas, el
 * formato de lo que pedimos esta fijado por el servicio y verificado contra su
 * respuesta real, y `urbs-providers` gana asi una dependencia menos que fijar.
 *
 * Referencia: TIFF 6.0 mas las etiquetas de GeoTIFF 1.1 (33550, 33922).
 */

/** Etiquetas TIFF que se leen. Las demas se ignoran sin ruido. */
const ETIQUETA = Object.freeze({
  ANCHO: 256,
  ALTO: 257,
  BITS: 258,
  COMPRESION: 259,
  OFFSETS_TIRA: 273,
  MUESTRAS_POR_PIXEL: 277,
  FILAS_POR_TIRA: 278,
  BYTES_TIRA: 279,
  FORMATO_MUESTRA: 339,
  ESCALA_PIXEL: 33550,
  AMARRE: 33922,
  NODATA: 42113,
});

/** Bytes de cada tipo TIFF, indexado por su codigo. */
const BYTES_POR_TIPO = Object.freeze({
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
});

const SIN_COMPRIMIR = 1;
const FORMATO_ENTERO_CON_SIGNO = 2;
const FORMATO_COMA_FLOTANTE = 3;

/**
 * @param {DataView} vista
 * @param {boolean} le
 * @param {number} tipo
 * @param {number} cuenta
 * @param {number} desplazamiento
 * @returns {number[]}
 */
function leerValores(vista, le, tipo, cuenta, desplazamiento) {
  const salida = [];
  const paso = BYTES_POR_TIPO[tipo] ?? 1;
  for (let i = 0; i < cuenta; i += 1) {
    const o = desplazamiento + i * paso;
    switch (tipo) {
      case 1: case 7: salida.push(vista.getUint8(o)); break;
      case 3: salida.push(vista.getUint16(o, le)); break;
      case 4: salida.push(vista.getUint32(o, le)); break;
      case 8: salida.push(vista.getInt16(o, le)); break;
      case 9: salida.push(vista.getInt32(o, le)); break;
      case 11: salida.push(vista.getFloat32(o, le)); break;
      case 12: salida.push(vista.getFloat64(o, le)); break;
      case 5: salida.push(vista.getUint32(o, le) / vista.getUint32(o + 4, le)); break;
      default: salida.push(Number.NaN);
    }
  }
  return salida;
}

/**
 * Lee un GeoTIFF de una banda, sin comprimir.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ancho: number, alto: number, cotas: Int16Array|Float32Array,
 *            noroeste: {lon: number, lat: number}, paso: {lon: number, lat: number},
 *            nodata: number|null}}
 */
export function leerGeoTiff(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) {
    throw new TypeError('leerGeoTiff: se esperaba un ArrayBuffer con un TIFF dentro');
  }

  const vista = new DataView(buffer);
  const marca = String.fromCharCode(vista.getUint8(0), vista.getUint8(1));
  if (marca !== 'II' && marca !== 'MM') {
    throw new Error(
      'leerGeoTiff: esto no es un TIFF (no empieza por II ni MM). ' +
        'Un servicio WCS que falla suele responder XML con un codigo 200.',
    );
  }
  const le = marca === 'II';
  if (vista.getUint16(2, le) !== 42) {
    throw new Error('leerGeoTiff: no es un TIFF clasico; BigTIFF no se admite');
  }

  const etiquetas = new Map();
  const inicioIfd = vista.getUint32(4, le);
  const numeroEntradas = vista.getUint16(inicioIfd, le);
  for (let i = 0; i < numeroEntradas; i += 1) {
    const entrada = inicioIfd + 2 + i * 12;
    const tag = vista.getUint16(entrada, le);
    const tipo = vista.getUint16(entrada + 2, le);
    const cuenta = vista.getUint32(entrada + 4, le);
    const bytes = (BYTES_POR_TIPO[tipo] ?? 1) * cuenta;
    // Si cabe en cuatro bytes va en la propia entrada; si no, ahi hay un offset.
    const desplazamiento = bytes <= 4 ? entrada + 8 : vista.getUint32(entrada + 8, le);
    etiquetas.set(tag, leerValores(vista, le, tipo, cuenta, desplazamiento));
  }

  const exigir = (tag, nombre) => {
    const valor = etiquetas.get(tag);
    if (valor === undefined) {
      throw new Error(`leerGeoTiff: al TIFF le falta la etiqueta ${tag} (${nombre})`);
    }
    return valor;
  };

  const ancho = exigir(ETIQUETA.ANCHO, 'ancho')[0];
  const alto = exigir(ETIQUETA.ALTO, 'alto')[0];
  const bits = exigir(ETIQUETA.BITS, 'bits por muestra')[0];
  const compresion = etiquetas.get(ETIQUETA.COMPRESION)?.[0] ?? SIN_COMPRIMIR;
  const muestrasPorPixel = etiquetas.get(ETIQUETA.MUESTRAS_POR_PIXEL)?.[0] ?? 1;
  const formato = etiquetas.get(ETIQUETA.FORMATO_MUESTRA)?.[0] ?? 1;

  if (compresion !== SIN_COMPRIMIR) {
    throw new Error(
      `leerGeoTiff: el TIFF viene comprimido (compresion ${compresion}) y este lector solo entiende tiras crudas`,
    );
  }
  if (muestrasPorPixel !== 1) {
    throw new Error(
      `leerGeoTiff: se esperaba una banda por pixel y el TIFF trae ${muestrasPorPixel}`,
    );
  }

  const esFlotante = formato === FORMATO_COMA_FLOTANTE && bits === 32;
  const esEntero16 = formato === FORMATO_ENTERO_CON_SIGNO && bits === 16;
  const esEntero32 = formato === FORMATO_ENTERO_CON_SIGNO && bits === 32;
  if (!esFlotante && !esEntero16 && !esEntero32) {
    throw new Error(
      `leerGeoTiff: no se sabe leer ${bits} bits con formato de muestra ${formato}. ` +
        'Se admiten int16, int32 y float32, que son los que sirve el MDT.',
    );
  }

  const escala = exigir(ETIQUETA.ESCALA_PIXEL, 'escala de pixel');
  const amarre = etiquetas.get(ETIQUETA.AMARRE);
  if (amarre === undefined || amarre.length < 6) {
    throw new Error(
      'leerGeoTiff: al TIFF le falta el amarre (33922), asi que no se sabe donde cae en el mundo',
    );
  }

  const bytesPorMuestra = bits / 8;
  const offsets = exigir(ETIQUETA.OFFSETS_TIRA, 'offsets de tira');
  const cuentas = exigir(ETIQUETA.BYTES_TIRA, 'bytes por tira');

  const cotas = esFlotante ? new Float32Array(ancho * alto) : new Int16Array(ancho * alto);
  const salidaEs16 = !esFlotante && esEntero16;

  let escrito = 0;
  for (let tira = 0; tira < offsets.length && escrito < cotas.length; tira += 1) {
    const inicio = offsets[tira];
    const cuantas = Math.min(cuentas[tira] / bytesPorMuestra, cotas.length - escrito);
    for (let i = 0; i < cuantas; i += 1) {
      const o = inicio + i * bytesPorMuestra;
      if (esFlotante) cotas[escrito] = vista.getFloat32(o, le);
      else if (salidaEs16) cotas[escrito] = vista.getInt16(o, le);
      else cotas[escrito] = vista.getInt32(o, le);
      escrito += 1;
    }
  }

  if (escrito < cotas.length) {
    throw new Error(
      `leerGeoTiff: el TIFF declara ${ancho}x${alto} pixeles pero solo trae datos para ${escrito}`,
    );
  }

  const textoNodata = etiquetas.get(ETIQUETA.NODATA);
  const nodata =
    textoNodata === undefined
      ? null
      : Number.parseFloat(textoNodata.map((c) => String.fromCharCode(c)).join('').replace(/\0/g, ''));

  return {
    ancho,
    alto,
    cotas,
    // El amarre lleva (i, j, k, x, y, z): el pixel raster y su punto en el mundo.
    noroeste: { lon: amarre[3], lat: amarre[4] },
    paso: { lon: escala[0], lat: escala[1] },
    nodata: Number.isFinite(nodata) ? nodata : null,
  };
}
