/**
 * El coche: un chasis dinamico sobre el vehiculo de rayos de Rapier.
 *
 * `DynamicRayCastVehicleController` no simula ruedas como cuerpos: lanza un
 * rayo por rueda hacia abajo, y de la distancia al suelo saca la suspension, el
 * agarre y el empuje. Es lo que usa medio juego de coches que existe, y es
 * exactamente lo que se quiere aqui: un coche arcade que se agarra, que no
 * vuelca a la primera y que no cuesta cuatro milisegundos por fotograma.
 *
 * Lo que decide como se SIENTE el coche no esta aqui sino en
 * `../src/conduccion.js`, que es puro y esta probado. Aqui solo se traducen sus
 * tres numeros a llamadas de Rapier y se copia el resultado a la malla.
 *
 * El chasis es un sujeto de rebase mas: cuando el ancla se muda, el coche se
 * mueve con la ciudad en la misma llamada. Y se mueve DESPERTANDOLO, al reves
 * que los cuerpos de celda, porque este si duerme.
 */

import * as THREE from 'three';

import { crearConduccion } from '../src/conduccion.js';
import { desplazar } from '../src/rebase.js';

/**
 * Medidas del chasis, en metros. Un utilitario. El origen es su centro.
 *
 * Hay que tomarselas en serio: la ciudad viene de datos reales en metros, asi
 * que un coche mal medido desentona con TODO lo que tiene al lado. La primera
 * version media 2,11 m hasta el techo —una furgoneta alta— y se notaba al
 * momento contra un portal. La cuenta de la altura total esta abajo, en
 * `ALTURA_TECHO`, para no tener que fiarse del ojo.
 */
export const LARGO = 4.2;
export const ANCHO = 1.8;
export const ALTO = 0.78;

export const RADIO_RUEDA = 0.32;
export const ANCHO_RUEDA = 0.22;

/** Masa, en kilos. */
export const MASA = 1200;

/**
 * Geometria de la suspension. Estos cuatro numeros TIENEN que cuadrar entre si
 * o el coche no anda, y el sintoma no lo dice: un vehiculo de rayos solo empuja
 * cuando el rayo de la rueda encuentra suelo. Si el chasis apoya la panza antes
 * de que las ruedas lleguen abajo, no hay contacto, no hay traccion y el coche
 * se queda quieto acelerando a fondo.
 *
 * La cuenta: el suelo queda a `|ALTURA_EJE| + SUSPENSION_REPOSO + RADIO_RUEDA`
 * por debajo del origen del chasis, y eso tiene que ser MAS que la semialtura
 * del chasis. Aqui son 0,64 m contra 0,39: quedan 25 cm de bajos libres, que es
 * lo que tiene un coche de calle.
 */
const ALTURA_EJE = -0.18;
const SUSPENSION_REPOSO = 0.14;
export const ALTURA_REPOSO = -ALTURA_EJE + SUSPENSION_REPOSO + RADIO_RUEDA;

/** Alto de la cabina y donde se apoya, sobre el techo del chasis. */
const ALTO_CABINA = 0.46;
const CABINA_Y = ALTO / 2 + ALTO_CABINA / 2;

/** Altura total sobre el suelo. Un utilitario real ronda 1,45 m. */
export const ALTURA_TECHO = ALTURA_REPOSO + CABINA_Y + ALTO_CABINA / 2;

/** Suspension. Corta y dura: es un arcade, no un todoterreno. */
const SUSPENSION_RIGIDEZ = 30;
const SUSPENSION_COMPRESION = 0.9;
const SUSPENSION_RELAJACION = 0.85;
const SUSPENSION_RECORRIDO = 0.12;

/** Agarre lateral. Alto a proposito: derrapar no es la gracia de este hito. */
const AGARRE = 2.6;

/** Separacion de las ruedas respecto a los extremos del chasis. */
const VOLADIZO = 0.7;

/**
 * Medio ancho de via. Casi a ras de la carroceria, como en un coche de verdad:
 * la rueda asoma tres centimetros y no queda el chasis flotando entre ruedas.
 */
const VIA = ANCHO / 2 - ANCHO_RUEDA / 2 + 0.03;

