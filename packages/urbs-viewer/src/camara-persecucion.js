/**
 * Camara de persecucion: donde ponerse para ver conducir.
 *
 * Dos funciones puras y nada mas. La camara ideal va detras y por encima del
 * coche, girada con el; la real llega alli con retraso, que es lo que hace que
 * un giro se vea como un giro y no como que el mundo rota alrededor del capo.
 *
 * El retraso se calcula con un factor EXPONENCIAL, no con una constante fija.
 * Un `actual += (deseado - actual) * 0,1` por fotograma persigue cuatro veces
 * mas rapido a 240 fps que a 60: el coche se siente distinto segun el monitor.
 * Con `1 - e^(-dt/tau)`, tau son segundos de verdad y el resultado de dar dos
 * medios pasos es exactamente el de dar uno entero.
 */

/** Metros por detras del coche. */
export const DISTANCIA_PERSECUCION = 8.5;

/** Metros por encima del coche. */
export const ALTURA_PERSECUCION = 3.2;

/**
 * Constante de tiempo del seguimiento, en segundos. Mas corta, mas pegada.
 * Esta deja ver el coche girar sin que la camara se quede atras en una curva.
 */
export const CONSTANTE_PERSECUCION = 0.18;

/** Cuanto por delante del coche mira la camara, en metros. */
export const ADELANTO_MIRADA = 6;

/**
 * Punto ideal de la camara para un coche.
 *
 * Convencion de ejes, la de siempre: el norte es -Z. Con guinada cero el coche
 * mira al norte, asi que "detras" es +Z.
 *
 * @param {{x: number, y: number, z: number}} coche
 * @param {number} guinada  Radianes alrededor de Y
 * @param {Object} [opciones]
 * @param {number} [opciones.distancia]
 * @param {number} [opciones.altura]
 * @returns {{x: number, y: number, z: number}}
 */
export function puntoDePersecucion(coche, guinada, opciones = {}) {
  const { distancia = DISTANCIA_PERSECUCION, altura = ALTURA_PERSECUCION } = opciones;

  // Adelante es (sin, 0, -cos); detras es lo mismo cambiado de signo.
  return {
    x: coche.x - Math.sin(guinada) * distancia,
    y: coche.y + altura,
    z: coche.z + Math.cos(guinada) * distancia,
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
