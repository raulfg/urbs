import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Confianza, TipoVia, UsoEdificio, ALTURA_PLANTA_POR_DEFECTO } from 'urbs-core';

import { transformarEdificios, transformarViario } from '../src/osm/transformacion.js';
import { esTipoConducible, ANCHURA_POR_HIGHWAY } from '../src/osm/etiquetas.js';

const MUESTRA = JSON.parse(
  readFileSync(new URL('./fixtures/overpass-muestra.json', import.meta.url), 'utf8'),
);

const PROVEEDOR = 'osm-test';

function edificios(opciones = {}) {
  return transformarEdificios(MUESTRA, { proveedorId: PROVEEDOR, ...opciones });
}

function viario(opciones = {}) {
  return transformarViario(MUESTRA, { proveedorId: PROVEEDOR, ...opciones });
}

function porId(elementos) {
  return new Map(elementos.map((elemento) => [elemento.id, elemento]));
}

test('la capa de edificios ignora las vias y viceversa', () => {
  const { edificios: resultado } = edificios();
  const { tramos } = viario();

  assert.ok(resultado.every((edificio) => edificio.id.startsWith('way/') || edificio.id.startsWith('relation/')));
  assert.equal(resultado.some((edificio) => edificio.id === 'way/20'), false);
  assert.equal(tramos.some((tramo) => tramo.id === 'way/1'), false);
});

test('una huella simple se transforma con su anillo exterior', () => {
  const edificio = porId(edificios().edificios).get('way/1');

  assert.equal(edificio.huella.length, 1);
  assert.equal(edificio.huella[0].length, 5);
  // El dominio habla en [lon, lat], no al reves.
  assert.deepEqual(edificio.huella[0][0], [-8.4, 43.37]);
  assert.equal(edificio.uso, UsoEdificio.RESIDENCIAL);
  assert.equal(edificio.plantas, 5);
  assert.equal(edificio.alturaMetros, 5 * ALTURA_PLANTA_POR_DEFECTO);
  assert.equal(edificio.procedencia.proveedor, PROVEEDOR);
  assert.equal(edificio.procedencia.confianza, Confianza.ESTIMADO);
});

test('una relacion multipoligono da anillo exterior mas huecos', () => {
  // Ciudad Vieja y Pescaderia son manzanas de perimetro cerrado alrededor de
  // patios interiores. Perder los huecos convierte la manzana en un bloque
  // macizo de granito.
  const edificio = porId(edificios().edificios).get('relation/100');

  assert.ok(edificio, 'la relacion multipoligono debe producir un edificio');
  assert.equal(edificio.huella.length, 2);
  assert.equal(edificio.huella[1].length, 5);
  assert.equal(edificio.plantas, 6);
});

test('el building de la relacion manda, no el de sus miembros sin etiquetar', () => {
  const ids = edificios().edificios.map((edificio) => edificio.id);

  // Los way 10 y 11 son los miembros del multipoligono: no son edificios.
  assert.equal(ids.includes('way/10'), false);
  assert.equal(ids.includes('way/11'), false);
});

test('height sano llega como declarado hasta la procedencia', () => {
  const edificio = porId(edificios().edificios).get('way/4');

  assert.equal(edificio.alturaMetros, 18.5);
  assert.equal(edificio.procedencia.confianza, Confianza.DECLARADO);
  assert.equal(edificio.uso, UsoEdificio.COMERCIAL);
});

test('height sucio se rechaza, se estima por plantas y queda registrado', () => {
  const { edificios: resultado, incidencias } = edificios();
  const edificio = porId(resultado).get('way/2');

  assert.equal(edificio.alturaMetros, 4 * ALTURA_PLANTA_POR_DEFECTO);
  assert.equal(edificio.procedencia.confianza, Confianza.ESTIMADO);

  const rechazo = incidencias.find(
    (incidencia) => incidencia.id === 'way/2' && incidencia.etiqueta === 'height',
  );
  assert.ok(rechazo, 'el height rechazado debe aparecer en las incidencias');
  assert.equal(rechazo.valor, '0.5');
});

test('sin height ni plantas se cae a la tabla por uso y se anota la estimacion', () => {
  const edificio = porId(edificios().edificios).get('way/3');

  assert.equal(edificio.uso, UsoEdificio.RELIGIOSO);
  assert.equal(edificio.plantas, null);
  assert.equal(edificio.procedencia.confianza, Confianza.ESTIMADO);
  assert.match(edificio.procedencia.nota, /building=church/);
});

test('una geometria que no cierra poligono no revienta: se reporta', () => {
  const { edificios: resultado, incidencias } = edificios();

  assert.equal(resultado.some((edificio) => edificio.id === 'way/5'), false);
  const incidencia = incidencias.find((registro) => registro.id === 'way/5');
  assert.ok(incidencia, 'la huella invalida debe quedar registrada');
  assert.match(incidencia.motivo, /poligono/i);
});