/**
 * Cuanto se baja el centro de masas respecto al centro del chasis.
 *
 * Es el ajuste que mas se nota de todos. Con el centro de masas en el medio de
 * la caja el coche vuelca en cuanto giras; bajandolo hasta la altura de los
 * ejes, se agarra. Un coche de verdad hace lo mismo por otros motivos.
 */
const CENTRO_MASAS_Y = ALTURA_EJE;

/**
 * Inercia de una caja maciza, `m/12 * (a^2 + b^2)` por eje. Se da a mano porque
 * el centro de masas tambien se da a mano, y Rapier pide las dos cosas juntas.
 */
const INERCIA = Object.freeze({
  x: (MASA / 12) * (ALTO * ALTO + LARGO * LARGO),
  y: (MASA / 12) * (ANCHO * ANCHO + LARGO * LARGO),
  z: (MASA / 12) * (ANCHO * ANCHO + ALTO * ALTO),
});

/**
 * @param {number} guinada
 * @returns {{x: number, y: number, z: number, w: number}}
 */
function giroEnY(guinada) {
  return { x: 0, y: Math.sin(guinada / 2), z: 0, w: Math.cos(guinada / 2) };
}

/**
 * Crea el coche y lo mete en el mundo y en la escena.
 *
 * @param {Object} datos
 * @param {THREE.Scene} datos.escena
 * @param {Awaited<ReturnType<import('./mundo-fisico.js').crearMundoFisico>>} datos.mundoFisico
 * @param {{x: number, y: number, z: number}} datos.posicion  En escena
 * @param {number} datos.guinada
 */
