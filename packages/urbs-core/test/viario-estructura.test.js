import test from 'node:test';
import assert from 'node:assert/strict';

import { Confianza, crearProcedencia } from '../src/dominio/procedencia.js';
import { Estructura, TipoVia, crearTramo } from '../src/dominio/viario.js';

const PROCEDENCIA = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });

function tramo(extra = {}) {
  return crearTramo({
    id: 'way/1',
    eje: [
      [0, 0],
      [100, 0],
    ],
    tipo: TipoVia.SECUNDARIA,
    anchuraMetros: 10,
    procedencia: PROCEDENCIA,
    ...extra,
  });
}

// --- Por defecto

test('una calle normal va a rasante y en el nivel cero', () => {
  const via = tramo();

  assert.equal(via.estructura, Estructura.RASANTE);
  assert.equal(via.nivel, 0);
});

test('rasante significa "sigue el terreno", que es lo que hace la inmensa mayoria', () => {
  // En el slice medido: 5.300 viales, de los cuales 24 puentes y 81 tuneles.
  // Lo raro es la excepcion, y por eso es el valor por defecto.
  assert.equal(Estructura.RASANTE, 'rasante');
});

// --- Puentes y tuneles

test('un puente NO va a rasante: se le pega al suelo y se hunde en lo que cruza', () => {
  // Muestrear el terreno por vertice glue cada puente al fondo del valle o de
  // la ria que cruza. En las entradas a A Coruna se ve al momento y ademas se
  // conduce dentro.
  const via = tramo({ estructura: Estructura.PUENTE });

  assert.equal(via.estructura, Estructura.PUENTE);
});

test('un tunel tampoco: si sigue el terreno, la boca queda enterrada', () => {
  const via = tramo({ estructura: Estructura.TUNEL });

  assert.equal(via.estructura, Estructura.TUNEL);
});

test('las tres estructuras son las tres y no hay mas', () => {
  assert.deepEqual(Object.values(Estructura).sort(), ['puente', 'rasante', 'tunel']);
});

test('una estructura inventada se rechaza en vez de colarse como rasante', () => {
  assert.throws(() => tramo({ estructura: 'viaducto' }), /estructura/);
});

// --- Nivel

test('el nivel ordena lo que se cruza sin tocarse, y admite negativos', () => {
  assert.equal(tramo({ nivel: -1 }).nivel, -1);
  assert.equal(tramo({ nivel: 2 }).nivel, 2);
});

test('el nivel es independiente de la estructura', () => {
  // En el slice hay 70 vias en `layer=-1` y solo 81 tuneles: no son el mismo
  // conjunto. Un paso inferior a cielo abierto esta bajo nivel y no es tunel.
  const via = tramo({ estructura: Estructura.RASANTE, nivel: -1 });

  assert.equal(via.estructura, Estructura.RASANTE);
  assert.equal(via.nivel, -1);
});

test('un nivel que no sea entero se rechaza', () => {
  for (const basura of [1.5, Number.NaN, '1', null]) {
    assert.throws(() => tramo({ nivel: basura }), /nivel/);
  }
});

test('un nivel absurdo se rechaza: el maximo real medido es 5', () => {
  assert.throws(() => tramo({ nivel: 900 }), /nivel/);
  assert.throws(() => tramo({ nivel: -900 }), /nivel/);
});
