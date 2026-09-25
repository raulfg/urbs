import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLOR_AGUA,
  COLOR_TIERRA,
  SIN_DATO_RELIEVE,
  RESGUARDO_PUENTE,
  alturasParaRapier,
  cotasDePuente,
  construirTerrenoDeCelda,
  cotaEnCelda,
} from '../src/terreno.js';

/**
 * Un relieve de juguete: `postes` x `postes` a `paso` metros, con las cotas en
 * METROS que se le pasen (fila 0 = norte), cuantizadas como en el archivo.
 */
function relieveDe(cotasEnMetros, paso = 10) {
  const postes = Math.round(Math.sqrt(cotasEnMetros.length));
  const cotaBase = Math.floor(Math.min(...cotasEnMetros.filter((c) => c !== null)));
  const cotas = Int16Array.from(
    cotasEnMetros.map((c) => (c === null ? SIN_DATO_RELIEVE : Math.round((c - cotaBase) * 10))),
  );
  return { relieve: { cotas, cotaBase, postes, pasoMetros: paso } };
}

// --- Muestreo de la malla

test('en un poste devuelve su cota', () => {
  const { relieve } = relieveDe([10, 20, 30, 40], 10);

  // Malla 2x2 de 10 m: el lado util es 10 m. Fila 0 es la del norte.
  assert.ok(Math.abs(cotaEnCelda(relieve, 0, 10) - 10) < 0.06);
  assert.ok(Math.abs(cotaEnCelda(relieve, 10, 10) - 20) < 0.06);
  assert.ok(Math.abs(cotaEnCelda(relieve, 0, 0) - 30) < 0.06);
  assert.ok(Math.abs(cotaEnCelda(relieve, 10, 0) - 40) < 0.06);
});

test('entre postes interpola', () => {
  const { relieve } = relieveDe([10, 20, 30, 40], 10);

  assert.ok(Math.abs(cotaEnCelda(relieve, 5, 10) - 15) < 0.06);
  assert.ok(Math.abs(cotaEnCelda(relieve, 5, 5) - 25) < 0.06);
});

test('la fila 0 es la del NORTE: el norte alto da la fila baja', () => {
  // Si se invierte, el relieve sale reflejado y plausible, que es lo peor.
  const { relieve } = relieveDe([100, 100, 0, 0], 10);

  assert.ok(cotaEnCelda(relieve, 5, 10) > cotaEnCelda(relieve, 5, 0));
});

test('fuera de la celda no hay cota, y eso NO es cota cero', () => {
  // Devolver cero plantaria un edificio al nivel del mar en mitad de una ladera.
  const { relieve } = relieveDe([10, 20, 30, 40], 10);

  assert.equal(cotaEnCelda(relieve, -1, 5), null);
  assert.equal(cotaEnCelda(relieve, 11, 5), null);
  assert.equal(cotaEnCelda(relieve, 5, -1), null);
  assert.equal(cotaEnCelda(relieve, 5, 11), null);
});

test('sobre un hueco sin dato tampoco hay cota', () => {
  const { relieve } = relieveDe([10, null, 30, 40], 10);

  assert.equal(cotaEnCelda(relieve, 5, 5), null);
});

// --- Construccion de la malla

test('una malla de N postes da (N-1)^2 x 2 triangulos', () => {
  const terreno = construirTerrenoDeCelda(relieveDe(new Array(26 * 26).fill(10)));

  assert.equal(terreno.triangulos, 25 * 25 * 2);
  assert.equal(terreno.posiciones.length / 3, 26 * 26);
});

test('las cotas llegan a la Y de los vertices: el terreno tiene altura de verdad', () => {
  const terreno = construirTerrenoDeCelda(relieveDe([0, 0, 50, 50], 10));
  const alturas = [];
  for (let i = 1; i < terreno.posiciones.length; i += 3) alturas.push(terreno.posiciones[i]);

  assert.ok(Math.max(...alturas) - Math.min(...alturas) > 45);
});