export function crearCoche({ escena, mundoFisico, posicion, guinada }) {
  const { RAPIER, mundo } = mundoFisico;

  // --- Chasis
  const cuerpo = mundo.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(posicion.x, posicion.y, posicion.z)
      .setRotation(giroEnY(guinada))
      .setLinearDamping(0.12)
      .setAngularDamping(1.2)
      // La masa se declara aqui y no por densidad del colisionador, porque es
      // la unica forma de bajar el centro de masas por su cuenta.
      .setAdditionalMassProperties(
        MASA,
        { x: 0, y: CENTRO_MASAS_Y, z: 0 },
        INERCIA,
        { x: 0, y: 0, z: 0, w: 1 },
      )
      // A 100 km/h el coche recorre medio metro por paso de simulacion. Sin
      // deteccion continua se mete dentro de una fachada antes de que nadie
      // note el contacto, y salir de ahi es un escopetazo: se vio llegar a 180
      // km/h de rebote contra un edificio del casco viejo.
      .setCcdEnabled(true)
      // Un coche parado que se duerme no reacciona al acelerador hasta que algo
      // lo toca. Es el bug mas desconcertante que puede tener un coche.
      .setCanSleep(false),
  );

  // Densidad cero: la masa ya esta declarada arriba, y sumar la del colisionador
  // volveria a subir el centro de masas al centro de la caja.
  // Restitucion cero: chocar contra una pared para el coche, no lo devuelve.
  mundo.createCollider(
    RAPIER.ColliderDesc.cuboid(ANCHO / 2, ALTO / 2, LARGO / 2)
      .setDensity(0)
      .setFriction(0.4)
      .setRestitution(0),
    cuerpo,
  );

  // --- Vehiculo. El eje de la rueda va en -X y la suspension cuelga en -Y.
  const vehiculo = mundo.createVehicleController(cuerpo);
  // El eje de la rueda decide cual es el "adelante" del vehiculo para Rapier:
  // lo deduce del producto vectorial con la direccion de la suspension. Con el
  // eje en -X, el empuje sale hacia +Z, que aqui es hacia ATRAS. Comprobado en
  // el navegador, no deducido: el coche arrancaba marcha atras, la maquina de
  // estados lo leia como tal y clavaba el freno, y se quedaba tartamudeando.
  const ejeRueda = { x: 1, y: 0, z: 0 };
  const abajo = { x: 0, y: -1, z: 0 };

  // Adelante es -Z: las delanteras llevan Z negativa.
  const sitios = [
    { x: -VIA, y: ALTURA_EJE, z: -(LARGO / 2 - VOLADIZO) },
    { x: VIA, y: ALTURA_EJE, z: -(LARGO / 2 - VOLADIZO) },
    { x: -VIA, y: ALTURA_EJE, z: LARGO / 2 - VOLADIZO },
    { x: VIA, y: ALTURA_EJE, z: LARGO / 2 - VOLADIZO },
  ];

  for (const sitio of sitios) {
    vehiculo.addWheel(sitio, abajo, ejeRueda, SUSPENSION_REPOSO, RADIO_RUEDA);
  }
  for (let i = 0; i < sitios.length; i += 1) {
    vehiculo.setWheelSuspensionStiffness(i, SUSPENSION_RIGIDEZ);
    vehiculo.setWheelSuspensionCompression(i, SUSPENSION_COMPRESION);
    vehiculo.setWheelSuspensionRelaxation(i, SUSPENSION_RELAJACION);
    vehiculo.setWheelMaxSuspensionTravel(i, SUSPENSION_RECORRIDO);
    vehiculo.setWheelFrictionSlip(i, AGARRE);
  }

  // --- Malla. Un color que NO sea el de la ciudad: sobre un casco viejo beige
  // hay que encontrar el coche de un vistazo.
  const objeto = new THREE.Group();

  const carroceria = new THREE.Mesh(
    new THREE.BoxGeometry(ANCHO, ALTO, LARGO),
    new THREE.MeshLambertMaterial({ color: 0xc8503c }),
  );
  objeto.add(carroceria);

  const cabina = new THREE.Mesh(
    new THREE.BoxGeometry(ANCHO * 0.86, ALTO_CABINA, LARGO * 0.48),
    new THREE.MeshLambertMaterial({ color: 0x2a3340 }),
  );
  cabina.position.set(0, CABINA_Y, LARGO * 0.04);
  objeto.add(cabina);

  const geometriaRueda = new THREE.CylinderGeometry(RADIO_RUEDA, RADIO_RUEDA, ANCHO_RUEDA, 14);
  geometriaRueda.rotateZ(Math.PI / 2);
  const materialRueda = new THREE.MeshLambertMaterial({ color: 0x14161a });

  const ruedas = sitios.map((sitio) => {
    const rueda = new THREE.Mesh(geometriaRueda, materialRueda);
    // Donde queda el eje con la suspension en reposo.
    rueda.position.set(sitio.x, ALTURA_EJE - SUSPENSION_REPOSO, sitio.z);
    objeto.add(rueda);
    return rueda;
  });

  escena.add(objeto);

  const conduccion = crearConduccion();
  let giroRueda = 0;

  const cuaternion = new THREE.Quaternion();
  const adelanteMundo = new THREE.Vector3();

  /**
   * Velocidad a lo largo del coche, en metros por segundo y CON SIGNO.
   *
   * Se calcula aqui en vez de usar `currentVehicleSpeed()` a proposito. El
   * signo de ese metodo depende de como Rapier deduzca el eje "adelante" del
   * vehiculo a partir del eje de las ruedas, y si sale al reves del que usa
   * este codigo pasa algo que cuesta muchisimo diagnosticar: el coche arranca,
   * la maquina de estados lee velocidad NEGATIVA, cree que va marcha atras y
   * clava el freno. El coche se queda tartamudeando a 3 km/h.
   *
   * Proyectar la velocidad lineal sobre el "adelante" del chasis no depende de
   * ningun convenio ajeno: adelante es -Z, y punto.
   *
   * @returns {number}
   */
  function velocidadLongitudinal() {
    const r = cuerpo.rotation();
    cuaternion.set(r.x, r.y, r.z, r.w);
    adelanteMundo.set(0, 0, -1).applyQuaternion(cuaternion);
    const v = cuerpo.linvel();
    return v.x * adelanteMundo.x + v.y * adelanteMundo.y + v.z * adelanteMundo.z;
  }

  return {
    objeto,
    cuerpo,

    /** Metros por segundo a lo largo del coche. Negativa, marcha atras. */
    get velocidad() {
      return velocidadLongitudinal();
    },

    /**
     * Cuantas ruedas tocan suelo.
     *
     * No es adorno: un vehiculo de rayos SOLO empuja por las ruedas que
     * encuentran suelo. Si esto marca cero, el coche acelera a fondo y no se
     * mueve, y nada mas en la pantalla lo explica.
     */
    get ruedasEnSuelo() {
      let cuenta = 0;
      for (let i = 0; i < sitios.length; i += 1) {
        if (vehiculo.wheelIsInContact(i)) {
          cuenta += 1;
        }
      }
      return cuenta;
    },

    /** Posicion en escena, para la camara y para el origen flotante. */
    get posicion() {
      return cuerpo.translation();
    },

    /** Guinada actual, sacada del cuaternion del chasis. */
    get guinada() {
      const r = cuerpo.rotation();
      return new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(r.x, r.y, r.z, r.w),
        'YXZ',
      ).y;
    },

    /**
     * Sujeto de rebase. `true` no es opcional: el chasis es dinamico y, si
     * estuviera dormido, se quedaria en el sitio viejo mientras la ciudad
     * entera se mueve un kilometro. Es decir, dentro de un edificio.
     *
     * @param {{x: number, z: number}} delta
     * @returns {void}
     */
    rebasar(delta) {
      cuerpo.setTranslation(desplazar(cuerpo.translation(), delta), true);
    },

    /**
     * Pone el coche de pie donde esta, mirando a donde miraba.
     *
     * Con edificios convexos y bordillos de cero centimetros, volcar es
     * cuestion de tiempo, y no tener como levantarse acaba la partida.
     *
     * @returns {void}
     */
    enderezar() {
      const posicionActual = cuerpo.translation();
      cuerpo.setRotation(giroEnY(this.guinada), true);
      cuerpo.setTranslation({ ...posicionActual, y: posicionActual.y + 1.2 }, true);
      cuerpo.setLinvel({ x: 0, y: 0, z: 0 }, true);
      cuerpo.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },

    /**
     * Un fotograma de conduccion. Se llama ANTES de `mundoFisico.paso`.
     *
     * @param {{acelera: boolean, frena: boolean, izquierda: boolean, derecha: boolean}} teclas
     * @param {number} segundos
     * @returns {void}
     */
    actualizar(teclas, segundos) {
      const velocidad = velocidadLongitudinal();
      const mando = conduccion.actualizar({ ...teclas, velocidad }, segundos);

      for (let i = 0; i < sitios.length; i += 1) {
        // Traccion a las cuatro: en un arcade perdona mucho mas que la trasera,
        // que se va de atras en cuanto aceleras en una curva.
        vehiculo.setWheelEngineForce(i, mando.fuerzaMotor / sitios.length);
        vehiculo.setWheelBrake(i, mando.freno / sitios.length);
        // Direccion solo en las delanteras, que son las dos primeras.
        vehiculo.setWheelSteering(i, i < 2 ? mando.direccion : 0);
      }

      vehiculo.updateVehicle(segundos);

      // --- Malla al dia
      const t = cuerpo.translation();
      const r = cuerpo.rotation();
      objeto.position.set(t.x, t.y, t.z);
      objeto.quaternion.set(r.x, r.y, r.z, r.w);

      // Las ruedas se dibujan en su sitio de reposo, girando y con el volante
      // puesto. No se lee la suspension de Rapier: para lo que se ve a esta
      // distancia no compensa, y el bamboleo del chasis ya cuenta la historia.
      giroRueda -= (velocidadLongitudinal() / RADIO_RUEDA) * segundos;
      for (const [i, rueda] of ruedas.entries()) {
        rueda.rotation.set(giroRueda, i < 2 ? mando.direccion : 0, 0, 'YXZ');
      }
    },

    /** @returns {void} */
    destruir() {
      escena.remove(objeto);
      carroceria.geometry.dispose();
      cabina.geometry.dispose();
      geometriaRueda.dispose();
      carroceria.material.dispose();
      cabina.material.dispose();
      materialRueda.dispose();
      mundo.removeRigidBody(cuerpo);
    },
  };
}
