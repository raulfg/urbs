import test from 'node:test';
import assert from 'node:assert/strict';

import { Confianza, crearProcedencia } from '../src/dominio/procedencia.js';
import { Estructura, TipoVia } from '../src/dominio/viario.js';
import { crearCelda } from '../src/dominio/celda.js';
import { SIN_DATO } from '../src/dominio/elevacion.js';
import {
  BYTES_CABECERA,
  SIN_DATO_RELIEVE,
  VERSION_FORMATO,
  esAguaEnPoste,
  codificarCelda,
  decodificarCelda,
  leerCabecera,
  vistasDeCelda,
} from '../src/formato/celda-binaria.js';

const LADO = 250;
const CELDA = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });
const DECLARADO = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });

function tramo(extra = {}) {
  return {
    id: 'way/1',
    eje: [
      [10, 10],
      [200, 10],
    ],
    ancla: { este: 105, norte: 10 },
    tipo: TipoVia.SECUNDARIA,
    anchuraMetros: 10,
    carriles: 2,
    sentidoUnico: false,
    nombre: null,
    estructura: Estructura.RASANTE,
    nivel: 0,
    procedencia: DECLARADO,
    ...extra,
  };
}

/** Un relieve de 3x3 postes sobre la celda, en metros. */
function relieve(cotas, paso = 125) {
  return { paso, cotas: Float32Array.from(cotas) };
}

function codificar(contenido) {
  return codificarCelda({ celda: CELDA, epsg: 25829, edificios: [], tramos: [], ...contenido });
}

// --- Version y cabecera

test('el formato sube a 3 y la cabecera se queda en 88 bytes', () => {
  assert.equal(VERSION_FORMATO, 3);
  assert.equal(BYTES_CABECERA, 88);
  assert.equal(BYTES_CABECERA % 8, 0, 'la cabecera tiene que dejar las secciones alineadas');
});

test('una celda sin relieve lo dice con cero postes, no con una malla vacia', () => {
  const cabecera = leerCabecera(codificar({}));

  assert.equal(cabecera.relieve.postes, 0);
  assert.equal(cabecera.relieve.pasoMetros, 0);
});

test('la cabecera lleva el paso de la malla, que NO es una constante del motor', () => {
  // Va en cabecera para que un territorio o un nivel de detalle lo cambien sin
  // tocar la version del formato. Medido: a 10 m el error es de 0,17 m rms en
  // suelo urbano y la malla ocupa el 10% de la celda.
  const cabecera = leerCabecera(codificar({ relieve: relieve([1, 2, 3, 4, 5, 6, 7, 8, 9], 125) }));

  assert.equal(cabecera.relieve.postes, 3);
  assert.equal(cabecera.relieve.pasoMetros, 125);
});

// --- Cotas relativas

test('las cotas viajan en decimetros RELATIVOS a una cota base de la celda', () => {
  // El mismo truco que el origen flotante, en la vertical. Un int16 en
  // decimetros absolutos llega a 3.276 m y se queda corto en el Mulhacen
  // (3.479 m); relativo a la celda no se queda corto en ninguna parte, porque
  // una celda de 250 m no abarca semejante desnivel.
  const vistas = vistasDeCelda(codificar({ relieve: relieve([100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104]) }));

  assert.ok(vistas.cabecera.relieve.cotaBase <= 100);
  assert.ok(vistas.relieve.cotas instanceof Int16Array);
  assert.equal(vistas.relieve.cotas.length, 9);
});

test('las cotas vuelven en metros y con un decimetro de fidelidad', () => {
  const metros = [100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104];
  const { relieve: leido } = decodificarCelda(codificar({ relieve: relieve(metros) }));

  for (const [i, esperado] of metros.entries()) {
    assert.ok(Math.abs(leido.cotas[i] - esperado) <= 0.05, `poste ${i}: ${leido.cotas[i]} vs ${esperado}`);
  }
});

test('una cota negativa tambien viaja: el mar no siempre cae en cero', () => {
  // Medido sobre la hoja real: va de -2,69 a 243,38 m.
  const { relieve: leido } = decodificarCelda(codificar({ relieve: relieve([-2.7, 0, 5, 10, 20, 40, 80, 160, 243.4]) }));

  assert.ok(Math.abs(leido.cotas[0] - -2.7) <= 0.05);
  assert.ok(Math.abs(leido.cotas[8] - 243.4) <= 0.05);
});

test('un poste sin dato se conserva como sin dato, no como cota cero', () => {
  // Cero es una cota valida y ademas es el nivel del mar. Confundirlos mete
  // agua en mitad de una ladera.
  const { relieve: leido } = decodificarCelda(
    codificar({ relieve: relieve([10, SIN_DATO, 12, 13, 14, 15, 16, 17, 18]) }),
  );

  assert.equal(leido.cotas[1], null);
  assert.ok(Math.abs(leido.cotas[0] - 10) <= 0.05);
});