test('la altura de planta se puede afinar sin tocar el dominio', () => {
  const edificio = porId(edificios({ alturaPlanta: 3.2 }).edificios).get('way/1');

  assert.equal(edificio.alturaMetros, 16);
});

test('un tramo con width declarado conserva anchura, nombre y sentido', () => {
  const tramo = porId(viario().tramos).get('way/20');

  assert.equal(tramo.tipo, TipoVia.RESIDENCIAL);
  assert.equal(tramo.anchuraMetros, 7.5);
  assert.equal(tramo.nombre, 'Rua Real');
  assert.equal(tramo.sentidoUnico, true);
  assert.equal(tramo.procedencia.confianza, Confianza.DECLARADO);
  assert.equal(tramo.eje.length, 2);
  assert.deepEqual(tramo.eje[0], [-8.402, 43.368]);
});

test('sin width la anchura se estima por carriles', () => {
  const tramo = porId(viario().tramos).get('way/21');

  assert.equal(tramo.tipo, TipoVia.PRIMARIA);
  assert.equal(tramo.carriles, 4);
  assert.equal(tramo.anchuraMetros, 12);
  assert.equal(tramo.procedencia.confianza, Confianza.ESTIMADO);
});

test('sin width ni lanes la anchura sale de las tablas de estimacion', () => {
  const tramos = porId(viario().tramos);

  assert.equal(tramos.get('way/22').anchuraMetros, 6);
  assert.equal(tramos.get('way/23').anchuraMetros, ANCHURA_POR_HIGHWAY.footway);
  assert.equal(tramos.get('way/24').anchuraMetros, ANCHURA_POR_HIGHWAY.steps);
});

test('una via cerrada sobre si misma sigue siendo un eje, no una plaza', () => {
  // Una rotonda es un way cerrado sin area=yes. Tratarla como poligono la
  // convertiria en una explanada de asfalto.
  const tramo = porId(viario().tramos).get('way/25');

  assert.ok(tramo, 'la rotonda debe seguir siendo un tramo');
  assert.equal(tramo.eje.length, 5);
  assert.deepEqual(tramo.eje[0], tramo.eje[tramo.eje.length - 1]);
});

test('un highway con area=yes no tiene eje: se reporta en vez de inventarlo', () => {
  const { tramos, incidencias } = viario();

  assert.equal(tramos.some((tramo) => tramo.id === 'way/26'), false);
  const incidencia = incidencias.find((registro) => registro.id === 'way/26');
  assert.ok(incidencia);
  assert.match(incidencia.motivo, /eje/i);
});

test('las peatonales se conservan: hacen falta para la capa de peatones', () => {
  const tramos = porId(viario().tramos);

  assert.equal(tramos.get('way/23').tipo, TipoVia.PEATONAL);
  assert.equal(tramos.get('way/24').tipo, TipoVia.PEATONAL);
  assert.equal(esTipoConducible(tramos.get('way/23').tipo), false);
});

test('el grafo conducible deja fuera aceras, escaleras y vias cerradas al trafico', () => {
  const ids = viario({ soloConducibles: true }).tramos.map((tramo) => tramo.id);

  assert.deepEqual(ids.sort(), ['way/20', 'way/21', 'way/22', 'way/25']);
});

test('obras y paradas se descartan en silencio; un highway desconocido no', () => {
  const { tramos, incidencias } = viario();

  assert.equal(tramos.some((tramo) => tramo.id === 'way/27'), false);
  assert.equal(incidencias.some((registro) => registro.id === 'way/27'), false);

  assert.equal(tramos.some((tramo) => tramo.id === 'way/28'), false);
  const desconocido = incidencias.find((registro) => registro.id === 'way/28');
  assert.ok(desconocido, 'un highway sin traduccion debe salir a la luz');
  assert.match(desconocido.motivo, /highway/);
});

test('una respuesta vacia devuelve listas vacias, no una excepcion', () => {
  const vacia = { version: 0.6, elements: [] };

  assert.deepEqual(transformarEdificios(vacia, { proveedorId: PROVEEDOR }), {
    edificios: [],
    incidencias: [],
  });
  assert.deepEqual(transformarViario(vacia, { proveedorId: PROVEEDOR }), {
    tramos: [],
    incidencias: [],
  });
});

test('sin proveedorId se falla pronto: la procedencia no es opcional', () => {
  assert.throws(() => transformarEdificios(MUESTRA, {}), /proveedorId/);
  assert.throws(() => transformarViario(MUESTRA, {}), /proveedorId/);
});

test('una respuesta que no es Overpass se rechaza con un mensaje util', () => {
  assert.throws(() => transformarEdificios({ cualquier: 'cosa' }, { proveedorId: PROVEEDOR }), /elements/);
});
