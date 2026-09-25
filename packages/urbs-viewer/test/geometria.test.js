import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALTURA_PLANTA_POR_DEFECTO,
  Confianza,
  crearCelda,
  crearProcedencia,
  codificarCelda,
  vistasDeCelda,
} from 'urbs-core';

import {
  ALTURA_POR_DEFECTO,
  ALTURA_VIARIO,
  COLOR_POR_CONFIANZA,
  alturaDeEdificio,
  construirGeometriaDeCelda,
  orientarAnillo,
} from '../src/geometria.js';

const LADO = 250;
const CELDA = crearCelda({ indice: { x: 2188, z: 19202 }, ladoCeldaMetros: LADO });
const DECLARADO = crearProcedencia({ proveedor: 'osm', confianza: Confianza.DECLARADO });
const ESTIMADO = crearProcedencia({ proveedor: 'osm', confianza: Confianza.ESTIMADO });

/** Anillo cuadrado cerrado, en sentido antihorario sobre (este, norte). */
function cuadrado(este, norte, lado) {
  return [
    [este, norte],
    [este + lado, norte],
    [este + lado, norte + lado],
    [este, norte + lado],
    [este, norte],
  ];
}

/**
 * @param {object} contenido
 * @returns {object} Las vistas tipadas, que es lo que consume el constructor
 */
function vistasDe(contenido) {
  return vistasDeCelda(codificarCelda({ celda: CELDA, epsg: 25829, ...contenido }));
}

function edificio(extra = {}) {
  return {
    id: 'way/1',
    anillos: [cuadrado(10, 10, 20)],
    ancla: { este: 20, norte: 20 },
    alturaMetros: 12,
    plantas: 4,
    uso: 'residencial',
    procedencia: DECLARADO,
    ...extra,
  };
}

/** Recorre los triangulos de una geometria construida. */
function* triangulos({ posiciones, normales, indices }) {
  for (let i = 0; i < indices.length; i += 3) {
    const puntos = [0, 1, 2].map((k) => {
      const v = indices[i + k] * 3;
      return [posiciones[v], posiciones[v + 1], posiciones[v + 2]];
    });
    const n = indices[i] * 3;
    yield { puntos, normal: [normales[n], normales[n + 1], normales[n + 2]] };
  }
}

/** Producto vectorial de los lados de un triangulo: la normal de su devanado. */
function normalDeDevanado([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

// --- Altura

test('la altura declarada manda sobre todo lo demas', () => {
  assert.equal(alturaDeEdificio(12, 4), 12);
});

test('sin altura, las plantas la estiman al ritmo del dominio', () => {
  assert.equal(alturaDeEdificio(Number.NaN, 4), 4 * ALTURA_PLANTA_POR_DEFECTO);
});

test('sin altura ni plantas se cae a un valor por defecto, no a cero', () => {
  // Un edificio de altura cero es un poligono invisible: peor que uno inventado.
  assert.equal(alturaDeEdificio(Number.NaN, -1), ALTURA_POR_DEFECTO);
  assert.ok(ALTURA_POR_DEFECTO > 0);
});

// --- Orientacion de anillos

test('un anillo horario se vuelve antihorario; uno antihorario se deja en paz', () => {
  const antihorario = [0, 0, 20, 0, 20, 20, 0, 20];
  assert.deepEqual([...orientarAnillo(Float32Array.from(antihorario), true)], antihorario);

  const horario = [0, 0, 0, 20, 20, 20, 20, 0];
  assert.deepEqual([...orientarAnillo(Float32Array.from(horario), true)], antihorario);
});

test('los huecos se orientan al reves que el exterior: su pared mira al patio', () => {
  const antihorario = [0, 0, 20, 0, 20, 20, 0, 20];
  const horario = [0, 0, 0, 20, 20, 20, 20, 0];
  assert.deepEqual([...orientarAnillo(Float32Array.from(antihorario), false)], horario);
});

// --- Geometria de edificios

test('un edificio produce tejado y cuatro paredes', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));

  // Tejado: 2 triangulos de un cuadrado. Paredes: 4 lados x 2 triangulos.
  assert.equal(geometria.indices.length / 3, 2 + 8);
  assert.equal(geometria.numeroEdificios, 1);
});

test('el tejado esta a la altura del edificio y el suelo a cero', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));
  const alturas = [];
  for (let i = 1; i < geometria.posiciones.length; i += 3) alturas.push(geometria.posiciones[i]);

  assert.equal(Math.min(...alturas), 0);
  assert.equal(Math.max(...alturas), 12);
});