test('el centinela de relieve no colisiona con ninguna cota real', () => {
  assert.equal(SIN_DATO_RELIEVE, -32768);
});

test('una malla que no sea cuadrada se rechaza', () => {
  assert.throws(() => codificar({ relieve: relieve([1, 2, 3, 4, 5]) }), /postes|cuadrada/i);
});

test('un paso de malla no positivo se rechaza', () => {
  assert.throws(() => codificar({ relieve: relieve([1, 2, 3, 4], 0) }), /paso/);
});

// --- Estructura del viario

test('la estructura y el nivel del tramo viajan en la celda', () => {
  const vistas = vistasDeCelda(
    codificar({
      tramos: [
        tramo({ id: 'way/1', estructura: Estructura.RASANTE, nivel: 0 }),
        tramo({ id: 'way/2', estructura: Estructura.PUENTE, nivel: 1 }),
        tramo({ id: 'way/3', estructura: Estructura.TUNEL, nivel: -1 }),
      ],
    }),
  );

  assert.equal(vistas.tramos.estructura.length, 3);
  assert.equal(vistas.tramos.nivel.length, 3);
  assert.ok(vistas.tramos.nivel instanceof Int8Array, 'el nivel lleva signo');
});

test('la estructura se lee de vuelta con su nombre, no con un numero suelto', () => {
  const { tramos } = decodificarCelda(
    codificar({
      tramos: [
        tramo({ id: 'way/1', estructura: Estructura.PUENTE, nivel: 1 }),
        tramo({ id: 'way/2', estructura: Estructura.TUNEL, nivel: -1 }),
      ],
    }),
  );

  assert.equal(tramos[0].estructura, Estructura.PUENTE);
  assert.equal(tramos[0].nivel, 1);
  assert.equal(tramos[1].estructura, Estructura.TUNEL);
  assert.equal(tramos[1].nivel, -1);
});

test('un tramo sin estructura declarada entra como rasante', () => {
  const { tramos } = decodificarCelda(codificar({ tramos: [{ ...tramo(), estructura: undefined, nivel: undefined }] }));

  assert.equal(tramos[0].estructura, Estructura.RASANTE);
  assert.equal(tramos[0].nivel, 0);
});

// --- Compatibilidad

test('un lector de v2 se niega a leer un archivo de otra version', () => {
  const bytes = codificar({});
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, 99, true);

  assert.throws(() => leerCabecera(bytes), /version/i);
});

test('todo lo de v1 sigue estando donde estaba, solo que 16 bytes mas alla', () => {
  const vistas = vistasDeCelda(codificar({ tramos: [tramo()] }));

  assert.equal(vistas.cabecera.epsg, 25829);
  assert.equal(vistas.cabecera.ladoCeldaMetros, LADO);
  assert.equal(vistas.cabecera.numeroTramos, 1);
  assert.equal(vistas.tramos.anchura[0], 10);
});

// --- Bandera de agua (v3)

test('la bandera de agua viaja por poste y en BITS', () => {
  // Un booleano por poste son 676 bits en una celda de 26x26: 85 bytes en vez
  // de 676. A 200 km2 la diferencia se nota.
  const agua = Uint8Array.from([1, 0, 0, 1, 1, 0, 0, 0, 1]);
  const vistas = vistasDeCelda(
    codificar({ relieve: { ...relieve([1, 2, 3, 4, 5, 6, 7, 8, 9]), agua } }),
  );

  assert.equal(vistas.relieve.agua.length, Math.ceil(9 / 8));
  for (let i = 0; i < 9; i += 1) {
    assert.equal(esAguaEnPoste(vistas.relieve, i), agua[i] === 1, `poste ${i}`);
  }
});

test('sin bandera declarada, ningun poste es agua', () => {
  // Es el fallo seguro: "falta agua" se ve al instante, "sobra agua" inunda
  // calles sin avisar.
  const vistas = vistasDeCelda(codificar({ relieve: relieve([1, 2, 3, 4, 5, 6, 7, 8, 9]) }));

  for (let i = 0; i < 9; i += 1) {
    assert.equal(esAguaEnPoste(vistas.relieve, i), false);
  }
});

test('una bandera que no cuadre con los postes se rechaza', () => {
  assert.throws(
    () => codificar({ relieve: { ...relieve([1, 2, 3, 4]), agua: Uint8Array.from([1, 0]) } }),
    /agua|postes/i,
  );
});

test('un poste bajo la cota del agua puede NO ser agua: es la razon de que exista la bandera', () => {
  // Una trinchera, un dique seco o una rampa de aparcamiento estan por debajo
  // del mar y son tierra. Lo que distingue el mar de un socavon es que sale del
  // territorio, y eso no se ve mirando una celda.
  const vistas = vistasDeCelda(
    codificar({
      relieve: { ...relieve([-3, 10, 20, 30]), agua: Uint8Array.from([0, 0, 0, 0]) },
    }),
  );

  assert.equal(esAguaEnPoste(vistas.relieve, 0), false);
});
