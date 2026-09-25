import test from 'node:test';
import assert from 'node:assert/strict';

import { Confianza, crearProcedencia } from '../src/dominio/procedencia.js';
import { crearCelda } from '../src/dominio/celda.js';
import {
  BYTES_CABECERA,
  codificarCelda,
  decodificarCelda,
  vistasDeCelda,
} from '../src/formato/celda-binaria.js';

const LADO = 250;
const EPSG = 25829;
const CELDA = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });
const PROCEDENCIA_DECLARADA = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });
const PROCEDENCIA_ESTIMADA = crearProcedencia({ proveedor: 'osm', confianza: Confianza.ESTIMADO });

/** Cuadrado local de `lado` m con la esquina en (este, norte). */
function cuadrado(este, norte, lado) {
  return [
    [este, norte],
    [este + lado, norte],
    [este + lado, norte + lado],
    [este, norte + lado],
    [este, norte],
  ];
}

const CONTENIDO = Object.freeze({
  celda: CELDA,
  epsg: EPSG,
  edificios: [
    {
      id: 'way/1',
      // Exterior con un patio dentro: el lector debe distinguir los dos anillos.
      anillos: [cuadrado(10, 10, 40), cuadrado(20, 20, 10)],
      ancla: { este: 30, norte: 30 },
      alturaMetros: 18,
      plantas: 6,
      uso: 'residencial',
      procedencia: PROCEDENCIA_DECLARADA,
    },
    {
      id: 'way/2',
      anillos: [cuadrado(100, 100, 20)],
      ancla: { este: 110, norte: 110 },
      alturaMetros: null,
      plantas: null,
      uso: 'comercial',
      procedencia: PROCEDENCIA_ESTIMADA,
    },
  ],
  tramos: [
    {
      id: 'way/9',
      eje: [
        [0, 5],
        [120, 5],
        [240, 60],
      ],
      ancla: { este: 120, norte: 20 },
      tipo: 'secundaria',
      anchuraMetros: 7.5,
      carriles: 2,
      sentidoUnico: true,
      nombre: 'Rua Real',
      procedencia: PROCEDENCIA_DECLARADA,
    },
  ],
});

const BYTES = codificarCelda(CONTENIDO);

test('la cabecera del lector de vistas es la misma que la del lector de objetos', () => {
  const vistas = vistasDeCelda(BYTES);
  assert.equal(vistas.cabecera.numeroEdificios, 2);
  assert.equal(vistas.cabecera.numeroTramos, 1);
  assert.equal(vistas.cabecera.epsg, EPSG);
  assert.equal(vistas.cabecera.ladoCeldaMetros, LADO);
  assert.deepEqual(vistas.cabecera.indice, { x: 2188, z: 19202 });
});

test('las secciones salen como vistas tipadas, no como listas de numeros', () => {
  const { edificios, tramos } = vistasDeCelda(BYTES);

  assert.ok(edificios.inicioAnillo instanceof Uint32Array);
  assert.ok(edificios.anillosInicioVertice instanceof Uint32Array);
  assert.ok(edificios.vertices instanceof Float32Array);
  assert.ok(edificios.ancla instanceof Float32Array);
  assert.ok(edificios.altura instanceof Float32Array);
  assert.ok(edificios.plantas instanceof Int16Array);
  assert.ok(edificios.uso instanceof Uint8Array);
  assert.ok(edificios.procedencia instanceof Uint16Array);

  assert.ok(tramos.inicioVertice instanceof Uint32Array);
  assert.ok(tramos.vertices instanceof Float32Array);
  assert.ok(tramos.ancla instanceof Float32Array);
  assert.ok(tramos.anchura instanceof Float32Array);
  assert.ok(tramos.carriles instanceof Int16Array);
  assert.ok(tramos.banderas instanceof Uint8Array);
  assert.ok(tramos.tipo instanceof Uint8Array);
  assert.ok(tramos.procedencia instanceof Uint16Array);
});

test('las vistas NO copian: comparten el ArrayBuffer del archivo', () => {
  // Es la razon de ser del formato. Si esto deja de cumplirse, cada celda
  // cargada duplica su memoria y el streaming empieza a costar el doble.
  const copia = BYTES.slice();
  const vistas = vistasDeCelda(copia);

  assert.equal(vistas.edificios.vertices.buffer, copia.buffer);

  const antes = vistas.edificios.vertices[0];
  vistas.edificios.vertices[0] = antes + 1;
  assert.equal(vistasDeCelda(copia).edificios.vertices[0], antes + 1);
});

test('acepta un ArrayBuffer directamente: es lo que devuelve fetch en el navegador', () => {
  const buffer = BYTES.buffer.slice(BYTES.byteOffset, BYTES.byteOffset + BYTES.byteLength);
  const vistas = vistasDeCelda(buffer);

  assert.equal(vistas.cabecera.numeroEdificios, 2);
  assert.equal(vistas.edificios.vertices.buffer, buffer);
});

