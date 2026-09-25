import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITE_INGLETE,
  PROLONGACION_EXTREMO,
  bordesDeCalzada,
  limpiarEje,
  puntoDeSalida,
} from '../src/calzada.js';

/** Los bordes salen en float32; cualquier comparacion necesita holgura. */
const HOLGURA = 1e-3;

/** @param {Float32Array} bordes @param {number} i */
function punto(bordes, i) {
  return { este: bordes[i * 2], norte: bordes[i * 2 + 1] };
}

/** @param {{este: number, norte: number}} a @param {{este: number, norte: number}} b */
function distancia(a, b) {
  return Math.hypot(a.este - b.este, a.norte - b.norte);
}

/** @param {Float32Array} plano */
function pares(plano) {
  const salida = [];
  for (let i = 0; i < plano.length; i += 2) salida.push([plano[i], plano[i + 1]]);
  return salida;
}

// --- Limpieza del eje

test('los vertices repetidos seguidos se van: un segmento de largo cero no tiene direccion', () => {
  const limpio = limpiarEje([0, 0, 0, 0, 10, 0, 10, 0, 10, 0, 20, 0]);
  assert.deepEqual(pares(limpio), [
    [0, 0],
    [10, 0],
    [20, 0],
  ]);
});

test('un vertice casi repetido tambien se va: la tolerancia es de decimas de milimetro', () => {
  const limpio = limpiarEje([0, 0, 1e-6, 1e-6, 10, 0]);
  assert.equal(limpio.length / 2, 2);
});

test('el vertice de cierre de un eje que vuelve sobre si mismo se conserva', () => {
  // Una rotonda o una manzana cerrada es una polilinea cuyo ultimo vertice
  // coincide con el primero. Tirarlo abriria el anillo.
  const limpio = limpiarEje([0, 0, 10, 0, 10, 10, 0, 0]);
  assert.equal(limpio.length / 2, 4);
});

test('un eje sin dos vertices distintos no da eje ninguno', () => {
  assert.equal(limpiarEje([5, 5, 5, 5, 5, 5]).length / 2, 1);
  assert.equal(limpiarEje([]).length, 0);
});

// --- Calzada recta

test('en una recta los bordes quedan a media anchura a cada lado', () => {
  const { eje, derecha, izquierda } = bordesDeCalzada([0, 100, 200, 100], 10, {
    prolongacion: 0,
  });

  assert.equal(eje.length / 2, 2);
  for (const i of [0, 1]) {
    assert.ok(Math.abs(distancia(punto(derecha, i), punto(eje, i)) - 5) < HOLGURA);
    assert.ok(Math.abs(distancia(punto(izquierda, i), punto(eje, i)) - 5) < HOLGURA);
  }
});

test('la derecha es la derecha de la marcha: yendo al este, el sur', () => {
  const { derecha, izquierda } = bordesDeCalzada([0, 100, 200, 100], 10, { prolongacion: 0 });

  assert.ok(punto(derecha, 0).norte < 100, 'la derecha deberia caer al sur');
  assert.ok(punto(izquierda, 0).norte > 100, 'la izquierda deberia caer al norte');
});

test('el eje es siempre el punto medio de sus dos bordes', () => {
  // Es la invariante que hace que el ingletado no deforme la calzada: el
  // inglete desplaza los dos bordes lo mismo y en sentidos opuestos.
  const { eje, derecha, izquierda } = bordesDeCalzada(
    [0, 0, 50, 0, 50, 50, 120, 80, 120, 200],
    12,
  );

  for (let i = 0; i < eje.length / 2; i += 1) {
    const medio = {
      este: (derecha[i * 2] + izquierda[i * 2]) / 2,
      norte: (derecha[i * 2 + 1] + izquierda[i * 2 + 1]) / 2,
    };
    assert.ok(distancia(medio, punto(eje, i)) < HOLGURA, `el vertice ${i} no esta centrado`);
  }
});

// --- Ingletado

test('un giro de noventa grados alarga el inglete en raiz de dos', () => {
  // La union de dos tramos perpendiculares: para que los bordes exteriores se
  // encuentren en un punto, el vertice hay que desplazarlo mitad / cos(45).
  const { eje, derecha, izquierda } = bordesDeCalzada([0, 0, 100, 0, 100, 100], 10, {
    prolongacion: 0,
  });

  const esperado = 5 * Math.SQRT2;
  assert.ok(Math.abs(distancia(punto(derecha, 1), punto(eje, 1)) - esperado) < HOLGURA);
  assert.ok(Math.abs(distancia(punto(izquierda, 1), punto(eje, 1)) - esperado) < HOLGURA);
});

