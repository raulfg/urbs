/**
 * Camara de persecucion: donde ponerse para ver conducir.
 *
 * Todo lo de aqui son funciones puras. La camara ideal va detras y por encima
 * del coche; la real llega con retraso, que es lo que hace que un giro se vea
 * como un giro y no como que el mundo rota alrededor del capo.
 *
 * CUATRO COSAS QUE SEPARAN UNA CAMARA DE COCHES DE UNA QUE SOLO VA DETRAS, y
 * la primera version no tenia ninguna:
 *
 * 1. LA CAMARA TIENE SU PROPIA GUINADA Y VA CON RETRASO. Si la orbita se pega
 *    al angulo del coche, al girar el mundo pivota de golpe alrededor del
 *    morro y se siente rigido. Dejando que el angulo persiga al del coche, la
 *    camara se abre en la curva y se cierra a la salida, que es de donde sale
 *    la sensacion de peso.
 * 2. SE MIRA POR ENCIMA Y POR DELANTE DEL COCHE, no al coche. Apuntando al
 *    coche, el coche ocupa el centro de la pantalla y se conduce mirando un
 *    techo. Apuntando a un punto adelantado y algo alto, el coche cae al
 *    tercio inferior y se ve la calle, que es lo que hace falta para conducir.
 * 3. LA CAMARA SE ALEJA CON LA VELOCIDAD. Es casi todo lo que comunica que se
 *    va rapido cuando no hay motor ni marcador que lo cuente.
 * 4. EL RETRASO ES EXPONENCIAL, no una constante por fotograma. Un
 *    `actual += (deseado - actual) * 0,1` persigue cuatro veces mas rapido a
 *    240 fps que a 60: el coche se siente distinto segun el monitor.
 *
 * Y UNA QUINTA, que costo una vuelta entera: EL RETRASO VIVE EN EL ANGULO, NO
 * EN LA POSICION. Arrastrar la posicion de la camara por el mundo suena a lo
 * mismo, y no lo es. En una curva el punto al que persigue ORBITA, asi que
 * perseguirlo con retraso no la deja detras: la deja POR FUERA de la orbita,
 * varios metros de lado. A siete metros del coche, eso son decenas de grados, y
 * lo que se ve es el coche pegado al borde del cuadro, de lado, comiendose
 * media pantalla. El retraso del angulo, en cambio, esta acotado por su propia
 * constante: como mucho vale la velocidad de giro por la constante.
 *
 * Asi que en planta la camara va CLAVADA a la orbita de su guinada. Lo unico
 * que se arrastra es la altura, que es el eje donde un salto no desencuadra
 * nada y donde hacen falta baches y cuestas suavizados.
 */

/** Metros por detras del coche, parado. */
export const DISTANCIA_PERSECUCION = 7.5;

/** Metros que se aleja de mas a velocidad punta. */
export const ESTIRAMIENTO_POR_VELOCIDAD = 3;

/** Metros por encima del coche. */
export const ALTURA_PERSECUCION = 3;

/** Velocidad, en m/s, a la que el estiramiento llega al maximo. */
export const VELOCIDAD_DE_REFERENCIA = 30;

/**
 * Constante de tiempo del seguimiento de GIRO, en segundos.
 *
 * Es el unico retraso que se nota conduciendo: la camara se abre en la curva y
 * se cierra a la salida. Tambien es el unico que hay que vigilar, porque el
 * desvio del coche respecto al centro del cuadro vale, en regimen, la velocidad
 * de giro por esta constante.
 */
export const CONSTANTE_GIRO = 0.16;

/** Constante de tiempo de la ALTURA, en segundos. Absorbe baches y cuestas. */
export const CONSTANTE_ALTURA = 0.25;

/** Cuanto por delante del coche mira la camara, en metros. */
export const ADELANTO_MIRADA = 6;

/** A que altura sobre el coche se mira. Sube el morro y baja el coche en cuadro. */
export const ALTURA_MIRADA = 1.6;

/** Lo minimo que la camara se queda por encima del coche. */
export const ALTURA_MINIMA_SOBRE_COCHE = 1.2;

/** Dos pi, que aparece en todas las cuentas de angulos. */
const VUELTA = Math.PI * 2;

/**
 * Acerca un angulo a otro POR EL CAMINO CORTO.
 *
 * Sin esto, cruzar el norte hace que la camara se de la vuelta entera: el
 * angulo salta de +3,14 a -3,14 y la interpolacion recorre los 360 grados que
 * hay entre esos dos numeros en vez de los cero que hay entre esos dos
 * angulos. Se ve como un latigazo y solo pasa mirando al norte.
 *
 * @param {number} actual
 * @param {number} objetivo
 * @param {number} factor  Entre 0 y 1
 * @returns {number}
 */
export function acercarAngulo(actual, objetivo, factor) {
  let diferencia = (objetivo - actual) % VUELTA;
  if (diferencia > Math.PI) diferencia -= VUELTA;
  if (diferencia < -Math.PI) diferencia += VUELTA;
  return actual + diferencia * factor;
}

/**
 * Cuanto se aleja la camara a una velocidad dada.
 *
 * @param {number} velocidad  Metros por segundo, con signo
 * @returns {number} Metros
 */
