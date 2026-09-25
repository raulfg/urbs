/**
 * Camara libre: volar por encima de la ciudad.
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

const TECLAS = Object.freeze({
  KeyW: 'adelante',
  KeyS: 'atras',
  KeyA: 'izquierda',
  KeyD: 'derecha',
  KeyR: 'arriba',
  KeyF: 'abajo',
});

/**
 * @param {THREE.PerspectiveCamera} camara
 * @param {HTMLElement} lienzo
 */
export function crearControles(camara, lienzo) {
  const pulsadas = new Set();
  let guinada = camara.rotation.y;
  let cabeceo = camara.rotation.x;
  let rapido = false;

  const adelante = new THREE.Vector3();
  const derecha = new THREE.Vector3();
  const ARRIBA = new THREE.Vector3(0, 1, 0);

  function alMoverRaton(evento) {
    if (document.pointerLockElement !== lienzo) {
      return;
    }
    guinada -= evento.movementX * SENSIBILIDAD;
    cabeceo -= evento.movementY * SENSIBILIDAD;
    cabeceo = Math.max(-CABECEO_MAXIMO, Math.min(CABECEO_MAXIMO, cabeceo));
  }

  function alPulsar(evento) {
    if (TECLAS[evento.code]) {
      pulsadas.add(TECLAS[evento.code]);
      evento.preventDefault();
    }
    if (evento.code === 'ShiftLeft' || evento.code === 'ShiftRight') {
      rapido = true;
    }
  }

  function alSoltar(evento) {
    pulsadas.delete(TECLAS[evento.code]);
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
    /**
     * @param {number} segundos  Tiempo del fotograma
     * @returns {void}
     */
    actualizar(segundos) {
      camara.rotation.set(cabeceo, guinada, 0, 'YXZ');

      if (pulsadas.size === 0) {
        return;
      }

      camara.getWorldDirection(adelante);
      derecha.crossVectors(adelante, ARRIBA).normalize();

      const paso = VELOCIDAD * (rapido ? ACELERACION : 1) * segundos;
      if (pulsadas.has('adelante')) camara.position.addScaledVector(adelante, paso);
      if (pulsadas.has('atras')) camara.position.addScaledVector(adelante, -paso);
      if (pulsadas.has('derecha')) camara.position.addScaledVector(derecha, paso);
      if (pulsadas.has('izquierda')) camara.position.addScaledVector(derecha, -paso);
      if (pulsadas.has('arriba')) camara.position.y += paso;
      if (pulsadas.has('abajo')) camara.position.y -= paso;
    },
  };
}
