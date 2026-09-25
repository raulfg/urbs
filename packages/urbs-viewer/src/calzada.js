/**
 * Calzada: de un eje de via a los dos bordes de su asfalto.
 *
 * El MVP tendia una cinta INDEPENDIENTE por segmento. Cada segmento aportaba
 * sus cuatro esquinas, y en cada cambio de direccion los dos rectangulos se
 * solapaban por dentro del giro y dejaban una cuna descubierta por fuera. Desde
 * el aire se disimula; a ras de suelo, conduciendo, es lo primero que se ve.
 *
 * La solucion es el INGLETE: en cada vertice, los dos bordes no se cortan a
 * escuadra sino que se prolongan hasta encontrarse en un solo punto, sobre la
 * bisectriz del giro. Un punto por vertice en lugar de dos por segmento: el
 * hueco no se tapa, deja de existir.
 *
 * Lo que hay aqui es aritmetica plana sobre (este, norte). No sabe que es un
 * triangulo ni que existe three.js, y por eso se puede probar entera en Node.
 * Quien la use decide a que altura la pone y con que devanado la triangula.
 */

/**
 * Cuanto puede alargarse un inglete, en multiplos de la semianchura.
 *
 * El factor exacto es `1 / cos(angulo/2)`, que tiende a INFINITO segun el giro
 * se acerca a los 180 grados. Una horquilla de 178 grados pide 57 veces la
 * semianchura: una espiga de 285 m saliendo de una calle de 10 m. El recorte
 * no es una aproximacion comoda, es la unica forma de que el dato real —que
 * tiene horquillas de verdad, y tambien errores de digitalizacion— no produzca
 * geometria absurda.
 *
 * Cuatro deja pasar limpios todos los giros de hasta ~151 grados, que cubre
 * cualquier esquina urbana; lo que recorta son las horquillas y la basura.
 */
export const LIMITE_INGLETE = 4;

/**
 * Cuanto se prolonga cada extremo de una polilinea, en multiplos de la anchura.
 *
 * Un cruce donde se juntan tres o mas calles NO se puede ingletar: en el dato
 * cada calle es una polilinea suelta y nadie sabe aqui quien mas llega a ese
 * nodo. Ingletar exigiria el grafo entero de la ciudad y una decision sobre que
 * hacer con las tres calzadas que se pisan.
 *
 * Lo honesto y barato es prolongar cada extremo media anchura a lo largo de su
 * propia direccion. Las calzadas se solapan sobre el nodo —todas estan a la
 * misma altura, asi que el solape no se ve— y el pico descubierto de cada
 * esquina queda tapado. El precio es que una calle sin salida sobresale unos
 * metros; a cambio se arreglan todos los cruces, que son muchisimos mas.
 *
 * Tambien tapa las uniones de las piezas que `partirPolilinea` corta en el
 * pipeline, que comparten vertice pero llegan al visor como tramos distintos.
 */
export const PROLONGACION_EXTREMO = 0.5;

/** Por debajo de esto, dos vertices son el mismo. Decimas de milimetro. */
export const TOLERANCIA_VERTICE = 1e-4;

/**
 * Cuando `1 + cos` baja de aqui, las dos normales son opuestas y la bisectriz
 * es el vector cero: no hay direccion de inglete que calcular, solo ruido.
 */
const UMBRAL_REVERSO = 1e-9;

const VACIO = Object.freeze({
  eje: new Float32Array(0),
  derecha: new Float32Array(0),
  izquierda: new Float32Array(0),
});

/**
 * Quita los vertices repetidos seguidos.
 *
 * No es cosmetica: un segmento de largo cero no tiene direccion, y dividir por
 * su largo mete un NaN que se propaga por toda la malla. El dato real los trae
 * —vertices duplicados al importar, y los extremos compartidos de las piezas
 * que parte el pipeline—, asi que esto corre siempre, no solo en las pruebas.
 *
 * El vertice de cierre de un eje que vuelve sobre si mismo NO se toca: no es un
 * anillo, es una polilinea, y quitarselo la abriria.
 *
 * @param {Float32Array|number[]} eje  Pares [este, norte] seguidos
 * @param {number} [tolerancia]
 * @returns {Float32Array}
 */
