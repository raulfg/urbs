import test from 'node:test';
import assert from 'node:assert/strict';

import { leerGeoTiff } from '../src/pnoa/geotiff.js';

const TIPO = { CORTO: 3, LARGO: 4, DOBLE: 12 };

/**
 * Construye un GeoTIFF minimo, little-endian y sin comprimir.
 *
 * Se arma a mano en vez de guardar un fixture binario por dos razones: un
 * fixture de 80 KB no se revisa en un diff, y armarlo obliga a escribir el
 * formato que el lector dice entender, que es justo lo que hay que comprobar.
 *
 * @param {Object} opciones
 */
function construirTiff({
  ancho,
  alto,
  muestras,
  bits = 16,
  formatoMuestra = 2,
  compresion = 1,
  noroeste = { lon: -8.412, lat: 43.39 },
  paso = { lon: 0.00005, lat: 0.00005 },
  omitirAmarre = false,
  filasPorTira = null,
}) {
  const bytesPorMuestra = bits / 8;
  const entradas = [];

  const filas = filasPorTira ?? alto;
  const numeroTiras = Math.ceil(alto / filas);

  const NUMERO_ENTRADAS = omitirAmarre ? 10 : 11;
  const inicioIfd = 8;
  const finIfd = inicioIfd + 2 + NUMERO_ENTRADAS * 12 + 4;

  // Valores que no caben en los cuatro bytes de la entrada.
  let cursor = finIfd;
  const offsetEscala = cursor;
  cursor += 24;
  const offsetAmarre = cursor;
  if (!omitirAmarre) cursor += 48;
  const offsetTiras = numeroTiras > 1 ? cursor : 0;
  if (numeroTiras > 1) cursor += numeroTiras * 4 * 2;
  const offsetDatos = cursor;

  const total = offsetDatos + ancho * alto * bytesPorMuestra;
  const buffer = new ArrayBuffer(total);
  const vista = new DataView(buffer);

  vista.setUint8(0, 0x49);
  vista.setUint8(1, 0x49);
  vista.setUint16(2, 42, true);
  vista.setUint32(4, inicioIfd, true);

  const offsetsDeTira = [];
  const cuentasDeTira = [];
  for (let t = 0; t < numeroTiras; t += 1) {
    const primeraFila = t * filas;
    const filasDeEsta = Math.min(filas, alto - primeraFila);
    offsetsDeTira.push(offsetDatos + primeraFila * ancho * bytesPorMuestra);
    cuentasDeTira.push(filasDeEsta * ancho * bytesPorMuestra);
  }

  const anadir = (tag, tipo, cuenta, valor) => entradas.push({ tag, tipo, cuenta, valor });

  anadir(256, TIPO.LARGO, 1, ancho);
  anadir(257, TIPO.LARGO, 1, alto);
  anadir(258, TIPO.CORTO, 1, bits);
  anadir(259, TIPO.CORTO, 1, compresion);
  anadir(273, TIPO.LARGO, numeroTiras, numeroTiras > 1 ? offsetTiras : offsetsDeTira[0]);
  anadir(277, TIPO.CORTO, 1, 1);
  anadir(278, TIPO.LARGO, 1, filas);
  anadir(279, TIPO.LARGO, numeroTiras, numeroTiras > 1 ? offsetTiras + numeroTiras * 4 : cuentasDeTira[0]);
  anadir(339, TIPO.CORTO, 1, formatoMuestra);
  anadir(33550, TIPO.DOBLE, 3, offsetEscala);
  if (!omitirAmarre) anadir(33922, TIPO.DOBLE, 6, offsetAmarre);

  vista.setUint16(inicioIfd, entradas.length, true);
  for (const [i, entrada] of entradas.entries()) {
    const o = inicioIfd + 2 + i * 12;
    vista.setUint16(o, entrada.tag, true);
    vista.setUint16(o + 2, entrada.tipo, true);
    vista.setUint32(o + 4, entrada.cuenta, true);
    if (entrada.tipo === TIPO.CORTO && entrada.cuenta === 1) {
      vista.setUint16(o + 8, entrada.valor, true);
    } else {
      vista.setUint32(o + 8, entrada.valor, true);
    }
  }
  vista.setUint32(inicioIfd + 2 + entradas.length * 12, 0, true);

  vista.setFloat64(offsetEscala, paso.lon, true);
  vista.setFloat64(offsetEscala + 8, paso.lat, true);
  vista.setFloat64(offsetEscala + 16, 0, true);

  if (!omitirAmarre) {
    for (let i = 0; i < 3; i += 1) vista.setFloat64(offsetAmarre + i * 8, 0, true);
    vista.setFloat64(offsetAmarre + 24, noroeste.lon, true);
    vista.setFloat64(offsetAmarre + 32, noroeste.lat, true);
    vista.setFloat64(offsetAmarre + 40, 0, true);
  }

  if (numeroTiras > 1) {
    for (let t = 0; t < numeroTiras; t += 1) {
      vista.setUint32(offsetTiras + t * 4, offsetsDeTira[t], true);
      vista.setUint32(offsetTiras + numeroTiras * 4 + t * 4, cuentasDeTira[t], true);
    }
  }

  for (let i = 0; i < ancho * alto; i += 1) {
    const o = offsetDatos + i * bytesPorMuestra;
    if (bits === 8) vista.setUint8(o, muestras[i]);
    else if (bits === 16 && formatoMuestra === 2) vista.setInt16(o, muestras[i], true);
    else if (bits === 16) vista.setUint16(o, muestras[i], true);
    else if (bits === 32 && formatoMuestra === 3) vista.setFloat32(o, muestras[i], true);
    else vista.setInt32(o, muestras[i], true);
  }

  return buffer;
}