export function distanciaPorVelocidad(velocidad) {
  const fraccion = Math.min(Math.abs(velocidad) / VELOCIDAD_DE_REFERENCIA, 1);
  return DISTANCIA_PERSECUCION + ESTIRAMIENTO_POR_VELOCIDAD * fraccion;
}

/**
 * Punto ideal de la camara, dada SU propia guinada (no la del coche).
 *
 * Convencion de ejes, la de siempre: el norte es -Z. El adelante del chasis es
 * (-sen g, -cos g) —lo dice el cuaternion del coche, medido, no razonado—, asi
 * que detras es (+sen g, +cos g). El signo del seno estuvo AL REVES y la camara
 * se ponia DELANTE del coche en cualquier rumbo que no fuese norte o sur. No se
 * veia: el coche sale mirando al norte y en una recta la camara sigue detras
 * porque no hay desfase que lo delate. Lo que se veia era el coche disparado al
 * borde del cuadro en cuanto se giraba.
 *
 * @param {{x: number, y: number, z: number}} coche
 * @param {number} guinadaCamara
 * @param {Object} [opciones]
 * @param {number} [opciones.distancia]
 * @param {number} [opciones.altura]
 * @returns {{x: number, y: number, z: number}}
 */
export function puntoDePersecucion(coche, guinadaCamara, opciones = {}) {
  const { distancia = DISTANCIA_PERSECUCION, altura = ALTURA_PERSECUCION } = opciones;

  return {
    x: coche.x + Math.sin(guinadaCamara) * distancia,
    y: coche.y + altura,
    z: coche.z + Math.cos(guinadaCamara) * distancia,
  };
}

/**
 * A donde mira la camara: por delante del coche y algo mas arriba que el.
 *
 * @param {{x: number, y: number, z: number}} coche
 * @param {number} guinadaCoche
 * @param {Object} [opciones]
 * @param {number} [opciones.adelanto]
 * @param {number} [opciones.altura]
 * @returns {{x: number, y: number, z: number}}
 */
export function puntoDeMirada(coche, guinadaCoche, opciones = {}) {
  const { adelanto = ADELANTO_MIRADA, altura = ALTURA_MIRADA } = opciones;

  // El adelante del coche es (-sin g, -cos g), el mismo convenio que usa
  // `puntoDePersecucion` para ponerse detras.
  return {
    x: coche.x - Math.sin(guinadaCoche) * adelanto,
    y: coche.y + altura,
    z: coche.z - Math.cos(guinadaCoche) * adelanto,
  };
}

/**
 * Cuanto hay que acercarse al objetivo en este fotograma, entre 0 y 1.
 *
 * @param {number} segundos
 * @param {number} constante  Segundos; cuanto menor, mas pegada va la camara
 * @returns {number}
 */
export function factorDeSuavizado(segundos, constante) {
  if (!(constante > 0)) {
    // Sin constante no hay retraso: la camara va clavada al coche. Es lo que
    // hace falta al cambiar de modo, para no cruzar la ciudad volando.
    return 1;
  }
  if (!(segundos > 0)) {
    return 0;
  }
  return 1 - Math.exp(-segundos / constante);
}

/**
 * Un fotograma de camara: de donde venia y donde va el coche, a donde toca
 * ponerse y a donde mirar.
 *
 * El estado que hay que guardar entre fotogramas es el que devuelve: `guinada`
 * y `altura`. La `altura` se devuelve SIN TOPAR contra el coche a proposito; si
 * se guardase ya topada, bajar una cuesta dejaria la camara colgada arriba,
 * partiendo cada fotograma del tope en vez de de donde iba.
 *
 * @param {{guinada: number, altura: (number|null)}} estado
 * @param {{posicion: {x: number, y: number, z: number}, guinada: number, velocidad: number}} coche
 * @param {number} segundos
 * @returns {{
 *   guinada: number,
 *   altura: number,
 *   posicion: {x: number, y: number, z: number},
 *   mirada: {x: number, y: number, z: number},
 * }}
 */
export function seguirAlCoche(estado, coche, segundos) {
  const guinada = acercarAngulo(
    estado.guinada,
    coche.guinada,
    factorDeSuavizado(segundos, CONSTANTE_GIRO),
  );

  // En planta, clavada a la orbita. Todo el retraso esta ya en la guinada.
  const punto = puntoDePersecucion(coche.posicion, guinada, {
    distancia: distanciaPorVelocidad(coche.velocidad),
  });

  // Sin altura previa no hay nada que suavizar: es el primer fotograma y la
  // camara tiene que aparecer ya colocada, no venir volando desde el cero.
  const previa = Number.isFinite(estado.altura) ? estado.altura : punto.y;
  const altura = previa + (punto.y - previa) * factorDeSuavizado(segundos, CONSTANTE_ALTURA);

  return {
    guinada,
    altura,
    posicion: {
      x: punto.x,
      // La camara no baja del coche. Con relieve, un tope absoluto no sirve de
      // nada —el suelo esta a cuarenta metros— y subiendo una cuesta la camara
      // se metia dentro de la ladera de detras.
      y: Math.max(altura, coche.posicion.y + ALTURA_MINIMA_SOBRE_COCHE),
      z: punto.z,
    },
    // La mirada sigue al COCHE aunque la camara vaya girada, o no se veria la
    // salida de la curva.
    mirada: puntoDeMirada(coche.posicion, coche.guinada),
  };
}
