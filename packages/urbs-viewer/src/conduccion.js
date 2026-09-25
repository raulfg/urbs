/**
 * Conduccion: de las teclas a las fuerzas.
 *
 * Esto NO es un simulador. No hay embrague, ni marchas, ni curva de par, ni
 * reparto de peso. Es un coche arcade, y el objetivo declarado es que se pueda
 * dar una vuelta por la Ciudad Vieja treinta segundos sin pelearse con el.
 *
 * Aqui no hay Rapier. Entran cuatro teclas y la velocidad actual, y salen tres
 * numeros: fuerza de motor, freno y angulo de la direccion. Quien tenga el
 * vehiculo delante se los da a sus ruedas. Asi la parte que de verdad decide
 * como se siente el coche se puede probar entera en Node, que es lo unico que
 * se puede probar sin navegador de un motor de fisicas.
 *
 * Las dos decisiones que separan "se conduce solo" de "es imposible":
 *
 * 1. EL FRENO NO ES LA MARCHA ATRAS. La misma tecla hace las dos cosas, pero
 *    cual depende de si el coche va hacia delante o esta parado. Sin ese
 *    estado, pisar el freno a ochenta te lanza marcha atras.
 * 2. LA DIRECCION SE CIERRA CON LA VELOCIDAD. Con el mismo tope a 100 que a 10
 *    el coche da un trompo a la minima correccion.
 */

/** Metros por segundo. Unos 108 km/h: sobrado para un casco historico. */
export const VELOCIDAD_MAXIMA = 30;

/** Newtons de empuje en las ruedas motrices. */
export const FUERZA_MOTOR = 6000;

/**
 * Freno. NO son newtons: Rapier trata este valor como un impulso de frenada
 * por fotograma, y su escala no tiene nada que ver con la de la fuerza del
 * motor. Con 9.000 el coche pasaba de 91 km/h a parado en menos de un segundo,
 * que es aparatoso y ademas impredecible. Este valor esta medido en el
 * navegador, no deducido: frena de 100 a cero en unos tres segundos.
 */
export const FUERZA_FRENO = 3200;

/** Freno pasivo con el pie fuera: la retencion del motor. Un decimo. */
export const FRENO_RETENCION = 350;

/** Marcha atras, mas floja que hacia delante. Como en un coche de verdad. */
export const FACTOR_MARCHA_ATRAS = 0.45;

/** Angulo maximo de la direccion, en radianes, con el coche parado. */
export const DIRECCION_MAXIMA = 0.55;

/** Angulo maximo a la velocidad maxima. Unos 7 grados. */
export const DIRECCION_MINIMA = 0.12;

/** Radianes por segundo a los que se mueve el volante. */
export const VELOCIDAD_VOLANTE = 2.8;

/** Radianes por segundo a los que vuelve solo al centro. Mas rapido: se suelta. */
export const VELOCIDAD_CENTRADO = 4.5;

/** Por debajo de esto el coche esta "parado" y el freno pasa a ser marcha atras. */
export const UMBRAL_PARADO = 0.6;

/**
 * Angulo maximo de direccion a una velocidad dada.
 *
 * @param {number} velocidad  Metros por segundo, con signo
 * @returns {number} Radianes
 */
export function limiteDeDireccion(velocidad) {
  const fraccion = Math.min(Math.abs(velocidad) / VELOCIDAD_MAXIMA, 1);
  return DIRECCION_MAXIMA + (DIRECCION_MINIMA - DIRECCION_MAXIMA) * fraccion;
}

/**
 * Acerca un valor a otro a un ritmo constante, sin pasarse.
 *
 * @param {number} actual
 * @param {number} objetivo
 * @param {number} paso
 * @returns {number}
 */
function acercar(actual, objetivo, paso) {
  const diferencia = objetivo - actual;
  if (Math.abs(diferencia) <= paso) {
    return objetivo;
  }
  return actual + Math.sign(diferencia) * paso;
}

/**
 * @typedef {Object} Mando
 * @property {boolean} acelera
 * @property {boolean} frena
 * @property {boolean} izquierda
 * @property {boolean} derecha
 * @property {number} velocidad  Metros por segundo, negativa marcha atras
 */

/**
 * Crea el estado de conduccion. Lo unico que recuerda es el volante.
 */
export function crearConduccion() {
  let direccion = 0;

  return {
    get direccion() {
      return direccion;
    },

    /**
     * @param {Mando} mando
     * @param {number} segundos
     * @returns {{fuerzaMotor: number, freno: number, direccion: number}}
     */
    actualizar(mando, segundos) {
      const { acelera, frena, izquierda, derecha, velocidad } = mando;

      // --- Volante. Izquierda y derecha a la vez se anulan, y con el pie
      // fuera vuelve al centro mas rapido de lo que gira: soltar es soltar.
      const giro = (izquierda ? 1 : 0) - (derecha ? 1 : 0);
      const limite = limiteDeDireccion(velocidad);
      const objetivo = giro * limite;
      const ritmo = giro === 0 ? VELOCIDAD_CENTRADO : VELOCIDAD_VOLANTE;
      direccion = acercar(direccion, objetivo, ritmo * segundos);
      // El limite baja al acelerar, asi que un volante ya girado se recorta.
      direccion = Math.max(-limite, Math.min(limite, direccion));

      // --- Motor y freno. Manda el estado, no la tecla.
      let fuerzaMotor = 0;
      let freno = FRENO_RETENCION;

      if (frena) {
        if (velocidad > UMBRAL_PARADO) {
          // Yendo hacia delante, el freno frena. No es marcha atras.
          freno = FUERZA_FRENO;
        } else {
          // Parado o ya rodando hacia atras: ahora si es marcha atras.
          fuerzaMotor = -FUERZA_MOTOR * FACTOR_MARCHA_ATRAS;
          freno = 0;
        }
      } else if (acelera) {
        if (velocidad < -UMBRAL_PARADO) {
          // Yendo hacia atras, el acelerador frena primero. Cambiar de sentido
          // de golpe es lo que hace que un coche arcade parezca de goma.
          freno = FUERZA_FRENO;
        } else if (velocidad < VELOCIDAD_MAXIMA) {
          fuerzaMotor = FUERZA_MOTOR;
          freno = 0;
        } else {
          // A tope de velocidad se corta el gas, pero no se frena: seria un
          // limitador que pega tirones.
          freno = 0;
        }
      }

      return { fuerzaMotor, freno, direccion };
    },
  };
}
