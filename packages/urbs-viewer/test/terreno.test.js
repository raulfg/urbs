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

test('el color lo decide la BANDERA de la celda, no la cota', () => {
  // Estar por debajo de la cota del agua NO basta para ser agua: hay
  // trincheras, diques secos y rampas de aparcamiento por debajo. Medido sobre
  // la hoja real de A Coruna, 46.690 pixeles —dieciocho hectareas y media—
  // estan bajo el umbral y no tienen salida al mar. La decision la toma el
  // preprocesado con el territorio entero delante, y aqui solo se lee.
  const conAgua = construirTerrenoDeCelda({
    ...relieveDe([0, 0, 40, 40]),
    relieve: { ...relieveDe([0, 0, 40, 40]).relieve, agua: Uint8Array.from([0b0011]) },
  });

  assert.deepEqual([...conAgua.colores.slice(0, 3)], COLOR_AGUA.map((c) => Math.fround(c)));
  assert.deepEqual([...conAgua.colores.slice(6, 9)], COLOR_TIERRA.map((c) => Math.fround(c)));
});

test('un poste a cota NEGATIVA puede ser TIERRA si la bandera lo dice', () => {
  // Es justo el caso que motiva la bandera: un dique seco esta bajo el nivel
  // del mar y esta seco.
  const base = relieveDe([-3, -3, 40, 40]);
  const terreno = construirTerrenoDeCelda({
    ...base,
    relieve: { ...base.relieve, agua: Uint8Array.from([0]) },
  });

  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(
      [...terreno.colores.slice(i * 3, i * 3 + 3)],
      COLOR_TIERRA.map((c) => Math.fround(c)),
      `poste ${i}`,
    );
  }
});

test('sin bandera no se pinta agua: el fallo seguro es quedarse seco', () => {
  // "Falta agua" se ve al instante; "sobra agua" inunda calles sin avisar.
  const terreno = construirTerrenoDeCelda(relieveDe([0, 0, 0, 0]));

  assert.deepEqual([...terreno.colores.slice(0, 3)], COLOR_TIERRA.map((c) => Math.fround(c)));
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

test('las alturas de Rapier van TRANSPUESTAS respecto a la malla', () => {
  // Esto esta MEDIDO contra el mundo de Rapier, no razonado. La version
  // anterior de esta prueba afirmaba lo contrario —que los dos ordenes
  // coincidian— con un comentario muy convencido, y el coche conducia sobre un
  // terreno reflejado respecto al que se dibujaba. La pantalla no lo delataba
  // porque un relieve transpuesto sigue pareciendo un relieve; se vio lanzando
  // rayos y comparando esquinas:
  //
  //   local (20,20)   dibujado 37,9  fisico 51,6
  //   local (230,230) dibujado 51,6  fisico 37,9   <- intercambiados
  //
  // En la malla el indice es `fila * postes + columna`; en el campo de alturas
  // el primer indice recorre la Z.
  const { relieve } = relieveDe([0, 10, 20, 30], 10);
  const alturas = alturasParaRapier(relieve);

  // Malla: fila0 = [0, 10], fila1 = [20, 30].
  // Transpuesta: [0, 20, 10, 30].
  assert.ok(Math.abs(alturas[0] - 0) < 0.06);
  assert.ok(Math.abs(alturas[1] - 20) < 0.06, 'el segundo es el de la fila de ABAJO, no el de al lado');
  assert.ok(Math.abs(alturas[2] - 10) < 0.06);
  assert.ok(Math.abs(alturas[3] - 30) < 0.06);
});

test('transponer dos veces devuelve la malla original', () => {
  // Guarda barata contra volver a equivocarse de sentido.
  const { relieve } = relieveDe([1, 2, 3, 4, 5, 6, 7, 8, 9], 10);
  const una = alturasParaRapier(relieve);
  const postes = relieve.postes;
  const dos = new Float32Array(una.length);
  for (let f = 0; f < postes; f += 1) {
    for (let c = 0; c < postes; c += 1) dos[c * postes + f] = una[f * postes + c];
  }

  for (let i = 0; i < dos.length; i += 1) {
    assert.ok(Math.abs(dos[i] - (relieve.cotaBase + relieve.cotas[i] / 10)) < 0.06, `poste ${i}`);
  }
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

// --- Tierra y agua tienen que distinguirse por COLOR, no por brillo

test('la tierra es calida y el agua fria: no se distinguen solo por el brillo', () => {
  // La luz de ambiente tiene el cielo muy azul, asi que una tierra gris neutra
  // sale AZUL al multiplicarla. Con agua tambien azul, lo unico que quedaba
  // para distinguirlas era el brillo — y a ras de calle, con niebla, eso no
  // basta: el suelo parecia agua y se conducia sin saber por donde.
  const calidez = (c) => c[0] - c[2];

  assert.ok(calidez(COLOR_TIERRA) > 0.1, 'la tierra tiene que tirar a calida');
  assert.ok(calidez(COLOR_AGUA) < -0.2, 'el agua tiene que tirar a fria');
});

test('la diferencia entre tierra y agua no es solo de brillo', () => {
  const brillo = (c) => (c[0] + c[1] + c[2]) / 3;
  const distanciaDeTono = Math.hypot(
    COLOR_TIERRA[0] - COLOR_AGUA[0] - (brillo(COLOR_TIERRA) - brillo(COLOR_AGUA)),
    COLOR_TIERRA[2] - COLOR_AGUA[2] - (brillo(COLOR_TIERRA) - brillo(COLOR_AGUA)),
  );

  assert.ok(distanciaDeTono > 0.2, 'quitando el brillo todavia tienen que diferenciarse');
});
