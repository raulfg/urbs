import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADELANTO_MIRADA,
  ALTURA_MINIMA_SOBRE_COCHE,
  ALTURA_MIRADA,
  ALTURA_PERSECUCION,
  CONSTANTE_ALTURA,
  CONSTANTE_GIRO,
  DISTANCIA_PERSECUCION,
  ESTIRAMIENTO_POR_VELOCIDAD,
  VELOCIDAD_DE_REFERENCIA,
  acercarAngulo,
  distanciaPorVelocidad,
  factorDeSuavizado,
  puntoDeMirada,
  puntoDePersecucion,
  seguirAlCoche,
} from '../src/camara-persecucion.js';

const ORIGEN = Object.freeze({ x: 0, y: 0, z: 0 });

// --- Donde se pone la camara

test('con guinada cero la camara se queda al sur, mirando al norte', () => {
  // Convencion de ejes: el norte es -Z, asi que "detras" con guinada cero es +Z.
  const punto = puntoDePersecucion(ORIGEN, 0);

  assert.ok(Math.abs(punto.x) < 1e-6);
  assert.ok(Math.abs(punto.z - DISTANCIA_PERSECUCION) < 1e-6);
  assert.ok(Math.abs(punto.y - ALTURA_PERSECUCION) < 1e-6);
});

test('la camara se pone DETRAS del coche en CUALQUIER rumbo, no solo al norte', () => {
  // El fallo que costo mas caro: el signo del seno estaba al reves y la camara
  // se ponia DELANTE del coche en todo rumbo que no fuese norte o sur. Al norte
  // el seno vale cero y tapa el error, asi que el spawn y las rectas se veian
  // perfectos. Por eso esto NO se comprueba contra un signo pensado a mano,
  // sino contra el ADELANTE del chasis, que es (-sen g, -cos g).
  for (const guinada of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.1, -Math.PI / 2]) {
    const punto = puntoDePersecucion(ORIGEN, guinada);
    const adelante = { x: -Math.sin(guinada), z: -Math.cos(guinada) };
    const haciaLaCamara = { x: punto.x - ORIGEN.x, z: punto.z - ORIGEN.z };
    const producto = adelante.x * haciaLaCamara.x + adelante.z * haciaLaCamara.z;

    assert.ok(
      Math.abs(producto + DISTANCIA_PERSECUCION) < 1e-6,
      `con guinada ${guinada} la camara salio a ${producto.toFixed(2)} m por delante`,
    );
  }
});

test('la camara orbita con SU guinada, no con la del coche', () => {
  // Es lo que permite que el angulo vaya con retraso y la camara se abra en la
  // curva. Pegarla al angulo del coche hace que el mundo pivote de golpe
  // alrededor del morro, y se siente rigido.
  const alNorte = puntoDePersecucion(ORIGEN, 0);
  const girada = puntoDePersecucion(ORIGEN, Math.PI / 2);

  assert.ok(Math.abs(alNorte.z - DISTANCIA_PERSECUCION) < 1e-6);
  assert.ok(Math.abs(girada.x - DISTANCIA_PERSECUCION) < 1e-6);
  assert.ok(Math.abs(girada.z) < 1e-6);
});

test('la camara sube sobre el coche, no sobre el suelo', () => {
  const punto = puntoDePersecucion({ x: 0, y: 40, z: 0 }, 0);
  assert.ok(Math.abs(punto.y - (40 + ALTURA_PERSECUCION)) < 1e-6);
});

// --- A donde mira

test('se mira POR DELANTE del coche, no al coche', () => {
  // Apuntando al coche, el coche ocupa el centro de la pantalla y se conduce
  // mirando un techo. Adelantando la mirada, el coche cae al tercio inferior y
  // se ve la calle.
  const mirada = puntoDeMirada(ORIGEN, 0);

  assert.ok(Math.abs(mirada.z + ADELANTO_MIRADA) < 1e-6, 'adelante es -Z con guinada cero');
  assert.ok(Math.abs(mirada.x) < 1e-6);
});

test('se mira algo POR ENCIMA del coche: eso baja el coche en el cuadro', () => {
  const mirada = puntoDeMirada(ORIGEN, 0);
  assert.ok(Math.abs(mirada.y - ALTURA_MIRADA) < 1e-6);
  assert.ok(ALTURA_MIRADA > 0);
});

test('la mirada sigue al COCHE aunque la camara vaya girada', () => {
  // En una curva la camara va retrasada; lo que no puede retrasarse es hacia
  // donde se mira, o se conduce sin ver la salida de la curva.
  const mirada = puntoDeMirada(ORIGEN, Math.PI / 2);

  assert.ok(Math.abs(mirada.x + ADELANTO_MIRADA) < 1e-6, 'con guinada 90 el coche mira al este');
});

// --- La velocidad aleja la camara

