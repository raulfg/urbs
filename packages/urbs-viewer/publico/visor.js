/**
 * El visor: montar la escena y no soltar el bucle.
 *
 * Todo lo que se puede probar sin navegador vive en `../src/`. Lo que queda
 * aqui es pegamento —crear el renderer, atar el bucle, escribir en el DOM— y
 * esta escrito para leerse de un tiron, porque no hay prueba que lo cubra.
 *
 * Es un MVP deliberado: extrusiones planas sobre huellas reales, sin fisicas,
 * sin trafico, sin fachadas y sin terreno. Lo que demuestra es que la cadena
 * entera funciona de punta a punta: OSM -> celdas -> navegador.
 */

import * as THREE from 'three';

import { vistasDeCelda } from 'urbs-core';

import {
  CONSTANTE_PERSECUCION,
  ADELANTO_MIRADA,
  factorDeSuavizado,
  puntoDePersecucion,
} from '../src/camara-persecucion.js';
import { COLOR_POR_CONFIANZA } from '../src/geometria.js';
import { puntosDeSalida } from '../src/calzada.js';
import { ALTO, ALTURA_REPOSO, ANCHO, LARGO, crearCoche } from './coche.js';
import { crearGestorDeCeldas } from './gestor-celdas.js';
import { crearGestorDeColisiones } from './gestor-colisiones.js';
import { crearMundoFisico } from './mundo-fisico.js';
import { crearOrigenFlotante, desplazamientoDeCelda } from '../src/origen-flotante.js';
import { crearRebase } from '../src/rebase.js';
import { radiosDeStreaming } from '../src/streaming.js';
import { ALTURA_MINIMA, crearControles } from './controles.js';

/** Territorio que se abre por defecto; `?territorio=` lo cambia. */
const TERRITORIO_POR_DEFECTO = 'marineda-casco-historico';

/** Donde escribe el pipeline. */
const RAIZ_CELDAS = '/datos/celdas';

/**
 * Nombre del indice. Lo decide el pipeline (`NOMBRE_INDICE` en
 * `urbs-pipeline/src/indice.js`); aqui se repite porque ese modulo importa
 * `node:fs` y no puede viajar al navegador.
 */
const NOMBRE_INDICE = 'indice.json';

/**
 * Radios de streaming. El de fisicas es MAYOR que el de render, y la funcion lo
 * comprueba: si no, se conduce hasta el borde del mundo de colisiones y se cae.
 */
const RADIOS = radiosDeStreaming();

/**
 * El plano de apertura.
 *
 * El MVP arrancaba a 320 m mirando 49 grados hacia abajo, y desde ahi esta
 * ciudad no se ve: la mediana de sus edificios son 18 m, o sea que la camara
 * estaba a DIECIOCHO VECES la altura de lo que venia a ensenar. Lo que se veia
 * eran tejados, y los tejados no cuentan la altura de nada. Entre el primer y
 * el tercer cuartil hay 9 m de diferencia, y 9 m a 320 m de distancia no son
 * nada.
 *
 * La altura la cuentan las FACHADAS recortadas contra el cielo. Por eso ahora
 * se arranca a 55 m —unas tres veces la mediana, suficiente para ver por encima
 * de la primera manzana sin perder el perfil de las de detras— y con solo 17
 * grados de cabeceo, que deja media pantalla de horizonte. Valores elegidos
 * mirando la pantalla, no dividiendo el numero anterior.
 *
 * Esto es el plano de APERTURA. La camara libre sigue subiendo todo lo que se
 * quiera con R, y el plano lejano no se ha tocado.
 */
const ALTURA_INICIAL = 55;
const CABECEO_INICIAL = -0.3;

const $ = (id) => document.getElementById(id);

/**
 * @param {string} titulo
 * @param {string} texto
 * @returns {void}
 */
function avisar(titulo, texto) {
  $('aviso-titulo').textContent = titulo;
  $('aviso-texto').textContent = texto;
  $('aviso').hidden = false;
}

/**
 * Pinta la leyenda de colores y los creditos. Las atribuciones NO estan
 * escritas a mano: salen del indice, que las saca de los proveedores que de
 * verdad han generado este territorio.
 *
 * @param {Object} indice
 * @returns {void}
 */