test('hay un punto por vertice y no dos: por eso no quedan cunas en las uniones', () => {
  // Sin ingletar, cada segmento aportaba sus cuatro esquinas y entre dos
  // segmentos quedaba un hueco. Compartir el vertice es lo que lo cierra.
  const { eje, derecha, izquierda } = bordesDeCalzada([0, 0, 100, 0, 100, 100, 200, 100], 8);

  assert.equal(eje.length / 2, 4);
  assert.equal(derecha.length / 2, 4);
  assert.equal(izquierda.length / 2, 4);
});

test('una horquilla NO dispara el inglete al infinito: se recorta', () => {
  // Un giro de 178 grados llevaria el inglete a mitad / cos(89) ~ 57 veces la
  // semianchura. Este es el recorte que evita la espiga.
  const { eje, derecha, izquierda } = bordesDeCalzada(
    [0, 0, 100, 0, 0, Math.tan((2 * Math.PI) / 180) * 100],
    10,
    { prolongacion: 0 },
  );

  const tope = LIMITE_INGLETE * 5;
  const alargue = distancia(punto(derecha, 1), punto(eje, 1));
  assert.ok(Number.isFinite(alargue));
  assert.ok(alargue <= tope + HOLGURA, `el inglete se fue a ${alargue}, tope ${tope}`);
  assert.ok(distancia(punto(izquierda, 1), punto(eje, 1)) <= tope + HOLGURA);
});

test('un recorte mas corto recorta mas: el limite es un parametro, no un numero magico', () => {
  const eje = [0, 0, 100, 0, 0, 5];
  const flojo = bordesDeCalzada(eje, 10, { limiteInglete: 8, prolongacion: 0 });
  const duro = bordesDeCalzada(eje, 10, { limiteInglete: 1.5, prolongacion: 0 });

  const conFlojo = distancia(punto(flojo.derecha, 1), punto(flojo.eje, 1));
  const conDuro = distancia(punto(duro.derecha, 1), punto(duro.eje, 1));
  assert.ok(conDuro < conFlojo);
  assert.ok(conDuro <= 1.5 * 5 + HOLGURA);
});

test('una inversion exacta de 180 grados no produce NaN: se escuadra el extremo', () => {
  // El eje va y vuelve por la misma linea. La bisectriz de las dos normales es
  // el vector cero y no hay direccion de inglete: hay que detectarlo.
  const { eje, derecha, izquierda } = bordesDeCalzada([0, 0, 100, 0, 0, 0], 10, {
    prolongacion: 0,
  });

  for (const plano of [eje, derecha, izquierda]) {
    for (const valor of plano) {
      assert.ok(Number.isFinite(valor), 'un vertice salio NaN o infinito');
    }
  }
  assert.ok(Math.abs(distancia(punto(derecha, 1), punto(eje, 1)) - 5) < HOLGURA);
});

test('un vertice duplicado en mitad de un giro no rompe el inglete', () => {
  const conBasura = bordesDeCalzada([0, 0, 100, 0, 100, 0, 100, 100], 10, { prolongacion: 0 });
  const limpio = bordesDeCalzada([0, 0, 100, 0, 100, 100], 10, { prolongacion: 0 });

  assert.deepEqual(pares(conBasura.derecha), pares(limpio.derecha));
  assert.deepEqual(pares(conBasura.izquierda), pares(limpio.izquierda));
});

// --- Extremos

test('los extremos se prolongan media anchura: es lo que tapa el corte en un cruce', () => {
  // Tres calles que llegan al mismo nodo son tres polilineas distintas, y sin
  // el grafo no hay inglete que las una. Prolongar cada extremo hace que se
  // solapen sobre el cruce en lugar de dejar el pico descubierto.
  const anchura = 10;
  const sinProlongar = bordesDeCalzada([0, 0, 100, 0], anchura, { prolongacion: 0 });
  const prolongada = bordesDeCalzada([0, 0, 100, 0], anchura);

  assert.ok(
    Math.abs(punto(prolongada.eje, 0).este - (0 - PROLONGACION_EXTREMO * anchura)) < HOLGURA,
  );
  assert.ok(
    Math.abs(punto(prolongada.eje, 1).este - (100 + PROLONGACION_EXTREMO * anchura)) < HOLGURA,
  );
  // Solo se mueven los extremos, y solo a lo largo: el ancho no cambia.
  assert.ok(Math.abs(punto(prolongada.eje, 0).norte - punto(sinProlongar.eje, 0).norte) < HOLGURA);
});

