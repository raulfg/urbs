import test from 'node:test';
import assert from 'node:assert/strict';

import { Confianza, TipoVia, UsoEdificio, ALTURA_PLANTA_POR_DEFECTO } from 'urbs-core';

import {
  parsearNumero,
  parsearEntero,
  tipoDeVia,
  esConducible,
  esTipoConducible,
  esHighwayIgnorado,
  usoDeEdificio,
  derivarAltura,
  resolverAnchuraOsm,
  ALTURA_MINIMA_PLAUSIBLE,
  ALTURA_MAXIMA_PLAUSIBLE,
  PLANTAS_MAXIMAS,
  ALTURA_POR_EDIFICIO,
  ANCHURA_POR_HIGHWAY,
} from '../src/osm/etiquetas.js';

test('parsearNumero acepta las formas que OSM escribe de verdad', () => {
  assert.equal(parsearNumero('12'), 12);
  assert.equal(parsearNumero('12.5'), 12.5);
  assert.equal(parsearNumero('12,5'), 12.5);
  assert.equal(parsearNumero('12 m'), 12);
  assert.equal(parsearNumero('12m'), 12);
  assert.equal(parsearNumero(' 12 '), 12);
  assert.equal(parsearNumero(7), 7);
  // Valor multiple: OSM permite "2;3". Nos quedamos con el primero.
  assert.equal(parsearNumero('2;3'), 2);
});

test('parsearNumero rechaza basura en vez de inventarse un cero', () => {
  assert.equal(parsearNumero(undefined), null);
  assert.equal(parsearNumero(null), null);
  assert.equal(parsearNumero(''), null);
  assert.equal(parsearNumero('alto'), null);
  assert.equal(parsearNumero('~4'), null);
  // Pies: no convertimos, lo declaramos ilegible.
  assert.equal(parsearNumero("10'"), null);
  assert.equal(parsearNumero('10 ft'), null);
  assert.equal(parsearNumero(Number.NaN), null);
});

test('parsearEntero solo deja pasar enteros', () => {
  assert.equal(parsearEntero('3'), 3);
  assert.equal(parsearEntero('3.5'), null);
  assert.equal(parsearEntero('x'), null);
});

test('tipoDeVia traduce el esquema highway de OSM al dominio', () => {
  assert.equal(tipoDeVia({ highway: 'motorway' }), TipoVia.AUTOPISTA);
  assert.equal(tipoDeVia({ highway: 'trunk_link' }), TipoVia.AUTOPISTA);
  assert.equal(tipoDeVia({ highway: 'primary' }), TipoVia.PRIMARIA);
  assert.equal(tipoDeVia({ highway: 'secondary_link' }), TipoVia.SECUNDARIA);
  assert.equal(tipoDeVia({ highway: 'tertiary' }), TipoVia.LOCAL);
  assert.equal(tipoDeVia({ highway: 'unclassified' }), TipoVia.LOCAL);
  assert.equal(tipoDeVia({ highway: 'residential' }), TipoVia.RESIDENCIAL);
  assert.equal(tipoDeVia({ highway: 'living_street' }), TipoVia.RESIDENCIAL);
  assert.equal(tipoDeVia({ highway: 'service' }), TipoVia.SERVICIO);
  assert.equal(tipoDeVia({ highway: 'footway' }), TipoVia.PEATONAL);
  assert.equal(tipoDeVia({ highway: 'steps' }), TipoVia.PEATONAL);
  assert.equal(tipoDeVia({ highway: 'pedestrian' }), TipoVia.PEATONAL);
});

test('tipoDeVia devuelve null ante un highway que no conocemos', () => {
  assert.equal(tipoDeVia({ highway: 'inventado' }), null);
  assert.equal(tipoDeVia({}), null);
});

test('esHighwayIgnorado distingue lo desconocido de lo que no es una via', () => {
  // Obras y propuestas: no son via todavia, no son una sorpresa.
  assert.equal(esHighwayIgnorado({ highway: 'construction' }), true);
  assert.equal(esHighwayIgnorado({ highway: 'proposed' }), true);
  assert.equal(esHighwayIgnorado({ highway: 'bus_stop' }), true);
  // Desconocido de verdad: debe salir a la luz como incidencia.
  assert.equal(esHighwayIgnorado({ highway: 'inventado' }), false);
});

test('el grafo conducible deja fuera aceras, escaleras y plazas', () => {
  assert.equal(esConducible({ highway: 'residential' }), true);
  assert.equal(esConducible({ highway: 'service' }), true);
  assert.equal(esConducible({ highway: 'motorway_link' }), true);
  assert.equal(esConducible({ highway: 'living_street' }), true);

  assert.equal(esConducible({ highway: 'footway' }), false);
  assert.equal(esConducible({ highway: 'steps' }), false);
  assert.equal(esConducible({ highway: 'pedestrian' }), false);
  assert.equal(esConducible({ highway: 'cycleway' }), false);
  assert.equal(esConducible({ highway: 'path' }), false);
});