test('un Uint8Array mal alineado se copia antes de leer en vez de reventar', () => {
  // Las vistas tipadas exigen que el byteOffset sea multiplo del elemento.
  const desalineado = new Uint8Array(BYTES.byteLength + 1);
  desalineado.set(BYTES, 1);
  const vista = desalineado.subarray(1);
  assert.equal(vista.byteOffset % 8, 1);

  const vistas = vistasDeCelda(vista);
  assert.equal(vistas.cabecera.numeroEdificios, 2);
  assert.equal(vistas.edificios.vertices.length, decodificarCelda(BYTES).edificios
    .flatMap((edificio) => edificio.anillos.flat()).length * 2);
});

test('el indice CSR de dos niveles permite recorrer los anillos de un edificio', () => {
  const { edificios } = vistasDeCelda(BYTES);

  // El primero tiene exterior + patio; el segundo, solo exterior.
  assert.equal(edificios.inicioAnillo[1] - edificios.inicioAnillo[0], 2);
  assert.equal(edificios.inicioAnillo[2] - edificios.inicioAnillo[1], 1);

  const primerAnillo = 0;
  const desde = edificios.anillosInicioVertice[primerAnillo];
  const hasta = edificios.anillosInicioVertice[primerAnillo + 1];
  assert.equal(hasta - desde, 5, 'el anillo exterior tiene 5 posiciones, con el cierre');
  assert.equal(edificios.vertices[desde * 2], 10);
  assert.equal(edificios.vertices[desde * 2 + 1], 10);
});

test('los diccionarios llegan resueltos: uso, tipo de via y procedencia por indice', () => {
  const { edificios, tramos, diccionarios } = vistasDeCelda(BYTES);

  assert.equal(diccionarios.usos[edificios.uso[0]], 'residencial');
  assert.equal(diccionarios.usos[edificios.uso[1]], 'comercial');
  assert.equal(diccionarios.tiposVia[tramos.tipo[0]], 'secundaria');
  assert.equal(diccionarios.procedencias[edificios.procedencia[0]].confianza, Confianza.DECLARADO);
  assert.equal(diccionarios.procedencias[edificios.procedencia[1]].confianza, Confianza.ESTIMADO);
});

test('los ids y nombres siguen disponibles sin tocar la geometria', () => {
  const { ids, nombres } = vistasDeCelda(BYTES);

  assert.deepEqual(ids.edificios, ['way/1', 'way/2']);
  assert.deepEqual(ids.tramos, ['way/9']);
  assert.deepEqual(nombres.tramos, ['Rua Real']);
});

test('los ausentes viajan como centinela, no como null: es lo que dice el ADR', () => {
  const { edificios, tramos } = vistasDeCelda(BYTES);

  assert.ok(Number.isNaN(edificios.altura[1]), 'altura ausente debe ser NaN');
  assert.equal(edificios.plantas[1], -1, 'plantas ausentes deben ser -1');
  assert.equal(edificios.altura[0], 18);
  assert.equal(edificios.plantas[0], 6);
  assert.equal(tramos.carriles[0], 2);
});

test('la bandera de sentido unico se lee del bit, no de un booleano', () => {
  const { tramos } = vistasDeCelda(BYTES);
  assert.equal(tramos.banderas[0] & 1, 1);
});

test('ninguna coordenada de las vistas es absoluta: siguen siendo locales a la celda', () => {
  const { cabecera, edificios, tramos } = vistasDeCelda(BYTES);
  const limite = cabecera.ladoCeldaMetros + cabecera.margenMetros;

  for (const vertices of [edificios.vertices, tramos.vertices]) {
    for (const valor of vertices) {
      assert.ok(
        valor >= -cabecera.margenMetros && valor < limite,
        `${valor} no es una coordenada local`,
      );
    }
  }
  // Y el origen absoluto aparece una sola vez, en float64.
  assert.equal(cabecera.origen.este, 2188 * LADO);
});

test('un archivo que no es .urbscell se rechaza igual que en el lector de objetos', () => {
  assert.throws(() => vistasDeCelda(new Uint8Array(BYTES_CABECERA)), /urbscell/);
});

test('un archivo truncado se detecta en vez de devolver vistas basura', () => {
  assert.throws(() => vistasDeCelda(BYTES.subarray(0, BYTES.length - 200)), /trunca/i);
});

test('vistasDeCelda y decodificarCelda cuentan la misma historia', () => {
  const objetos = decodificarCelda(BYTES);
  const vistas = vistasDeCelda(BYTES);

  assert.equal(objetos.edificios.length, vistas.cabecera.numeroEdificios);
  assert.equal(objetos.tramos.length, vistas.cabecera.numeroTramos);

  for (const [i, edificio] of objetos.edificios.entries()) {
    assert.equal(edificio.id, vistas.ids.edificios[i]);
    assert.equal(edificio.uso, vistas.diccionarios.usos[vistas.edificios.uso[i]]);
    assert.equal(edificio.ancla.este, vistas.edificios.ancla[i * 2]);

    const anillos = vistas.edificios.inicioAnillo[i + 1] - vistas.edificios.inicioAnillo[i];
    assert.equal(edificio.anillos.length, anillos);
  }
});