test('a mas velocidad, mas lejos: es casi todo lo que cuenta que se va rapido', () => {
  assert.ok(Math.abs(distanciaPorVelocidad(0) - DISTANCIA_PERSECUCION) < 1e-9);
  assert.ok(distanciaPorVelocidad(15) > distanciaPorVelocidad(0));
  assert.ok(
    Math.abs(
      distanciaPorVelocidad(VELOCIDAD_DE_REFERENCIA) -
        (DISTANCIA_PERSECUCION + ESTIRAMIENTO_POR_VELOCIDAD),
    ) < 1e-9,
  );
});

test('la marcha atras tambien aleja: cuenta la velocidad, no el sentido', () => {
  assert.equal(distanciaPorVelocidad(-20), distanciaPorVelocidad(20));
});

test('pasada la velocidad de referencia no se sigue alejando', () => {
  assert.equal(
    distanciaPorVelocidad(VELOCIDAD_DE_REFERENCIA * 5),
    distanciaPorVelocidad(VELOCIDAD_DE_REFERENCIA),
  );
});

// --- El angulo va por el camino corto

test('el giro toma SIEMPRE el camino corto', () => {
  // Sin esto, cruzar el norte da un latigazo: el angulo salta de +3,14 a -3,14
  // y la interpolacion recorre los 360 grados que hay entre esos dos NUMEROS
  // en vez de los cero que hay entre esos dos ANGULOS. Y solo pasa mirando al
  // norte, que es la clase de fallo que aparece una de cada diez partidas.
  const casi = Math.PI - 0.05;
  const alOtroLado = -Math.PI + 0.05;

  const siguiente = acercarAngulo(casi, alOtroLado, 0.5);

  // Tiene que cruzar por encima de PI, no volver por el 0.
  assert.ok(Math.abs(siguiente) > Math.PI - 0.06, `salio ${siguiente}`);
});

test('con factor 1 llega al objetivo, salvo por la vuelta completa', () => {
  const llegada = acercarAngulo(0.3, 1.2, 1);
  assert.ok(Math.abs(llegada - 1.2) < 1e-9);
});

test('con factor 0 no se mueve', () => {
  assert.equal(acercarAngulo(0.3, 2.9, 0), 0.3);
});

test('un objetivo a media vuelta exacta no se va al infinito', () => {
  const siguiente = acercarAngulo(0, Math.PI, 0.5);
  assert.ok(Number.isFinite(siguiente));
  assert.ok(Math.abs(siguiente) <= Math.PI);
});

test('girar mil veces en el mismo sentido no acumula vueltas absurdas', () => {
  let angulo = 0;
  for (let i = 0; i < 1000; i += 1) {
    angulo = acercarAngulo(angulo, 3, 0.5);
  }
  assert.ok(Math.abs(angulo - 3) < 1e-6);
});

// --- Suavizado

test('la altura va MAS FLOJA que el giro: es el eje que absorbe el relieve', () => {
  // Al reves seria un desastre: una cuesta movería la camara antes de que el
  // angulo la hubiese recolocado.
  assert.ok(CONSTANTE_ALTURA > CONSTANTE_GIRO);
});

test('el suavizado no se pasa nunca de largo', () => {
  for (const segundos of [1 / 240, 1 / 60, 0.1, 5]) {
    const factor = factorDeSuavizado(segundos, 0.2);
    assert.ok(factor >= 0 && factor <= 1, `con ${segundos} s el factor fue ${factor}`);
  }
});

test('un fotograma de cero segundos no mueve la camara', () => {
  assert.equal(factorDeSuavizado(0, 0.2), 0);
});

test('el suavizado NO depende de los fotogramas por segundo', () => {
  const constante = 0.25;
  const segundos = 1 / 30;

  const deUnGolpe = 1 - factorDeSuavizado(segundos, constante);
  let aTrozos = 1;
  for (let i = 0; i < 4; i += 1) {
    aTrozos *= 1 - factorDeSuavizado(segundos / 4, constante);
  }

  assert.ok(Math.abs(deUnGolpe - aTrozos) < 1e-9);
});

test('una constante no positiva pega la camara al coche en vez de dividir por cero', () => {
  assert.equal(factorDeSuavizado(1 / 60, 0), 1);
  assert.equal(factorDeSuavizado(1 / 60, -3), 1);
});

// --- El seguimiento completo, fotograma a fotograma

/**
 * Da una vuelta a un circulo y devuelve, en grados, lo mas lejos del centro del
 * cuadro que llega a irse el coche.
 *
 * El angulo que se mide es el que hay, en planta, entre hacia donde apunta la
 * camara y donde esta el coche. Cero es el coche clavado en el centro; la mitad
 * del campo de vision horizontal es el coche saliendose por el borde.
 */