function pintarLeyenda(indice) {
  $('titulo-territorio').textContent = indice.territorio.nombre;

  const etiquetas = {
    medido: 'Altura medida',
    declarado: 'Altura declarada en la fuente',
    estimado: 'Altura estimada por el motor',
  };

  $('colores').replaceChildren(
    ...Object.entries(COLOR_POR_CONFIANZA).map(([confianza, canales]) => {
      const fila = document.createElement('li');
      const muestra = document.createElement('span');
      muestra.className = 'muestra';
      muestra.style.background = new THREE.Color(...canales).getStyle();
      fila.append(muestra, document.createTextNode(etiquetas[confianza] ?? confianza));
      return fila;
    }),
  );

  $('creditos').replaceChildren(
    ...indice.atribuciones.map((atribucion) => {
      const linea = document.createElement('div');
      if (atribucion.url) {
        const enlace = document.createElement('a');
        enlace.href = atribucion.url;
        enlace.target = '_blank';
        enlace.rel = 'noreferrer';
        enlace.textContent = atribucion.texto;
        linea.append(enlace, ` — ${atribucion.licencia}`);
      } else {
        linea.textContent = `${atribucion.texto} — ${atribucion.licencia}`;
      }
      return linea;
    }),
  );
}

/**
 * Donde plantar la camara al abrir.
 *
 * NO es el centro del territorio: mas de la mitad de este slice es mar, y el
 * centro geometrico del rectangulo cae en el agua mirando a la nada. Se elige
 * la celda con mas edificios, que es lo mas parecido a "el centro de la
 * ciudad" que se puede calcular sin saber nada de A Coruna.
 *
 * @param {Object} indice
 * @returns {{este: number, norte: number}}
 */
function celdaMasDensa(indice) {
  return indice.celdas.reduce((mejor, celda) => (celda.edificios > mejor.edificios ? celda : mejor));
}

/**
 * @param {Object} indice
 * @returns {{este: number, norte: number}}
 */
function centroUrbano(indice) {
  const lado = indice.territorio.ladoCeldaMetros;
  const densa = celdaMasDensa(indice);
  return {
    este: densa.origen.este + lado / 2,
    norte: densa.origen.norte + lado / 2,
  };
}

/**
 * Donde aparece el coche: sobre la calle mas larga de la celda mas densa.
 *
 * Se baja esa celda una vez, solo para esto. Plantar el coche en el centro de
 * la celda seria plantarlo dentro de un edificio una de cada dos veces, y un
 * cuerpo dinamico que nace dentro de un casco convexo sale disparado.
 *
 * @param {Object} indice
 * @param {string} base
 * @param {ReturnType<import('../src/origen-flotante.js').crearOrigenFlotante>} origen
 * @returns {Promise<{posicion: {x: number, y: number, z: number}, guinada: number}>}
 */
async function plazaDeSalida(indice, base, origen, mundoFisico) {
  const celda = celdaMasDensa(indice);
  const desplazamiento = desplazamientoDeCelda(celda.origen, origen.ancla);
  // A su altura de reposo mas un palmo: cae esos centimetros y la suspension
  // se asienta sola, en vez de nacer encajada o con las ruedas en el aire.
  const altura = ALTURA_REPOSO + 0.2;
  // Margen al comprobar el hueco: si el coche nace rozando una fachada, el
  // primer fotograma ya es una penetracion.
  const semiejes = { x: ANCHO / 2 + 0.4, y: ALTO / 2, z: LARGO / 2 + 0.4 };
  const reposo = { posicion: { x: desplazamiento.x, y: altura, z: desplazamiento.z }, guinada: 0 };

  try {
    const respuesta = await fetch(`${base}/${celda.archivo}`);
    if (!respuesta.ok) {
      return reposo;
    }

    const candidatos = puntosDeSalida(vistasDeCelda(await respuesta.arrayBuffer()));
    for (const salida of candidatos) {
      const posicion = {
        x: desplazamiento.x + salida.x,
        y: altura,
        z: desplazamiento.z + salida.z,
      };
      // Estar sobre el eje de una calle NO garantiza estar en hueco libre: el
      // casco convexo de un edificio rellena patios y escotaduras, y en un
      // casco medieval se come calles enteras. Un coche que nace dentro de un
      // casco sale DISPARADO, porque Rapier resuelve la penetracion
      // expulsandolo. Se prueban los candidatos hasta dar con uno limpio.
      if (mundoFisico.huecoLibre(posicion, salida.guinada, semiejes)) {
        return { posicion, guinada: salida.guinada };
      }
    }

    console.warn(
      `[urbs] ninguno de los ${candidatos.length} tramos de ${celda.clave} deja hueco para el coche; ` +
        'sale en el centro de la celda y puede nacer dentro de un edificio',
    );
    return reposo;
  } catch {
    // Que el coche no tenga una calle bonita donde nacer no es motivo para no
    // arrancar el visor.
    return reposo;
  }
}

