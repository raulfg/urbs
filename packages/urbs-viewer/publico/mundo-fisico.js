/**
 * El mundo de Rapier: lo unico del visor que sabe que existe la fisica.
 *
 * Se usa `@dimforge/rapier3d-compat` y no `@dimforge/rapier3d`. El paquete
 * normal esta pensado para un empaquetador: sus imports internos van sin
 * extension y trae un import de wasm que el ESM nativo del navegador no sabe
 * resolver. El compat es un solo archivo con el wasm incrustado en base64, que
 * es exactamente lo que necesita un proyecto sin paso de compilacion. A cambio
 * hay que `await RAPIER.init()` ANTES de tocar cualquier cosa de la libreria.
 *
 * Reglas que se cumplen aqui y que no son opcionales:
 *
 * 1. El colisionador sale de la huella, no de la malla (ver `../src/colisiones.js`).
 * 2. Los colisionadores entran y salen CON su celda, igual que la geometria.
 * 3. Al quitar un colisionador se despierta lo que dormia encima. Si no, un
 *    coche parado sobre una celda que se descarga se queda dormido sobre un
 *    suelo que ya no existe y no se entera de que esta cayendo.
 * 4. Los manejadores de colisionador se RECICLAN al borrarlos. Aqui no se
 *    guarda ni uno: los mapas van por clave de celda, y los objetos de Rapier
 *    viven dentro de la entrada de su celda y mueren con ella.
 * 5. El rebase mueve este mundo en el MISMO fotograma que el grafo de escena.
 *    De eso se encarga `../src/rebase.js`, que llama a `rebasar` aqui.
 */

import RAPIER from '@dimforge/rapier3d-compat';

import { crearColaAmortizada } from '../src/colisiones.js';
import { desplazar } from '../src/rebase.js';

/** Metros por segundo al cuadrado. La de la Tierra. */
export const GRAVEDAD = -9.81;

/**
 * Semilado del suelo, en metros. Veinte kilometros de lado cubren cualquier
 * territorio que quepa en el radio de streaming con muchisimo margen.
 */
export const SEMILADO_SUELO = 10000;

/** Grosor de la losa del suelo. Una losa fina se atraviesa a velocidad alta. */
export const GROSOR_SUELO = 20;

/** Cuantas retiradas se hacen como mucho por fotograma. */
export const RETIRADAS_POR_FOTOGRAMA = 96;

/** Paso fijo de la simulacion y tope de subpasos por fotograma. */
export const PASO_FIJO = 1 / 60;
const SUBPASOS_MAXIMOS = 3;

/**
 * Crea el mundo de fisicas. Es asincrono porque hay que inicializar el wasm.
 *
 * @param {Object} [opciones]
 * @param {number} [opciones.retiradasPorFotograma]
 */