export function limpiarEje(eje, tolerancia = TOLERANCIA_VERTICE) {
  const puntos = eje instanceof Float32Array ? eje : Float32Array.from(eje);
  if (puntos.length < 2) {
    return new Float32Array(0);
  }

  const salida = [puntos[0], puntos[1]];
  for (let i = 2; i + 1 < puntos.length; i += 2) {
    const este = salida[salida.length - 2];
    const norte = salida[salida.length - 1];
    if (Math.hypot(puntos[i] - este, puntos[i + 1] - norte) > tolerancia) {
      salida.push(puntos[i], puntos[i + 1]);
    }
  }
  return Float32Array.from(salida);
}

/**
 * Bordes izquierdo y derecho de la calzada de un eje.
 *
 * Devuelve TRES arrays de la misma longitud, un punto por vertice del eje ya
 * limpio. Se cumple siempre que `eje[i]` es el punto medio de `derecha[i]` y
 * `izquierda[i]`: el inglete desplaza los dos bordes lo mismo en sentidos
 * opuestos, asi que ingletar no descentra la calzada.
 *
 * "Derecha" es la derecha de la marcha: yendo al este, el sur.
 *
 * @param {Float32Array|number[]} eje  Pares [este, norte] seguidos
 * @param {number} anchura  Metros
 * @param {Object} [opciones]
 * @param {number} [opciones.limiteInglete]  Multiplos de la semianchura
 * @param {number} [opciones.prolongacion]   Multiplos de la anchura, por extremo
 * @returns {{eje: Float32Array, derecha: Float32Array, izquierda: Float32Array}}
 */
export function bordesDeCalzada(eje, anchura, opciones = {}) {
  const { limiteInglete = LIMITE_INGLETE, prolongacion = PROLONGACION_EXTREMO } = opciones;

  if (!(Number.isFinite(anchura) && anchura > 0)) {
    throw new RangeError(
      `bordesDeCalzada: la \`anchura\` debe ser un numero positivo de metros, y es ${anchura}`,
    );
  }
  if (!(Number.isFinite(limiteInglete) && limiteInglete >= 1)) {
    throw new RangeError(
      'bordesDeCalzada: el `limiteInglete` debe ser >= 1; por debajo encogeria la calzada en las esquinas',
    );
  }

  const centro = limpiarEje(eje);
  const vertices = centro.length / 2;
  if (vertices < 2) {
    return VACIO;
  }

  const mitad = anchura / 2;
  const segmentos = vertices - 1;

  // Direcciones unitarias por segmento. En float64: son la base de todo lo
  // demas y no cuesta nada mantenerlas exactas hasta el volcado final.
  const dirEste = new Float64Array(segmentos);
  const dirNorte = new Float64Array(segmentos);
  for (let s = 0; s < segmentos; s += 1) {
    const de = centro[(s + 1) * 2] - centro[s * 2];
    const dn = centro[(s + 1) * 2 + 1] - centro[s * 2 + 1];
    // `limpiarEje` garantiza que el largo no es cero.
    const largo = Math.hypot(de, dn);
    dirEste[s] = de / largo;
    dirNorte[s] = dn / largo;
  }

  const ejeSalida = new Float32Array(vertices * 2);
  const derecha = new Float32Array(vertices * 2);
  const izquierda = new Float32Array(vertices * 2);

  for (let i = 0; i < vertices; i += 1) {
    // En los extremos, entrada y salida son el mismo segmento: el coseno vale
    // uno, la escala vale uno y el extremo sale a escuadra sin caso especial.
    const entra = i === 0 ? 0 : i - 1;
    const sale = i === segmentos ? segmentos - 1 : i;

    // Normal derecha de una direccion (de, dn): (dn, -de).
    const n1e = dirNorte[entra];
    const n1n = -dirEste[entra];
    const n2e = dirNorte[sale];
    const n2n = -dirEste[sale];

    const coseno = n1e * n2e + n1n * n2n;

    let ie = n1e;
    let iN = n1n;
    let escala = 1;

    if (1 + coseno > UMBRAL_REVERSO) {
      const be = n1e + n2e;
      const bn = n1n + n2n;
      const largo = Math.hypot(be, bn);
      ie = be / largo;
      iN = bn / largo;
      // `1 / cos(angulo/2)`, escrito sin trigonometria: la bisectriz unitaria
      // proyecta `sqrt((1 + coseno) / 2)` sobre cualquiera de las dos normales.
      escala = Math.min(Math.sqrt(2 / (1 + coseno)), limiteInglete);
    }
    // Si no, las normales son opuestas (inversion de 180 grados): se escuadra
    // con la normal de entrada. Es lo unico finito que se puede hacer ahi.

    const salto = mitad * escala;
    let este = centro[i * 2];
    let norte = centro[i * 2 + 1];

    // Prolongacion de extremos. Va sobre el eje Y sobre los dos bordes, para no
    // romper la invariante de que el eje es su punto medio.
    if (prolongacion !== 0 && (i === 0 || i === segmentos)) {
      const largo = prolongacion * anchura * (i === 0 ? -1 : 1);
      const s = i === 0 ? 0 : segmentos - 1;
      este += dirEste[s] * largo;
      norte += dirNorte[s] * largo;
    }

    ejeSalida[i * 2] = este;
    ejeSalida[i * 2 + 1] = norte;
    derecha[i * 2] = este + ie * salto;
    derecha[i * 2 + 1] = norte + iN * salto;
    izquierda[i * 2] = este - ie * salto;
    izquierda[i * 2 + 1] = norte - iN * salto;
  }

  return { eje: ejeSalida, derecha, izquierda };
}