// --- Lectura

test('lee tamano, cotas y geoeferenciacion de un GeoTIFF sin comprimir', () => {
  const tif = leerGeoTiff(
    construirTiff({ ancho: 3, alto: 2, muestras: [0, 10, 20, 30, 40, 50] }),
  );

  assert.equal(tif.ancho, 3);
  assert.equal(tif.alto, 2);
  assert.deepEqual([...tif.cotas], [0, 10, 20, 30, 40, 50]);
  assert.ok(Math.abs(tif.noroeste.lon - -8.412) < 1e-12);
  assert.ok(Math.abs(tif.noroeste.lat - 43.39) < 1e-12);
  assert.ok(Math.abs(tif.paso.lon - 0.00005) < 1e-15);
});

test('las cotas salen en orden de lectura: fila 0 es la del NORTE', () => {
  // Si se invirtiera la vertical, el relieve saldria reflejado y nadie lo veria
  // hasta comparar con un mapa. El orden es el del fichero, sin reinterpretar.
  const tif = leerGeoTiff(construirTiff({ ancho: 2, alto: 2, muestras: [1, 2, 3, 4] }));

  assert.deepEqual([...tif.cotas], [1, 2, 3, 4]);
});

test('el mar sale como cero exacto, que es lo que hace util a este dato', () => {
  const tif = leerGeoTiff(
    construirTiff({ ancho: 4, alto: 1, muestras: [0, 0, 12, 45] }),
  );

  assert.deepEqual([...tif.cotas], [0, 0, 12, 45]);
});

test('lee cotas negativas: el int16 lleva signo', () => {
  const tif = leerGeoTiff(construirTiff({ ancho: 2, alto: 1, muestras: [-5, 3] }));
  assert.deepEqual([...tif.cotas], [-5, 3]);
});

test('lee un GeoTIFF repartido en varias tiras', () => {
  // El servicio del IGN devuelve una sola tira, pero el formato admite varias y
  // un lector que suponga una se rompe el dia que cambien el servidor.
  const tif = leerGeoTiff(
    construirTiff({ ancho: 2, alto: 4, muestras: [1, 2, 3, 4, 5, 6, 7, 8], filasPorTira: 2 }),
  );

  assert.deepEqual([...tif.cotas], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('lee float32 ademas de int16: el MDT original del CNIG viene con decimales', () => {
  const tif = leerGeoTiff(
    construirTiff({ ancho: 2, alto: 1, muestras: [12.5, -0.25], bits: 32, formatoMuestra: 3 }),
  );

  assert.ok(Math.abs(tif.cotas[0] - 12.5) < 1e-6);
  assert.ok(Math.abs(tif.cotas[1] - -0.25) < 1e-6);
});

// --- Negativas

test('un fichero que no sea TIFF se rechaza con un mensaje que lo diga', () => {
  const basura = new Uint8Array([0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0, 0, 0]).buffer;
  assert.throws(() => leerGeoTiff(basura), /TIFF/);
});

test('un TIFF comprimido se rechaza en vez de devolver ruido', () => {
  // El lector sabe leer tiras crudas y nada mas. Si algun dia el servicio
  // empieza a comprimir, hay que enterarse por un error y no por un relieve
  // con aspecto de television estropeada.
  assert.throws(
    () => leerGeoTiff(construirTiff({ ancho: 2, alto: 1, muestras: [1, 2], compresion: 5 })),
    /comprimid|compresion/i,
  );
});

test('un TIFF sin georreferenciacion se rechaza: sin amarre no se sabe donde cae', () => {
  assert.throws(
    () => leerGeoTiff(construirTiff({ ancho: 2, alto: 1, muestras: [1, 2], omitirAmarre: true })),
    /33922|amarre|georreferen/i,
  );
});

test('una profundidad de bits que no se sabe leer se rechaza', () => {
  assert.throws(
    () => leerGeoTiff(construirTiff({ ancho: 2, alto: 1, muestras: [1, 2], bits: 8, formatoMuestra: 1 })),
    /bits|8/,
  );
});