async function arrancar() {
  const territorio =
    new URL(location.href).searchParams.get('territorio') ?? TERRITORIO_POR_DEFECTO;
  const base = `${RAIZ_CELDAS}/${territorio}`;

  const respuesta = await fetch(`${base}/${NOMBRE_INDICE}`);
  if (!respuesta.ok) {
    avisar(
      `No hay celdas de "${territorio}"`,
      `Genera el territorio primero: npm run generar -- territorios/${territorio}.json`,
    );
    return;
  }

  const indice = await respuesta.json();
  if (indice.limites === null) {
    avisar('El territorio esta vacio', 'El indice no tiene ni una celda con contenido.');
    return;
  }
  pintarLeyenda(indice);

  // --- Escena
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x10131a);
  escena.fog = new THREE.Fog(0x10131a, RADIOS.render * 0.55, RADIOS.render);

  // --- Suelo. Hasta ahora la ciudad flotaba sobre un vacio negro: sin un plano
  // debajo no hay donde apoyar la vista, las manzanas parecen recortes pegados
  // sobre la nada y cuesta reconocer el sitio aunque sea tu barrio.
  //
  // Es un plano LLANO, y eso no es un descuido: todavia no hay modelo digital
  // del terreno, asi que A Coruna —que tiene cuestas de verdad— sale plana. El
  // relieve es el siguiente hito, no este.
  //
  // No se rebasa nunca, igual que su gemelo de fisicas: es uniforme e infinito
  // en intencion, asi que dejarlo clavado en el origen de la escena equivale a
  // que siga al jugador y no se acabe jamas.
  const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(RADIOS.render * 4, RADIOS.render * 4),
    new THREE.MeshLambertMaterial({ color: 0x6e7176 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  escena.add(suelo);

  escena.add(new THREE.HemisphereLight(0xbfd4ff, 0x2b2a28, 2.1));
  const sol = new THREE.DirectionalLight(0xfff2e0, 1.5);
  sol.position.set(-0.6, 1, 0.45);
  escena.add(sol);

  const camara = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.5,
    RADIOS.render * 1.5,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.append(renderer.domElement);

  // --- Origen flotante. El ancla nace en el centro del territorio, asi que la
  // camara arranca ya cerca del cero de la escena y no hace falta rebasar
  // antes del primer fotograma.
  const centro = centroUrbano(indice);
  const origen = crearOrigenFlotante({ ancla: centro });

  camara.position.set(0, ALTURA_INICIAL, 0);
  camara.rotation.set(CABECEO_INICIAL, 0, 0, 'YXZ');

  const controles = crearControles(camara, renderer.domElement);
  const gestor = crearGestorDeCeldas({ escena, indice, base, origen, radioMetros: RADIOS.render });

  // --- Fisicas. Es lo unico asincrono del arranque: hay que inicializar el
  // wasm de Rapier antes de tocar nada suyo.
  const mundoFisico = await crearMundoFisico();
  const gestorColisiones = crearGestorDeColisiones({
    mundoFisico,
    indice,
    base,
    origen,
    radioMetros: RADIOS.fisica,
  });

  // --- Rebase. TODO lo que ocupa un sitio en el mundo se apunta aqui, y aqui
  // se mueve junto en el mismo fotograma. Es la regla 3 de la decision 0001
  // convertida en estructura: no hay forma de rebasar media ciudad.
  const rebase = crearRebase({
    origen,
    sujetos: [
      gestor,
      mundoFisico,
      {
        rebasar(delta) {
          camara.position.x -= delta.x;
          camara.position.z -= delta.z;
        },
      },
    ],
  });

  // --- Coche. Nace despues del mundo, asi que se apunta al rebase a mano.
  //
  // Antes hay que tener los colisionadores de alrededor DENTRO del mundo: la
  // eleccion del sitio de salida se hace preguntandole a Rapier si la caja del
  // coche cabe, y con el mundo vacio cabria en cualquier parte, incluida la
  // mitad de un edificio.
  gestorColisiones.actualizar(origen.ancla);
  const limite = performance.now() + 8000;
  while (gestorColisiones.cargando > 0 && performance.now() < limite) {
    await new Promise((seguir) => setTimeout(seguir, 30));
  }

  const plaza = await plazaDeSalida(indice, base, origen, mundoFisico);
  const coche = crearCoche({ escena, mundoFisico, ...plaza });
  rebase.apuntar(coche);

  // --- Modos. La camara libre y la de persecucion comparten la misma camara;
  // lo que cambia es quien la mueve.
  let conduciendo = false;
  const mirada = new THREE.Vector3();
  const deseoDeCamara = new THREE.Vector3();

  /**
   * Pone la camara detras del coche AHORA MISMO, sin suavizado.
   *
   * Al entrar en el coche la camara puede estar a un kilometro y trescientos
   * metros de altura. Suavizar desde ahi seria un viaje de varios segundos por
   * encima de la ciudad, y lo unico que ha pedido quien pulsa la tecla es
   * conducir. Salir del coche, en cambio, NO recoloca nada: la camara libre
   * arranca justo donde estaba, que es lo menos desorientador que hay.
   *
   * @returns {void}
   */
  function pegarCamaraAlCoche() {
    const punto = puntoDePersecucion(coche.posicion, coche.guinada);
    camara.position.set(punto.x, punto.y, punto.z);
  }

  function cambiarModo() {
    conduciendo = !conduciendo;
    controles.activo = !conduciendo;
    if (conduciendo) {
      pegarCamaraAlCoche();
    } else {
      // La camara libre adopta hacia donde estaba mirando la de persecucion.
      controles.sincronizar();
    }
    $('modo').textContent = conduciendo ? 'Conduciendo' : 'Volando';
    $('ayuda-vuelo').hidden = conduciendo;
    $('ayuda-coche').hidden = !conduciendo;
  }

  window.addEventListener('keydown', (evento) => {
    if (evento.code === 'KeyC') {
      cambiarModo();
    }
    if (evento.code === 'KeyR' && conduciendo) {
      coche.enderezar();
    }
  });

  window.addEventListener('resize', () => {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Bucle. Sin `THREE.Clock`, que esta obsoleto desde r186, y sin su
  // sustituto: el reloj de un bucle son dos lineas y una resta.
  let ultimoInstante = performance.now();
  let fotogramas = 0;
  let acumulado = 0;
  let fps = 0;

  renderer.setAnimationLoop(() => {
    const ahora = performance.now();
    // Acotado: una pestana en segundo plano vuelve con un salto de segundos y
    // la camara se iria al otro lado de la ciudad de golpe.
    const segundos = Math.min((ahora - ultimoInstante) / 1000, 0.1);
    ultimoInstante = ahora;

    // La camara libre pide moverse y el mundo de colisiones dice cuanto cabe.
    // Volar ya no atraviesa fachadas, y al rozar una manzana se desliza.
    if (!conduciendo) {
      controles.actualizar(segundos, deseoDeCamara);
      if (deseoDeCamara.lengthSq() > 0) {
        const cabe = mundoFisico.moverCamara(camara.position, deseoDeCamara);
        camara.position.x += cabe.x;
        camara.position.y += cabe.y;
        camara.position.z += cabe.z;
      }
      camara.position.y = Math.max(camara.position.y, ALTURA_MINIMA);
    }

    if (conduciendo) {
      coche.actualizar(
        {
          acelera: controles.pulsada('KeyW'),
          frena: controles.pulsada('KeyS'),
          izquierda: controles.pulsada('KeyA'),
          derecha: controles.pulsada('KeyD'),
        },
        segundos,
      );
    }

    // Grafo de escena, mundo de Rapier, coche y camara se mueven en el MISMO
    // fotograma, o mejor dicho en la misma llamada. El rebase se mide por
    // donde este el jugador, que conduciendo es el coche y volando la camara.
    rebase.aplicar(conduciendo ? coche.posicion : camara.position);

    if (conduciendo) {
      // La camara persigue DESPUES del rebase, para no perseguir un fotograma
      // al sitio viejo del coche.
      const deseado = puntoDePersecucion(coche.posicion, coche.guinada);
      const factor = factorDeSuavizado(segundos, CONSTANTE_PERSECUCION);
      camara.position.lerp(new THREE.Vector3(deseado.x, deseado.y, deseado.z), factor);
      // Tambien aqui: si el coche vuelca, la camara ideal se va por debajo del
      // suelo y lo unico que se ve es la cara de atras del plano.
      camara.position.y = Math.max(camara.position.y, ALTURA_MINIMA);

      const frente = coche.posicion;
      const guinada = coche.guinada;
      // El adelante del coche es `(-sin g, 0, -cos g)`, el mismo convenio que
      // usa `puntoDePersecucion` para ponerse detras.
      mirada.set(
        frente.x - Math.sin(guinada) * ADELANTO_MIRADA,
        frente.y + 1,
        frente.z - Math.cos(guinada) * ADELANTO_MIRADA,
      );
      camara.lookAt(mirada);
    }

    const posicion = origen.aProyectado(conduciendo ? coche.posicion : camara.position);
    gestor.actualizar(posicion);
    gestorColisiones.actualizar(posicion);
    mundoFisico.paso(segundos);
    renderer.render(escena, camara);

    fotogramas += 1;
    acumulado += segundos;
    if (acumulado >= 0.5) {
      fps = Math.round(fotogramas / acumulado);
      fotogramas = 0;
      acumulado = 0;

      $('m-celdas').textContent = `${gestor.celdasEnEscena} / ${indice.totales.celdas}`;
      $('m-edificios').textContent = gestor.edificiosEnEscena.toLocaleString('es-ES');
      // El detector de fugas: si esto sube dando vueltas en el mismo sitio,
      // una geometria se esta quedando sin liberar.
      $('m-geometrias').textContent = renderer.info.memory.geometries;
      $('m-triangulos').textContent = renderer.info.render.triangles.toLocaleString('es-ES');
      $('m-fps').textContent = fps;
      $('m-posicion').textContent = `${Math.round(posicion.este)} / ${Math.round(posicion.norte)}`;
      $('m-rebases').textContent = rebase.rebases;

      // El mismo detector de fugas, para las fisicas. Los cuenta Rapier, no
      // el visor: una contabilidad propia se equivocaria igual que el codigo
      // que pretende vigilar.
      $('m-celdas-fisica').textContent =
        `${gestorColisiones.celdasEnMundo} / ${indice.totales.celdas}`;
      $('m-colisionadores').textContent = mundoFisico.colisionadores.toLocaleString('es-ES');
      $('m-cuerpos').textContent = mundoFisico.cuerpos.toLocaleString('es-ES');
      $('m-retiradas').textContent = mundoFisico.pendientesDeRetirada;
      $('m-descartados').textContent =
        `${mundoFisico.descartados} + ${mundoFisico.rechazadosPorRapier}`;
      $('m-velocidad').textContent = `${Math.round(Math.abs(coche.velocidad) * 3.6)} km/h`;
      $('m-ruedas').textContent = `${coche.ruedasEnSuelo} / 4`;
    }
  });

  console.info(
    `[urbs] ${indice.territorio.nombre}: ${indice.totales.celdas} celdas, ` +
      `${indice.totales.edificios} edificios, EPSG ${indice.territorio.epsg}. ` +
      `Ancla inicial en ${centro.este}, ${centro.norte}.`,
  );
}

arrancar().catch((error) => {
  console.error(error);
  avisar('El visor no ha podido arrancar', String(error.message ?? error));
});
