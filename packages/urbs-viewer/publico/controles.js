/**
 * Entrada y camara libre.
 *
 * Un solo sitio escucha el teclado y el raton. La camara libre y el coche leen
 * del MISMO conjunto de teclas pulsadas en lugar de poner cada uno sus
 * escuchadores: dos escuchadores sobre la W acaban, tarde o temprano, con el
 * coche acelerando mientras vuelas.
 *
 * Escrito a mano en lugar de traer `PointerLockControls` porque son cuarenta
 * lineas, no hay nada que aprender de una dependencia para esto y el visor no
 * tiene empaquetador: cada import externo es una entrada mas en el mapa de
 * importaciones.
 *
 * El giro se guarda como guinada y cabeceo, no como cuaternion acumulado: al
 * acumular rotaciones aparece alabeo y el horizonte se tuerce solo.
 */

import * as THREE from 'three';

/** Metros por segundo a velocidad normal. */
const VELOCIDAD = 60;

/** Multiplicador con Mayusculas. Cruzar el slice de punta a punta en segundos. */
const ACELERACION = 6;

/** Radianes de giro por pixel de raton. */
const SENSIBILIDAD = 0.0022;

/** Cabeceo maximo. Justo por debajo de la vertical, o la camara da la vuelta. */
const CABECEO_MAXIMO = Math.PI / 2 - 0.01;

const VUELO = Object.freeze({
  KeyW: 'adelante',
  KeyS: 'atras',
  KeyA: 'izquierda',
  KeyD: 'derecha',
  KeyR: 'arriba',
  KeyF: 'abajo',
});

/**
 * Altura minima de la camara libre, en metros.
 *
 * El suelo es opaco: si la camara lo atraviesa, lo unico que se ve es la cara
 * de atras del plano y la ciudad desaparece. La fisica no sujeta a la camara
 * —no es un cuerpo—, asi que la sujeta esta linea.
 */
export const ALTURA_MINIMA = 1.6;

/**
 * @param {THREE.PerspectiveCamera} camara
 * @param {HTMLElement} lienzo
 */
export function crearControles(camara, lienzo) {
  /** @type {Set<string>} */
  const pulsadas = new Set();
  let guinada = camara.rotation.y;
  let cabeceo = camara.rotation.x;
  let rapido = false;
  let activo = true;

  const adelante = new THREE.Vector3();
  const derecha = new THREE.Vector3();
  const ARRIBA = new THREE.Vector3(0, 1, 0);

  function alMoverRaton(evento) {
    if (document.pointerLockElement !== lienzo || !activo) {
      return;
    }
    guinada -= evento.movementX * SENSIBILIDAD;
    cabeceo -= evento.movementY * SENSIBILIDAD;
    cabeceo = Math.max(-CABECEO_MAXIMO, Math.min(CABECEO_MAXIMO, cabeceo));
  }

  function alPulsar(evento) {
    pulsadas.add(evento.code);
    if (VUELO[evento.code] !== undefined) {
      evento.preventDefault();
    }
    if (evento.code === 'ShiftLeft' || evento.code === 'ShiftRight') {
      rapido = true;
    }
  }

  function alSoltar(evento) {
    pulsadas.delete(evento.code);
    if (evento.code === 'ShiftLeft' || evento.code === 'ShiftRight') {
      rapido = false;
    }
  }

  lienzo.addEventListener('click', () => lienzo.requestPointerLock());
  document.addEventListener('mousemove', alMoverRaton);
  // Soltar el raton no puede dejar una tecla pegada moviendo la camara sola.
  document.addEventListener('pointerlockchange', () => pulsadas.clear());
  window.addEventListener('keydown', alPulsar);
  window.addEventListener('keyup', alSoltar);
  window.addEventListener('blur', () => pulsadas.clear());

  return {
    get activo() {
      return activo;
    },
    set activo(valor) {
      activo = valor;
      // Cambiar de modo no puede dejar una tecla pulsada: si se sale del coche
      // con la W apretada, la camara sale disparada.
      pulsadas.clear();
    },

    /**
     * @param {string} codigo  Un `KeyboardEvent.code`
     * @returns {boolean}
     */
    pulsada(codigo) {
      return pulsadas.has(codigo);
    },

    /**
     * Adopta la orientacion que tenga la camara ahora mismo.
     *
     * Al volver del coche, la camara esta donde la dejo la persecucion. Sin
     * esto, el primer fotograma de vuelo la devolveria de golpe al angulo que
     * tenia hace diez minutos, que es la peor forma de desorientar a alguien.
     *
     * @returns {void}
     */
    sincronizar() {
      const euler = new THREE.Euler().setFromQuaternion(camara.quaternion, 'YXZ');
      guinada = euler.y;
      cabeceo = Math.max(-CABECEO_MAXIMO, Math.min(CABECEO_MAXIMO, euler.x));
    },

    /**
     * Orienta la camara y calcula CUANTO querria moverse este fotograma.
     *
     * No mueve la camara. Devolver la intencion en lugar de aplicarla es lo que
     * permite que quien llama la pase antes por el mundo de colisiones: la
     * camara no es un cuerpo fisico, asi que si se moviera sola atravesaria las
     * fachadas como si no estuvieran.
     *
     * @param {number} segundos  Tiempo del fotograma
     * @param {THREE.Vector3} destino  Donde se escribe el desplazamiento
     * @returns {THREE.Vector3}  El mismo `destino`, en metros
     */
    actualizar(segundos, destino) {
      destino.set(0, 0, 0);
      if (!activo) {
        return destino;
      }

      camara.rotation.set(cabeceo, guinada, 0, 'YXZ');

      camara.getWorldDirection(adelante);
      derecha.crossVectors(adelante, ARRIBA).normalize();

      const paso = VELOCIDAD * (rapido ? ACELERACION : 1) * segundos;
      if (pulsadas.has('KeyW')) destino.addScaledVector(adelante, paso);
      if (pulsadas.has('KeyS')) destino.addScaledVector(adelante, -paso);
      if (pulsadas.has('KeyD')) destino.addScaledVector(derecha, paso);
      if (pulsadas.has('KeyA')) destino.addScaledVector(derecha, -paso);
      if (pulsadas.has('KeyR')) destino.y += paso;
      if (pulsadas.has('KeyF')) destino.y -= paso;

      return destino;
    },
  };
}