test('la prolongacion mueve el eje y sus dos bordes a la vez', () => {
  const { eje, derecha, izquierda } = bordesDeCalzada([0, 0, 100, 0], 10);

  assert.ok(Math.abs(punto(derecha, 0).este - punto(eje, 0).este) < HOLGURA);
  assert.ok(Math.abs(punto(izquierda, 0).este - punto(eje, 0).este) < HOLGURA);
});

// --- Degenerados

test('un eje de un solo punto no produce calzada, y no revienta', () => {
  const { eje, derecha, izquierda } = bordesDeCalzada([10, 10, 10, 10], 10);

  assert.equal(eje.length, 0);
  assert.equal(derecha.length, 0);
  assert.equal(izquierda.length, 0);
});

test('una anchura que no sea positiva se rechaza en vez de dar una cinta invisible', () => {
  for (const basura of [0, -5, Number.NaN, 'ocho']) {
    assert.throws(() => bordesDeCalzada([0, 0, 10, 0], basura), /anchura/);
  }
});

test('un limite de inglete por debajo de uno se rechaza: encogeria la calzada', () => {
  assert.throws(() => bordesDeCalzada([0, 0, 10, 0], 10, { limiteInglete: 0.5 }), /limiteInglete/);
});

// --- Punto de salida

test('el coche sale sobre el tramo mas largo de la celda, no en el centro', () => {
  // Nacer en el centro geometrico de una celda es nacer dentro de un edificio
  // uno de cada dos intentos. El tramo mas largo es lo mas parecido a "una
  // calle por la que se puede empezar a rodar" que hay en el dato.
  const salida = puntoDeSalida({
    cabecera: { numeroTramos: 2 },
    tramos: {
      inicioVertice: Uint32Array.from([0, 2, 4]),
      vertices: Float32Array.from([10, 10, 20, 10, 0, 100, 0, 200]),
      anchura: Float32Array.from([8, 8]),
    },
  });

  // El segundo tramo mide 100 m y el primero 10: gana el segundo, y el punto
  // es su centro.
  assert.ok(Math.abs(salida.x - 0) < HOLGURA);
  assert.ok(Math.abs(salida.z - -150) < HOLGURA);
});

test('el coche sale mirando a lo largo de la calle, no de traves', () => {
  // Tramo que va al este: el coche tiene que mirar al este.
  const salida = puntoDeSalida({
    cabecera: { numeroTramos: 1 },
    tramos: {
      inicioVertice: Uint32Array.from([0, 2]),
      vertices: Float32Array.from([0, 0, 100, 0]),
      anchura: Float32Array.from([8]),
    },
  });

  // Guinada cero mira al norte (-Z); mirar al este son noventa grados.
  assert.ok(Math.abs(salida.guinada - Math.PI / 2) < HOLGURA);
});

test('una celda sin viario no da punto de salida', () => {
  const salida = puntoDeSalida({
    cabecera: { numeroTramos: 0 },
    tramos: { inicioVertice: Uint32Array.from([0]), vertices: new Float32Array(0), anchura: new Float32Array(0) },
  });

  assert.equal(salida, null);
});

test('entre dos calles, el coche sale en la MAS ANCHA aunque sea mas corta', () => {
  // Aprendido mirando la pantalla: con el tramo mas largo el coche arrancaba
  // en un callejon del casco viejo y se clavaba contra una fachada a los seis
  // metros. Lo que decide si un coche cabe es el ancho.
  const salida = puntoDeSalida({
    cabecera: { numeroTramos: 2 },
    tramos: {
      inicioVertice: Uint32Array.from([0, 2, 4]),
      vertices: Float32Array.from([0, 0, 0, 200, 50, 0, 50, 40]),
      anchura: Float32Array.from([3, 14]),
    },
  });

  assert.equal(salida.anchura, 14);
  assert.ok(Math.abs(salida.x - 50) < HOLGURA);
});

test('un tocon corto no vale de salida por ancho que sea', () => {
  const salida = puntoDeSalida({
    cabecera: { numeroTramos: 2 },
    tramos: {
      inicioVertice: Uint32Array.from([0, 2, 4]),
      vertices: Float32Array.from([0, 0, 0, 5, 50, 0, 50, 90]),
      anchura: Float32Array.from([20, 6]),
    },
  });

  assert.equal(salida.anchura, 6, 'el tramo de 20 m de ancho solo mide 5 m de largo');
});
