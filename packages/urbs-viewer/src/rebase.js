/**
 * Rebase: mover el mundo entero de una pieza, en un solo fotograma.
 *
 * La regla 3 de la decision 0001 dice que el grafo de escena y el mundo de
 * fisicas se rebasan JUNTOS. Mientras solo habia graficos era un comentario;
 * con Rapier delante es la parte mas peligrosa del motor, porque el sintoma de
 * incumplirla no se parece a la causa: la ciudad se ve bien, y el coche se cae
 * por el suelo o aparece dentro de un edificio a un kilometro de donde estaba.
 *
 * La forma de no incumplirla no es acordarse, es no poder: aqui NADIE llama a
 * `rebasarSiHaceFalta` por su cuenta. Se llama a `aplicar`, y `aplicar` mueve el
 * ancla y avisa a todos los sujetos apuntados antes de devolver el control. Un
 * sujeto que se olvide de apuntarse se nota enseguida; un sujeto al que se
 * avise un fotograma tarde, no.
 */

/**
 * Aplica el delta de un rebase a una traslacion.
 *
 * Se RESTA: el ancla se muda hacia donde esta el jugador, asi que todo lo que
 * ya estaba colocado tiene que retroceder lo mismo para quedarse donde estaba.
 * La altura no se toca — el origen flotante solo se mueve en el plano.
 *
 * @param {{x: number, y?: number, z: number}} traslacion
 * @param {{x: number, z: number}} delta
 * @returns {{x: number, y: number, z: number}}
 */
export function desplazar({ x, y = 0, z }, delta) {
  return { x: x - delta.x, y, z: z - delta.z };
}

/**
 * @param {unknown} sujeto
 * @returns {{rebasar: (delta: {x: number, z: number}) => void}}
 */
function validarSujeto(sujeto) {
  if (sujeto === null || typeof sujeto !== 'object' || typeof (/** @type {any} */ (sujeto).rebasar) !== 'function') {
    throw new TypeError(
      'crearRebase: cada sujeto debe tener un metodo `rebasar(delta)`; lo que no se rebasa se queda atras',
    );
  }
  return /** @type {any} */ (sujeto);
}

/**
 * Coordina el rebase del origen flotante con todo lo que tiene que moverse.
 *
 * @param {Object} datos
 * @param {ReturnType<import('./origen-flotante.js').crearOrigenFlotante>} datos.origen
 * @param {Array<{rebasar: (delta: {x: number, z: number}) => void}>} datos.sujetos
 */
export function crearRebase({ origen, sujetos }) {
  if (!Array.isArray(sujetos) || sujetos.length === 0) {
    throw new TypeError(
      'crearRebase: hacen falta `sujetos`; mudar el ancla sin mover a nadie deja la ciudad desplazada',
    );
  }

  const apuntados = sujetos.map(validarSujeto);
  let rebases = 0;

  return {
    get rebases() {
      return rebases;
    },

    /**
     * Apunta un sujeto que nace despues (el coche, por ejemplo).
     *
     * @param {{rebasar: (delta: {x: number, z: number}) => void}} sujeto
     * @returns {void}
     */
    apuntar(sujeto) {
      apuntados.push(validarSujeto(sujeto));
    },

    /**
     * Rebasa si hace falta y avisa a todo el mundo ANTES de devolver.
     *
     * Si un sujeto falla, la excepcion sube tal cual. Tragarsela dejaria el
     * ancla mudada y media ciudad sin mover, que es exactamente el estado
     * incoherente que toda esta pieza existe para evitar.
     *
     * @param {{x: number, z: number}} camara  Posicion en escena
     * @returns {{rebasado: boolean, delta: {x: number, z: number}}}
     */
    aplicar(camara) {
      const resultado = origen.rebasarSiHaceFalta(camara);
      if (!resultado.rebasado) {
        return resultado;
      }

      for (const sujeto of apuntados) {
        sujeto.rebasar(resultado.delta);
      }
      rebases += 1;
      return resultado;
    },
  };
}