test('el devanado de cada triangulo coincide con su normal: las caras miran afuera', () => {
  // Sin esto, media ciudad se ve del reves con el culling activado y no hay
  // forma de darse cuenta salvo volando dentro de un edificio.
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));

  for (const triangulo of triangulos(geometria)) {
    const devanado = normalDeDevanado(triangulo.puntos);
    const producto =
      devanado[0] * triangulo.normal[0] +
      devanado[1] * triangulo.normal[1] +
      devanado[2] * triangulo.normal[2];
    assert.ok(producto > 0, `un triangulo esta devanado al reves: normal ${triangulo.normal}`);
  }
});

test('las normales del tejado apuntan arriba y las de las paredes son horizontales', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));

  let tejado = 0;
  let pared = 0;
  for (const { normal } of triangulos(geometria)) {
    if (Math.abs(normal[1] - 1) < 1e-6) tejado += 1;
    else if (Math.abs(normal[1]) < 1e-6) pared += 1;
    else assert.fail(`normal inesperada ${normal}`);
  }
  assert.equal(tejado, 2);
  assert.equal(pared, 8);
});

test('todas las normales estan normalizadas', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));
  for (let i = 0; i < geometria.normales.length; i += 3) {
    const largo = Math.hypot(
      geometria.normales[i],
      geometria.normales[i + 1],
      geometria.normales[i + 2],
    );
    assert.ok(Math.abs(largo - 1) < 1e-5, `normal de largo ${largo}`);
  }
});

test('las paredes del exterior miran hacia fuera del edificio', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));
  // Centro del cuadrado [10,30]x[10,30] en coordenadas de escena (x, -z).
  const centro = [20, -20];

  for (const { puntos, normal } of triangulos(geometria)) {
    if (Math.abs(normal[1]) > 1e-6) continue;
    const medio = [0, 2].map((eje) => puntos.reduce((s, p) => s + p[eje], 0) / 3);
    const haciaFuera =
      (medio[0] - centro[0]) * normal[0] + (medio[1] - centro[1]) * normal[2];
    assert.ok(haciaFuera > 0, `una pared mira hacia dentro: normal ${normal}`);
  }
});

test('un patio produce sus propias paredes, y miran hacia el patio', () => {
  const conPatio = edificio({
    anillos: [cuadrado(10, 10, 60), cuadrado(30, 30, 20)],
    ancla: { este: 40, norte: 40 },
  });
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [conPatio] }));

  // 4 paredes exteriores + 4 del patio, x 2 triangulos, + el tejado con hueco.
  assert.ok(geometria.indices.length / 3 > 16);

  const centroPatio = [40, -40];
  const paredesDelPatio = [...triangulos(geometria)].filter(({ puntos, normal }) => {
    if (Math.abs(normal[1]) > 1e-6) return false;
    const medio = [0, 2].map((eje) => puntos.reduce((s, p) => s + p[eje], 0) / 3);
    return Math.abs(medio[0] - centroPatio[0]) <= 10 && Math.abs(medio[1] - centroPatio[1]) <= 10;
  });

  assert.equal(paredesDelPatio.length, 8);
  for (const { puntos, normal } of paredesDelPatio) {
    const medio = [0, 2].map((eje) => puntos.reduce((s, p) => s + p[eje], 0) / 3);
    const haciaElPatio =
      (centroPatio[0] - medio[0]) * normal[0] + (centroPatio[1] - medio[1]) * normal[2];
    assert.ok(haciaElPatio > 0, 'la pared del patio mira hacia la calle');
  }
});

test('el tejado con patio no cubre el patio', () => {
  const conPatio = edificio({
    anillos: [cuadrado(10, 10, 60), cuadrado(30, 30, 20)],
    ancla: { este: 40, norte: 40 },
  });
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [conPatio] }));

  const areaTejado = [...triangulos(geometria)]
    .filter(({ normal }) => Math.abs(normal[1] - 1) < 1e-6)
    .reduce((suma, { puntos }) => {
      const n = normalDeDevanado(puntos);
      return suma + Math.hypot(n[0], n[1], n[2]) / 2;
    }, 0);

  // 60x60 menos el patio de 20x20.
  assert.ok(Math.abs(areaTejado - (3600 - 400)) < 1, `area del tejado: ${areaTejado}`);
});

// --- Color por procedencia