function desvioMaximoEnUnCirculo({ velocidad, radio, segundos = 1 / 60, vueltas = 1 }) {
  const giro = velocidad / radio;
  const coche = { posicion: { x: 0, y: 0, z: 0 }, guinada: 0, velocidad };
  let estado = { guinada: 0, altura: null };
  let peor = 0;

  const pasos = Math.round((vueltas * 2 * Math.PI) / giro / segundos);
  for (let i = 0; i < pasos; i += 1) {
    coche.posicion.x -= Math.sin(coche.guinada) * velocidad * segundos;
    coche.posicion.z -= Math.cos(coche.guinada) * velocidad * segundos;
    coche.guinada += giro * segundos;

    estado = seguirAlCoche(estado, coche, segundos);

    const aCoche = Math.atan2(
      coche.posicion.x - estado.posicion.x,
      coche.posicion.z - estado.posicion.z,
    );
    const aMirada = Math.atan2(
      estado.mirada.x - estado.posicion.x,
      estado.mirada.z - estado.posicion.z,
    );
    let desvio = Math.abs(aCoche - aMirada) % (Math.PI * 2);
    if (desvio > Math.PI) desvio = Math.PI * 2 - desvio;

    // La media vuelta inicial es la camara colocandose; se mide el regimen.
    if (i > pasos / 2) peor = Math.max(peor, desvio);
  }

  return (peor * 180) / Math.PI;
}

test('en una curva sostenida el coche NO se va al borde del cuadro', () => {
  // El fallo que se veia: girando a fondo el coche acababa pegado al borde
  // derecho, de lado y comiendose media pantalla. La causa NO era el retraso
  // del angulo —ese esta acotado por su constante— sino arrastrar la POSICION
  // de la camara por el mundo: en una curva el punto al que persigue orbita, y
  // perseguirlo con retraso deja la camara varios metros por fuera de la
  // orbita, que a siete metros del coche son decenas de grados.
  const desvio = desvioMaximoEnUnCirculo({ velocidad: 22, radio: 15 });
  assert.ok(desvio < 12, `el coche se iba ${desvio.toFixed(1)} grados fuera del centro`);
});

test('ni siquiera en la curva mas cerrada que puede trazar', () => {
  const desvio = desvioMaximoEnUnCirculo({ velocidad: 8, radio: 5 });
  assert.ok(desvio < 12, `el coche se iba ${desvio.toFixed(1)} grados fuera del centro`);
});

test('el desvio no depende de los fotogramas por segundo', () => {
  const rapido = desvioMaximoEnUnCirculo({ velocidad: 22, radio: 15, segundos: 1 / 240 });
  const lento = desvioMaximoEnUnCirculo({ velocidad: 22, radio: 15, segundos: 1 / 30 });
  assert.ok(Math.abs(rapido - lento) < 2, `${rapido.toFixed(1)} contra ${lento.toFixed(1)}`);
});

test('la posicion horizontal NO se arrastra: sale de la guinada y ya', () => {
  // Es lo que acota el desvio. Dos estados con alturas distintas, mismo coche y
  // misma guinada, tienen que dar exactamente el mismo sitio en planta.
  const coche = { posicion: { x: 10, y: 40, z: -5 }, guinada: 1.2, velocidad: 20 };
  const desdeArriba = seguirAlCoche({ guinada: 0.9, altura: 300 }, coche, 1 / 60);
  const desdeAbajo = seguirAlCoche({ guinada: 0.9, altura: 0 }, coche, 1 / 60);

  assert.equal(desdeArriba.posicion.x, desdeAbajo.posicion.x);
  assert.equal(desdeArriba.posicion.z, desdeAbajo.posicion.z);
});

test('la altura SI se suaviza: un bache no lanza la camara', () => {
  // Lo unico que se arrastra es la altura, y solo para absorber el relieve y
  // los baches. Es el eje en el que un salto no desencuadra nada.
  const coche = { posicion: { x: 0, y: 10, z: 0 }, guinada: 0, velocidad: 0 };
  const paso = seguirAlCoche({ guinada: 0, altura: 3 }, coche, 1 / 60);

  assert.ok(paso.posicion.y > 3, 'sube');
  assert.ok(paso.posicion.y < 10 + ALTURA_PERSECUCION, 'pero no de un golpe');
});

test('el tope de altura sobre el coche no envenena el estado guardado', () => {
  // Si el estado se guardase ya topado, bajar una cuesta dejaria la camara
  // colgada arriba: cada fotograma volveria a partir del tope.
  const enCuesta = { posicion: { x: 0, y: 100, z: 0 }, guinada: 0, velocidad: 0 };
  const topado = seguirAlCoche({ guinada: 0, altura: 0 }, enCuesta, 1 / 60);

  assert.ok(topado.posicion.y >= 100 + ALTURA_MINIMA_SOBRE_COCHE, 'se topa');
  assert.ok(topado.altura < topado.posicion.y, 'pero se guarda lo de verdad, sin topar');
});

test('sin altura previa la camara aparece ya colocada, no viene volando', () => {
  const coche = { posicion: { x: 0, y: 40, z: 0 }, guinada: 0, velocidad: 0 };
  const primero = seguirAlCoche({ guinada: 0, altura: null }, coche, 1 / 60);

  assert.ok(Math.abs(primero.posicion.y - (40 + ALTURA_PERSECUCION)) < 1e-9);
});