test('el este va a X y el norte a -Z, como en todo lo demas', () => {
  const terreno = construirTerrenoDeCelda(relieveDe([1, 2, 3, 4], 10));

  // Poste (0,0) es el del noroeste: este 0, norte 10 -> z = -10.
  assert.equal(terreno.posiciones[0], 0);
  assert.equal(terreno.posiciones[2], -10);
});

// --- El mar, que sale solo

test('lo que esta por debajo del umbral se pinta de AGUA', () => {
  // Aqui no hay capa de agua ni poligonos de costa: el MDT ya trae el mar y la
  // orilla es donde la cota cruza el umbral.
  const terreno = construirTerrenoDeCelda(relieveDe([0, 0, 40, 40], 10), { umbralAgua: 1.5 });

  assert.deepEqual([...terreno.colores.slice(0, 3)], COLOR_AGUA.map((c) => Math.fround(c)));
  assert.deepEqual([...terreno.colores.slice(6, 9)], COLOR_TIERRA.map((c) => Math.fround(c)));
});

test('el umbral es un parametro: hay hojas donde el mar no cae en cero', () => {
  const alto = construirTerrenoDeCelda(relieveDe([1, 1, 40, 40]), { umbralAgua: 1.5 });
  const bajo = construirTerrenoDeCelda(relieveDe([1, 1, 40, 40]), { umbralAgua: 0 });

  assert.deepEqual([...alto.colores.slice(0, 3)], COLOR_AGUA.map((c) => Math.fround(c)));
  assert.deepEqual([...bajo.colores.slice(0, 3)], COLOR_TIERRA.map((c) => Math.fround(c)));
});

test('un hueco sin dato no abre un pozo: se queda al nivel del umbral', () => {
  const terreno = construirTerrenoDeCelda(relieveDe([null, 10, 20, 30]), { umbralAgua: 1.5 });

  assert.equal(terreno.posiciones[1], Math.fround(1.5));
});

// --- Sin relieve

test('una celda sin relieve no da malla, y no revienta', () => {
  assert.equal(
    construirTerrenoDeCelda({ relieve: { cotas: new Int16Array(0), cotaBase: 0, postes: 0, pasoMetros: 0 } }),
    null,
  );
});

// --- Normales

test('un terreno llano tiene todas las normales apuntando arriba', () => {
  const terreno = construirTerrenoDeCelda(relieveDe(new Array(9).fill(20)));

  for (let i = 0; i < terreno.normales.length; i += 3) {
    assert.ok(Math.abs(terreno.normales[i]) < 1e-6);
    assert.ok(Math.abs(terreno.normales[i + 1] - 1) < 1e-6);
    assert.ok(Math.abs(terreno.normales[i + 2]) < 1e-6);
  }
});

test('una ladera inclina la normal hacia la bajada', () => {
  // Sube hacia el este: la normal tiene que caer hacia el oeste.
  const terreno = construirTerrenoDeCelda(relieveDe([0, 10, 20, 0, 10, 20, 0, 10, 20], 10));
  const centro = (1 * 3 + 1) * 3;

  assert.ok(terreno.normales[centro] < -0.5, 'la normal deberia inclinarse al oeste');
});

// --- Campo de alturas para Rapier

test('el orden de las alturas de Rapier COINCIDE con el de la malla, no se transpone', () => {
  // El punto (i, j) de un heightfield es `alturas[i + j * (filas+1)]`, con `i`
  // en el eje X (el este) y `j` en el Z. Aqui el indice es
  // `fila * postes + columna`, con la fila recorriendo el norte, o sea la Z.
  // Los dos coinciden. Se prueba porque es justo el tipo de coincidencia que
  // alguien "arregla" transponiendo, y entonces se conduce sobre un terreno
  // girado que la pantalla no delata.
  const { relieve } = relieveDe([0, 10, 20, 30], 10);
  const alturas = alturasParaRapier(relieve);

  assert.ok(Math.abs(alturas[0] - 0) < 0.06);
  assert.ok(Math.abs(alturas[1] - 10) < 0.06, 'i=1,j=0 es el poste de mas al este de la fila norte');
  assert.ok(Math.abs(alturas[2] - 20) < 0.06);
  assert.ok(Math.abs(alturas[3] - 30) < 0.06);
});