export async function crearMundoFisico(opciones = {}) {
  const { retiradasPorFotograma = RETIRADAS_POR_FOTOGRAMA } = opciones;

  await RAPIER.init();

  const mundo = new RAPIER.World({ x: 0, y: GRAVEDAD, z: 0 });
  mundo.timestep = PASO_FIJO;

  // --- Suelo. Todavia no hay MDT, asi que el suelo es el plano y = 0, y eso
  // es lo correcto para este hito, no un apano: la ciudad se genero plana.
  //
  // El suelo NO se rebasa, y es deliberado. Es uniforme e infinito en
  // intencion, asi que dejarlo clavado en el origen de la escena equivale a
  // que siga al jugador: haga lo que haga el ancla, siempre hay suelo debajo.
  // Rebasarlo solo serviria para que algun dia se acabara.
  const cuerpoSuelo = mundo.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  mundo.createCollider(
    RAPIER.ColliderDesc.cuboid(SEMILADO_SUELO, GROSOR_SUELO, SEMILADO_SUELO)
      .setTranslation(0, -GROSOR_SUELO, 0)
      .setFriction(1.4),
    cuerpoSuelo,
  );

  /** @type {Map<string, {cuerpo: any, colisionadores: any[]}>} */
  const celdas = new Map();
  const cola = crearColaAmortizada({ porFotograma: retiradasPorFotograma });

  let descartados = 0;
  let rechazadosPorRapier = 0;
  let acumulado = 0;

  /**
   * Ejecuta un lote de retiradas. Devuelve cuantas quedan.
   *
   * @param {unknown[]} lote
   * @returns {void}
   */
  function retirar(lote) {
    for (const tarea of lote) {
      if (tarea.colisionador !== undefined) {
        // `true` no es decorativo: despierta lo que dormia encima. Un cuerpo
        // dormido sobre una celda que se va no se entera de que esta cayendo.
        mundo.removeCollider(tarea.colisionador, true);
      } else {
        mundo.removeRigidBody(tarea.cuerpo);
      }
    }
  }

  return {
    RAPIER,
    mundo,

    get celdas() {
      return celdas.size;
    },
    /** Contados por Rapier, no por mi: es el detector de fugas que no miente. */
    get colisionadores() {
      return mundo.colliders.len();
    },
    get cuerpos() {
      return mundo.bodies.len();
    },
    /** Edificios sin casco posible: anillos degenerados del dato real. */
    get descartados() {
      return descartados;
    },
    /** Los que pasaron mi filtro y aun asi `convexHull` devolvio null. */
    get rechazadosPorRapier() {
      return rechazadosPorRapier;
    },
    get pendientesDeRetirada() {
      return cola.pendientes;
    },

    /**
     * @param {string} clave
     * @returns {boolean}
     */
    tieneCelda(clave) {
      return celdas.has(clave);
    },

    /**
     * Mete una celda en el mundo: un cuerpo fijo con un casco convexo por
     * edificio, colocado donde la ponga el origen flotante.
     *
     * @param {string} clave
     * @param {{nubes: Array<{indice: number, puntos: Float32Array}>, descartados: number}} colisiones
     * @param {{x: number, z: number}} desplazamiento
     * @returns {void}
     */
    anadirCelda(clave, colisiones, desplazamiento) {
      if (celdas.has(clave)) {
        return;
      }

      // Un cuerpo por CELDA, no por edificio. La celda es la unidad de carga y
      // descarga, y ademas el rebase pasa de mover cinco mil cuerpos a mover
      // cincuenta.
      const cuerpo = mundo.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(desplazamiento.x, 0, desplazamiento.z),
      );

      const colisionadores = [];
      for (const nube of colisiones.nubes) {
        // `convexHull` devuelve null con anillos degenerados, y el dato real
        // los tiene. Sin comprobarlo, `createCollider(null, ...)` revienta la
        // celda entera por un edificio mal digitalizado.
        const descriptor = RAPIER.ColliderDesc.convexHull(nube.puntos);
        if (descriptor === null) {
          rechazadosPorRapier += 1;
          continue;
        }
        colisionadores.push(mundo.createCollider(descriptor.setFriction(0.9), cuerpo));
      }

      descartados += colisiones.descartados;
      celdas.set(clave, { cuerpo, colisionadores });
    },

    /**
     * Saca una celda del mundo, sin tirones.
     *
     * La entrada se borra del mapa en el acto —para el resto del visor la
     * celda ya no esta— pero el trabajo de Rapier se reparte entre fotogramas.
     * El orden de la cola importa: primero los colisionadores y despues su
     * cuerpo, porque quitar el cuerpo invalidaria los colisionadores que aun
     * estuvieran esperando.
     *
     * @param {string} clave
     * @returns {void}
     */
    quitarCelda(clave) {
      const entrada = celdas.get(clave);
      if (entrada === undefined) {
        return;
      }
      celdas.delete(clave);
      cola.encolar(...entrada.colisionadores.map((colisionador) => ({ colisionador })));
      cola.encolar({ cuerpo: entrada.cuerpo });
    },

    /**
     * Sujeto de rebase: mueve todos los cuerpos de celda.
     *
     * Sin despertar a nadie: los cuerpos de celda son fijos, y lo que este
     * encima se mueve el mismo delta en este mismo fotograma, asi que ninguna
     * posicion relativa cambia. Quien SI hay que despertar es al coche, y de
     * eso se encarga su propio sujeto.
     *
     * @param {{x: number, z: number}} delta
     * @returns {void}
     */
    rebasar(delta) {
      // Primero se vacia la cola ENTERA. Un colisionador que espera turno
      // pertenece a un cuerpo que ya no esta en `celdas` y que por tanto no se
      // va a rebasar: se quedaria un par de fotogramas en el sitio viejo, que
      // tras el rebase es un sitio equivocado por un kilometro. Un fantasma
      // contra el que chocar. El rebase pasa una vez por kilometro recorrido y
      // ya es un fotograma caro; vaciar aqui no se nota y no deja cabos.
      while (cola.pendientes > 0) {
        retirar(cola.drenar());
      }

      for (const { cuerpo } of celdas.values()) {
        cuerpo.setTranslation(desplazar(cuerpo.translation(), delta), false);
      }
    },

    /**
     * Avanza la simulacion y drena la cola de retiradas.
     *
     * @param {number} segundos  Tiempo del fotograma, ya acotado
     * @returns {void}
     */
    paso(segundos) {
      retirar(cola.drenar());

      // Paso fijo con acumulador: un fotograma largo no puede convertirse en
      // un salto de integracion que meta el coche dentro de un edificio.
      acumulado = Math.min(acumulado + segundos, PASO_FIJO * SUBPASOS_MAXIMOS);
      while (acumulado >= PASO_FIJO) {
        mundo.step();
        acumulado -= PASO_FIJO;
      }
    },
  };
}