test('una via cerrada al trafico no es conducible aunque su clase lo sea', () => {
  assert.equal(esConducible({ highway: 'residential', access: 'no' }), false);
  assert.equal(esConducible({ highway: 'service', motor_vehicle: 'no' }), false);
  // `private` sigue siendo asfalto transitable: no lo tiramos.
  assert.equal(esConducible({ highway: 'service', access: 'private' }), true);
});

test('esTipoConducible permite filtrar aguas abajo con solo el tipo de dominio', () => {
  assert.equal(esTipoConducible(TipoVia.RESIDENCIAL), true);
  assert.equal(esTipoConducible(TipoVia.SERVICIO), true);
  assert.equal(esTipoConducible(TipoVia.PEATONAL), false);
});

test('usoDeEdificio traduce el valor de building', () => {
  assert.equal(usoDeEdificio({ building: 'apartments' }), UsoEdificio.RESIDENCIAL);
  assert.equal(usoDeEdificio({ building: 'house' }), UsoEdificio.RESIDENCIAL);
  assert.equal(usoDeEdificio({ building: 'retail' }), UsoEdificio.COMERCIAL);
  assert.equal(usoDeEdificio({ building: 'industrial' }), UsoEdificio.INDUSTRIAL);
  assert.equal(usoDeEdificio({ building: 'school' }), UsoEdificio.EQUIPAMIENTO);
  assert.equal(usoDeEdificio({ building: 'church' }), UsoEdificio.RELIGIOSO);
  assert.equal(usoDeEdificio({ building: 'garage' }), UsoEdificio.APARCAMIENTO);
  assert.equal(usoDeEdificio({ building: 'yes' }), UsoEdificio.DESCONOCIDO);
});

test('con building=yes se mira la actividad antes de rendirse', () => {
  assert.equal(usoDeEdificio({ building: 'yes', shop: 'bakery' }), UsoEdificio.COMERCIAL);
  assert.equal(usoDeEdificio({ building: 'yes', office: 'lawyer' }), UsoEdificio.COMERCIAL);
  assert.equal(
    usoDeEdificio({ building: 'yes', amenity: 'place_of_worship' }),
    UsoEdificio.RELIGIOSO,
  );
  assert.equal(usoDeEdificio({ building: 'yes', amenity: 'hospital' }), UsoEdificio.EQUIPAMIENTO);
  // Un valor de building explicito manda sobre la actividad.
  assert.equal(usoDeEdificio({ building: 'church', shop: 'gift' }), UsoEdificio.RELIGIOSO);
});

test('height etiquetado y sano se toma tal cual, como declarado', () => {
  const resultado = derivarAltura({ building: 'yes', height: '18.5' });

  assert.equal(resultado.alturaMetros, 18.5);
  assert.equal(resultado.confianza, Confianza.DECLARADO);
  assert.deepEqual(resultado.rechazos, []);
});

test('height absurdamente bajo se rechaza y se cae a las plantas', () => {
  // "0.5" existe de verdad en el bbox de Ciudad Vieja.
  const resultado = derivarAltura({ building: 'yes', height: '0.5', 'building:levels': '4' });

  assert.equal(resultado.alturaMetros, 4 * ALTURA_PLANTA_POR_DEFECTO);
  assert.equal(resultado.plantas, 4);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
  assert.equal(resultado.rechazos.length, 1);
  assert.equal(resultado.rechazos[0].etiqueta, 'height');
  assert.equal(resultado.rechazos[0].valor, '0.5');
  assert.match(resultado.rechazos[0].motivo, new RegExp(String(ALTURA_MINIMA_PLAUSIBLE)));
});

test('height ilegible se rechaza sin romper la derivacion', () => {
  const resultado = derivarAltura({ building: 'yes', height: 'alto' });

  assert.equal(resultado.confianza, Confianza.ESTIMADO);
  assert.equal(resultado.rechazos.length, 1);
  assert.match(resultado.rechazos[0].motivo, /numero/);
});

test('height por encima del techo plausible se rechaza', () => {
  const resultado = derivarAltura({
    building: 'yes',
    height: String(ALTURA_MAXIMA_PLAUSIBLE + 1),
  });

  assert.equal(resultado.confianza, Confianza.ESTIMADO);
  assert.equal(resultado.rechazos.length, 1);
});

test('un rascacielos real sigue pasando el filtro', () => {
  // "119" tambien esta en los datos reales y es plausible: no lo tiramos.
  const resultado = derivarAltura({ building: 'yes', height: '119' });

  assert.equal(resultado.alturaMetros, 119);
  assert.equal(resultado.confianza, Confianza.DECLARADO);
});