test('un hueco sin dato entra en el campo de alturas como una cota, no como NaN', () => {
  // Un NaN dentro de un heightfield de Rapier envenena el colisionador entero.
  const { relieve } = relieveDe([null, 10, 20, 30], 10);
  const alturas = alturasParaRapier(relieve, 1.5);

  for (const altura of alturas) assert.ok(Number.isFinite(altura));
  assert.equal(alturas[0], 1.5);
});

// --- Puentes

test('un puente NO sigue el terreno: traza una rampa entre sus extremos', () => {
  // Muestrearlo como una calle lo pegaria al fondo de lo que cruza. En la
  // Avenida Alcalde Alfonso Molina, que es por donde se entra a A Coruna, eso
  // se ve al instante y ademas se conduce por dentro del terraplen.
  const { relieve } = relieveDe([20, 0, 0, 20, 20, 0, 0, 20, 20, 0, 0, 20, 20, 0, 0, 20], 10);
  // Eje que cruza el valle de oeste a este por el medio.
  const eje = Float32Array.from([0, 15, 10, 15, 20, 15, 30, 15]);
  const cotas = cotasDePuente(eje, relieve);

  // En el centro el terreno baja a cero; el tablero NO puede bajar con el.
  const centro = cotas[1];
  const suelo = cotaEnCelda(relieve, eje[2], eje[3]);
  assert.ok(centro > suelo + 1, `el tablero (${centro}) deberia volar sobre el suelo (${suelo})`);
});

test('el tablero deja resguardo sobre TODO lo que cruza, no solo sobre el centro', () => {
  const { relieve } = relieveDe([0, 0, 0, 0, 50, 0, 0, 0, 0], 10);
  const eje = Float32Array.from([0, 10, 10, 10, 20, 10]);
  const cotas = cotasDePuente(eje, relieve);

  for (let i = 0; i < cotas.length; i += 1) {
    const suelo = cotaEnCelda(relieve, eje[i * 2], eje[i * 2 + 1]) ?? 0;
    assert.ok(cotas[i] >= suelo + RESGUARDO_PUENTE - 1e-3, `vertice ${i}: ${cotas[i]} sobre ${suelo}`);
  }
});

test('un puente que sube sigue subiendo: la rampa no se aplana', () => {
  const { relieve } = relieveDe([0, 10, 20, 0, 10, 20, 0, 10, 20], 10);
  const eje = Float32Array.from([0, 10, 10, 10, 20, 10]);
  const cotas = cotasDePuente(eje, relieve);

  assert.ok(cotas[2] > cotas[0], 'el extremo alto tiene que quedar por encima del bajo');
});

test('la rampa reparte por DISTANCIA, no por numero de vertices', () => {
  // Con los vertices apinados en un extremo, repartir por indice torceria el
  // tablero.
  const { relieve } = relieveDe([0, 0, 0, 0, 0, 0, 0, 0, 0], 10);
  const eje = Float32Array.from([0, 10, 1, 10, 2, 10, 20, 10]);
  const cotas = cotasDePuente(eje, relieve);

  // Con el suelo llano la rampa es plana, pero el reparto se ve en que los
  // tres primeros vertices estan casi a la misma cota que el primero.
  assert.ok(Math.abs(cotas[1] - cotas[0]) < 1e-3);
  assert.ok(Math.abs(cotas[2] - cotas[0]) < 1e-3);
});

test('un eje vacio no revienta', () => {
  const { relieve } = relieveDe([0, 0, 0, 0], 10);
  assert.equal(cotasDePuente(new Float32Array(0), relieve).length, 0);
});
