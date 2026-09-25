import test from 'node:test';
import assert from 'node:assert/strict';

import { mascaraDeAguaDeTerritorio } from '../src/agua-territorio.js';

const LIMITES = Object.freeze({ esteMin: 0, esteMax: 40, norteMin: 0, norteMax: 40 });

/**
 * Fuente de mentira: decide la cota con una funcion sobre (este, norte).
 */
function fuenteDe(cota) {
  return { async malla() { return { cota: (e, n) => cota(e, n) }; } };
}

test('el mar entra desde el borde y se propaga tierra adentro', async () => {
  // Agua en toda la mitad oeste.
  const mascara = await mascaraDeAguaDeTerritorio({
    fuente: fuenteDe((este) => (este < 20 ? 0 : 30)),
    limites: LIMITES,
    paso: 10,
    umbral: 1.5,
  });

  assert.equal(mascara.esAgua(0, 20), true);
  assert.equal(mascara.esAgua(10, 20), true);
  assert.equal(mascara.esAgua(30, 20), false);
});

test('un socavon interior bajo la cota del agua NO es agua', async () => {
  // ESTE es el caso que motiva todo el modulo. Hay tierra por debajo de la cota
  // del mar por motivos que no tienen que ver con el mar: una trinchera de
  // carretera, un dique seco, una rampa de aparcamiento. Medido sobre la hoja
  // real de A Coruna son 46.690 pixeles, dieciocho hectareas y media.
  const mascara = await mascaraDeAguaDeTerritorio({
    fuente: fuenteDe((este, norte) => (este === 20 && norte === 20 ? -3 : 30)),
    limites: LIMITES,
    paso: 10,
    umbral: 1.5,
  });

  assert.equal(mascara.esAgua(20, 20), false, 'el socavon esta a -3 m y aun asi es TIERRA');
  assert.equal(mascara.postesDeAgua, 0);
});

test('una ria que entra por el borde SI llega hasta el fondo', async () => {
  // Y este es el motivo de que no se pueda decidir por celda: el borde de una
  // celda de 250 m no es el borde del mundo, asi que una ria quedaria cortada
  // en la primera celda y el resto pasaria por depresion interior.
  const mascara = await mascaraDeAguaDeTerritorio({
    fuente: fuenteDe((este, norte) => (norte === 20 ? 0 : 30)),
    limites: LIMITES,
    paso: 10,
    umbral: 1.5,
  });

  assert.equal(mascara.esAgua(0, 20), true, 'la boca');
  assert.equal(mascara.esAgua(40, 20), true, 'el fondo, cuatro postes tierra adentro');
  assert.equal(mascara.esAgua(20, 30), false, 'la orilla no');
});

test('un hueco sin dato no es agua ni deja pasar el agua', async () => {
  const mascara = await mascaraDeAguaDeTerritorio({
    fuente: fuenteDe((este) => (este === 20 ? null : 0)),
    limites: LIMITES,
    paso: 10,
    umbral: 1.5,
  });

  assert.equal(mascara.esAgua(20, 20), false);
  assert.equal(mascara.esAgua(0, 20), true, 'a un lado si hay mar');
  assert.equal(mascara.esAgua(40, 20), true, 'y al otro tambien, por arriba y por abajo');
});

test('fuera del territorio no se inventa mar', async () => {
  // Devolver agua fuera meteria oceano dentro de la ultima fila de celdas.
  const mascara = await mascaraDeAguaDeTerritorio({
    fuente: fuenteDe(() => 0),
    limites: LIMITES,
    paso: 10,
    umbral: 1.5,
  });

  assert.equal(mascara.esAgua(-100, 20), false);
  assert.equal(mascara.esAgua(20, 9999), false);
});

test('sin fuente que cubra el territorio no hay mascara, y eso no es "todo tierra"', async () => {
  const mascara = await mascaraDeAguaDeTerritorio({
    fuente: { async malla() { return null; } },
    limites: LIMITES,
    paso: 10,
    umbral: 1.5,
  });

  assert.equal(mascara, null);
});

test('un paso o un umbral que no sean numeros se rechazan', async () => {
  const fuente = fuenteDe(() => 0);
  await assert.rejects(
    () => mascaraDeAguaDeTerritorio({ fuente, limites: LIMITES, paso: 0, umbral: 1.5 }),
    /paso/,
  );
  await assert.rejects(
    () => mascaraDeAguaDeTerritorio({ fuente, limites: LIMITES, paso: 10, umbral: Number.NaN }),
    /umbral/,
  );
});