/** Un tramo mas corto que esto no es sitio donde arrancar, por ancho que sea. */
export const LARGO_MINIMO_SALIDA = 15;

/**
 * Donde plantar el coche dentro de una celda: sobre su calle MAS ANCHA.
 *
 * Nacer en el centro geometrico de una celda del casco viejo es nacer dentro de
 * un edificio una de cada dos veces, y un coche que aparece dentro de un casco
 * convexo sale disparado o se queda encajado.
 *
 * Se ordena por ANCHURA y no por longitud, y eso se aprendio mirando: con el
 * tramo mas largo, el coche arrancaba, recorria seis metros y se clavaba contra
 * una fachada. En un casco medieval las calles largas son callejones de tres
 * metros, y ademas el colisionador de un edificio es su casco CONVEXO, que
 * rellena escotaduras y se come todavia mas hueco. Lo que decide si un coche
 * cabe es el ancho, no el largo.
 *
 * Entre los tramos igual de anchos gana el mas largo, y se descartan los que no
 * lleguen a `LARGO_MINIMO_SALIDA`: una avenida de doce metros partida en un
 * tocon de dos no es sitio donde empezar.
 *
 * Se devuelve tambien la guinada del tramo, para que el coche nazca mirando a
 * lo largo de la calle y no de traves contra una fachada.
 *
 * @param {Object} vistas  Lo que devuelve `vistasDeCelda`
 * @returns {{x: number, z: number, guinada: number, anchura: number}|null}
 */
export function puntoDeSalida(vistas) {
  const { cabecera, tramos } = vistas;

  let mejorAnchura = -1;
  let mejorLargo = 0;
  let mejor = null;

  for (let i = 0; i < cabecera.numeroTramos; i += 1) {
    const desde = tramos.inicioVertice[i];
    const hasta = tramos.inicioVertice[i + 1];
    const anchura = tramos.anchura[i];

    for (let v = desde; v + 1 < hasta; v += 1) {
      const e1 = tramos.vertices[v * 2];
      const n1 = tramos.vertices[v * 2 + 1];
      const e2 = tramos.vertices[(v + 1) * 2];
      const n2 = tramos.vertices[(v + 1) * 2 + 1];

      const de = e2 - e1;
      const dn = n2 - n1;
      const largo = Math.hypot(de, dn);
      if (largo < LARGO_MINIMO_SALIDA) {
        continue;
      }
      if (anchura < mejorAnchura || (anchura === mejorAnchura && largo <= mejorLargo)) {
        continue;
      }

      mejorAnchura = anchura;
      mejorLargo = largo;
      // Centro del segmento: el punto mas lejos de cualquiera de sus dos
      // extremos, que es donde menos probable es haber pillado un cruce.
      mejor = {
        x: (e1 + e2) / 2,
        z: -(n1 + n2) / 2,
        // Guinada cero mira al norte (-Z), asi que una direccion (de, dn)
        // corresponde a `atan2(de, dn)`.
        guinada: Math.atan2(de, dn),
        anchura,
      };
    }
  }

  return mejor;
}