test('el color distingue el dato declarado del estimado', () => {
  const geometria = construirGeometriaDeCelda(
    vistasDe({
      edificios: [
        edificio({ id: 'way/1', procedencia: DECLARADO }),
        edificio({
          id: 'way/2',
          anillos: [cuadrado(100, 100, 20)],
          ancla: { este: 110, norte: 110 },
          procedencia: ESTIMADO,
        }),
      ],
    }),
  );

  const declarado = COLOR_POR_CONFIANZA[Confianza.DECLARADO];
  const estimado = COLOR_POR_CONFIANZA[Confianza.ESTIMADO];
  assert.notDeepEqual(declarado, estimado, 'los dos colores tienen que verse distintos');

  // Comparado con tolerancia: los canales se guardan en float32.
  const contiene = (buscado) => {
    for (let i = 0; i < geometria.colores.length; i += 3) {
      if (buscado.every((canal, k) => Math.abs(geometria.colores[i + k] - canal) < 1e-6)) {
        return true;
      }
    }
    return false;
  };
  assert.ok(contiene(declarado), 'no hay ningun vertice con el color de lo declarado');
  assert.ok(contiene(estimado), 'no hay ningun vertice con el color de lo estimado');
});

test('una confianza que no este en la tabla no deja la celda sin color', () => {
  const geometria = construirGeometriaDeCelda(
    vistasDe({
      edificios: [
        edificio({ procedencia: { proveedor: 'x', confianza: 'inventada', nota: null } }),
      ],
    }),
  );
  for (const canal of geometria.colores) {
    assert.ok(Number.isFinite(canal) && canal >= 0 && canal <= 1);
  }
});

// --- Viario

test('un tramo produce una cinta plana a ras de suelo', () => {
  const geometria = construirGeometriaDeCelda(
    vistasDe({
      edificios: [],
      tramos: [
        {
          id: 'way/9',
          eje: [
            [0, 100],
            [200, 100],
          ],
          ancla: { este: 100, norte: 100 },
          tipo: 'secundaria',
          anchuraMetros: 10,
          carriles: 2,
          sentidoUnico: false,
          nombre: null,
          procedencia: DECLARADO,
        },
      ],
    }),
  );

  assert.equal(geometria.numeroTramos, 1);
  assert.equal(geometria.indices.length / 3, 2, 'un segmento es un cuadrilatero');

  for (let i = 1; i < geometria.posiciones.length; i += 3) {
    // Comparado con tolerancia: 0,05 no es representable en float32.
    assert.ok(Math.abs(geometria.posiciones[i] - ALTURA_VIARIO) < 1e-6);
  }
  // La cinta ocupa el ancho declarado: de norte 95 a 105, o sea z de -95 a -105.
  const zetas = [];
  for (let i = 2; i < geometria.posiciones.length; i += 3) zetas.push(geometria.posiciones[i]);
  assert.ok(Math.abs(Math.max(...zetas) - -95) < 1e-4);
  assert.ok(Math.abs(Math.min(...zetas) - -105) < 1e-4);
});

// --- Celda vacia y forma de salida

test('una celda sin nada produce arrays vacios, no un error', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [], tramos: [] }));

  assert.equal(geometria.posiciones.length, 0);
  assert.equal(geometria.indices.length, 0);
  assert.equal(geometria.numeroEdificios, 0);
});

test('la salida son arrays tipados listos para la GPU, no listas de objetos', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));

  assert.ok(geometria.posiciones instanceof Float32Array);
  assert.ok(geometria.normales instanceof Float32Array);
  assert.ok(geometria.colores instanceof Float32Array);
  assert.ok(geometria.indices instanceof Uint32Array);
  assert.equal(geometria.posiciones.length, geometria.normales.length);
  assert.equal(geometria.posiciones.length, geometria.colores.length);
});

test('ningun indice apunta fuera del buffer de posiciones', () => {
  const geometria = construirGeometriaDeCelda(
    vistasDe({
      edificios: [
        edificio(),
        edificio({
          id: 'way/2',
          anillos: [cuadrado(100, 100, 60), cuadrado(120, 120, 20)],
          ancla: { este: 130, norte: 130 },
        }),
      ],
    }),
  );
  const vertices = geometria.posiciones.length / 3;
  for (const indice of geometria.indices) {
    assert.ok(indice >= 0 && indice < vertices, `indice ${indice} fuera de ${vertices}`);
  }
});

test('las coordenadas siguen siendo locales: la celda se coloca con su posicion, no con sus vertices', () => {
  const geometria = construirGeometriaDeCelda(vistasDe({ edificios: [edificio()] }));

  for (let i = 0; i < geometria.posiciones.length; i += 3) {
    assert.ok(Math.abs(geometria.posiciones[i]) < 2000, 'un vertice lleva UTM absoluto');
    assert.ok(Math.abs(geometria.posiciones[i + 2]) < 2000);
  }
});