test('sin height se estima por plantas y se anota como estimado', () => {
  const resultado = derivarAltura({ building: 'apartments', 'building:levels': '5' });

  assert.equal(resultado.alturaMetros, 5 * ALTURA_PLANTA_POR_DEFECTO);
  assert.equal(resultado.plantas, 5);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
  assert.match(resultado.nota, /plantas/);
});

test('plantas no enteras estiman altura pero no se inventan un numero de plantas', () => {
  const resultado = derivarAltura({ building: 'yes', 'building:levels': '4.5' });

  assert.equal(resultado.alturaMetros, 4.5 * ALTURA_PLANTA_POR_DEFECTO);
  assert.equal(resultado.plantas, null);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
});

test('plantas absurdas se rechazan y se cae a la tabla por tipo', () => {
  const resultado = derivarAltura({
    building: 'house',
    'building:levels': String(PLANTAS_MAXIMAS + 1),
  });

  assert.equal(resultado.alturaMetros, ALTURA_POR_EDIFICIO.house);
  assert.equal(resultado.plantas, null);
  assert.equal(resultado.rechazos.length, 1);
  assert.equal(resultado.rechazos[0].etiqueta, 'building:levels');
});

test('plantas a cero no es una planta baja: es un dato roto', () => {
  const resultado = derivarAltura({ building: 'house', 'building:levels': '0' });

  assert.equal(resultado.plantas, null);
  assert.equal(resultado.alturaMetros, ALTURA_POR_EDIFICIO.house);
  assert.equal(resultado.rechazos.length, 1);
});

test('sin height ni plantas se cae a la tabla por valor de building', () => {
  const resultado = derivarAltura({ building: 'church' });

  assert.equal(resultado.alturaMetros, ALTURA_POR_EDIFICIO.church);
  assert.equal(resultado.plantas, null);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
  assert.match(resultado.nota, /building=church/);
});

test('un building que no esta en la tabla usa el valor por defecto', () => {
  const resultado = derivarAltura({ building: 'inventado' });

  assert.ok(resultado.alturaMetros > 0);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
});

test('la altura de planta es inyectable, no una constante escondida', () => {
  const resultado = derivarAltura({ building: 'yes', 'building:levels': '3' }, { alturaPlanta: 3.2 });

  assert.equal(resultado.alturaMetros, 9.6);
});

test('la anchura declarada gana y se marca como declarada', () => {
  const resultado = resolverAnchuraOsm({
    etiquetas: { highway: 'residential', width: '7.5' },
    tipo: TipoVia.RESIDENCIAL,
  });

  assert.equal(resultado.anchuraMetros, 7.5);
  assert.equal(resultado.confianza, Confianza.DECLARADO);
});

test('sin width se estima por carriles', () => {
  const resultado = resolverAnchuraOsm({
    etiquetas: { highway: 'primary', lanes: '4' },
    tipo: TipoVia.PRIMARIA,
  });

  assert.equal(resultado.anchuraMetros, 12);
  assert.equal(resultado.carriles, 4);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
});

test('sin width ni lanes manda la tabla fina por highway, no la gruesa por tipo', () => {
  // footway y pedestrian caen los dos en TipoVia.PEATONAL, pero una acera y una
  // plaza peatonal no miden lo mismo. Ese matiz es conocimiento de OSM.
  const acera = resolverAnchuraOsm({ etiquetas: { highway: 'footway' }, tipo: TipoVia.PEATONAL });
  const plaza = resolverAnchuraOsm({
    etiquetas: { highway: 'pedestrian' },
    tipo: TipoVia.PEATONAL,
  });

  assert.equal(acera.anchuraMetros, ANCHURA_POR_HIGHWAY.footway);
  assert.equal(plaza.anchuraMetros, ANCHURA_POR_HIGHWAY.pedestrian);
  assert.notEqual(acera.anchuraMetros, plaza.anchuraMetros);
  assert.equal(acera.confianza, Confianza.ESTIMADO);
  assert.match(acera.nota, /highway=footway/);
});

test('un highway sin entrada en la tabla fina cae en la del dominio', () => {
  const resultado = resolverAnchuraOsm({
    etiquetas: { highway: 'primary' },
    tipo: TipoVia.PRIMARIA,
  });

  assert.equal(resultado.anchuraMetros, 12);
  assert.equal(resultado.confianza, Confianza.ESTIMADO);
});

test('un width ilegible no se cuela: se rechaza y se estima', () => {
  const resultado = resolverAnchuraOsm({
    etiquetas: { highway: 'residential', width: 'ancha' },
    tipo: TipoVia.RESIDENCIAL,
  });

  assert.equal(resultado.confianza, Confianza.ESTIMADO);
  assert.equal(resultado.rechazos.length, 1);
  assert.equal(resultado.rechazos[0].etiqueta, 'width');
});
