import test from 'node:test';
import assert from 'node:assert/strict';

import { crearOrigenFlotante } from '../src/origen-flotante.js';
import { crearRebase, desplazar } from '../src/rebase.js';

const ANCLA = Object.freeze({ este: 547000, norte: 4800500 });

/** Un sujeto de mentira que apunta los deltas que recibe y cuando. */
function testigo(nombre, diario) {
  return {
    nombre,
    rebasar(delta) {
      diario.push({ nombre, delta: { ...delta } });
    },
  };
}

// --- Desplazar una traslacion

test('desplazar RESTA el delta: la escena se mueve al reves que el ancla', () => {
  assert.deepEqual(desplazar({ x: 100, y: 5, z: -200 }, { x: 30, z: -50 }), {
    x: 70,
    y: 5,
    z: -150,
  });
});

test('desplazar no toca la altura: el origen flotante solo se mueve en el plano', () => {
  const movido = desplazar({ x: 0, y: 12.5, z: 0 }, { x: 1000, z: 1000 });
  assert.equal(movido.y, 12.5);
});

// --- El coordinador

test('sin pasarse del umbral no se mueve NADA: ni escena ni fisicas', () => {
  const diario = [];
  const rebase = crearRebase({
    origen: crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 }),
    sujetos: [testigo('escena', diario), testigo('fisicas', diario)],
  });

  const resultado = rebase.aplicar({ x: 300, z: -400 });

  assert.equal(resultado.rebasado, false);
  assert.deepEqual(diario, []);
});

test('al rebasar, TODOS los sujetos reciben el MISMO delta en la MISMA llamada', () => {
  // Esta es la regla 3 de la decision 0001 convertida en prueba. Mover el
  // grafo de escena y no el mundo de Rapier teletransporta al jugador a traves
  // del suelo, y el sintoma no se parece en nada a la causa.
  const diario = [];
  const rebase = crearRebase({
    origen: crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 }),
    sujetos: [testigo('escena', diario), testigo('fisicas', diario), testigo('coche', diario)],
  });

  const resultado = rebase.aplicar({ x: 1200, z: -900 });

  assert.equal(resultado.rebasado, true);
  assert.deepEqual(resultado.delta, { x: 1200, z: -900 });
  assert.deepEqual(diario, [
    { nombre: 'escena', delta: { x: 1200, z: -900 } },
    { nombre: 'fisicas', delta: { x: 1200, z: -900 } },
    { nombre: 'coche', delta: { x: 1200, z: -900 } },
  ]);
});

test('si un sujeto no puede rebasar, el fallo SUBE en vez de tragarse', () => {
  // Un sujeto que revienta deja el mundo a medio mover, y eso no tiene arreglo
  // desde aqui: el ancla ya se ha mudado. Lo unico util es que se note en el
  // acto, en el fotograma en que pasa, y no tres kilometros despues cuando el
  // coche aparezca dentro de un edificio.
  const origen = crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 });
  const rebase = crearRebase({
    origen,
    sujetos: [
      {
        rebasar() {
          throw new Error('el mundo de fisicas no responde');
        },
      },
    ],
  });

  assert.throws(() => rebase.aplicar({ x: 1200, z: 0 }), /fisicas no responde/);
});

test('un sujeto sin `rebasar` se rechaza al crear, no en mitad de un rebase', () => {
  // Descubrir esto en el fotograma 40.000, a un kilometro del origen y a
  // ochenta por hora, no es forma de enterarse.
  for (const basura of [null, {}, { rebasar: 'si' }]) {
    assert.throws(
      () => crearRebase({ origen: crearOrigenFlotante({ ancla: ANCLA }), sujetos: [basura] }),
      /rebasar/,
    );
  }
});

test('sin sujetos no hay rebase que valga: seria mover el ancla y dejar la ciudad quieta', () => {
  assert.throws(
    () => crearRebase({ origen: crearOrigenFlotante({ ancla: ANCLA }), sujetos: [] }),
    /sujetos/,
  );
});

test('apuntarse tarde tambien vale: el coche nace despues que la escena', () => {
  const diario = [];
  const rebase = crearRebase({
    origen: crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 1000 }),
    sujetos: [testigo('escena', diario)],
  });

  rebase.apuntar(testigo('coche', diario));
  rebase.aplicar({ x: 1200, z: 0 });

  assert.deepEqual(
    diario.map((entrada) => entrada.nombre),
    ['escena', 'coche'],
  );
});

test('rebasar muchas veces deja el mundo donde estaba: escena y ancla se compensan', () => {
  // El coche da vueltas: su posicion absoluta tiene que ser la misma al final
  // que al principio, por muchos rebases que hayan pasado por el medio.
  const origen = crearOrigenFlotante({ ancla: ANCLA, umbralMetros: 500 });
  const coche = { x: 0, y: 1, z: 0 };
  const rebase = crearRebase({
    origen,
    sujetos: [
      {
        rebasar(delta) {
          Object.assign(coche, desplazar(coche, delta));
        },
      },
    ],
  });

  const salida = origen.aProyectado(coche);

  for (let i = 0; i < 200; i += 1) {
    coche.x += 60;
    coche.z -= 40;
    rebase.aplicar(coche);
  }

  const vueltaAtras = origen.aProyectado(coche);
  assert.ok(Math.abs(vueltaAtras.este - (salida.este + 200 * 60)) < 1e-6);
  assert.ok(Math.abs(vueltaAtras.norte - (salida.norte + 200 * 40)) < 1e-6);
  assert.ok(rebase.rebases > 0, 'con 200 pasos de 72 m y umbral 500 tiene que haber rebasado');
  // Y la posicion en ESCENA se ha quedado corta, que es todo el objetivo.
  assert.ok(Math.hypot(coche.x, coche.z) <= 500 + 1e-6);
});
