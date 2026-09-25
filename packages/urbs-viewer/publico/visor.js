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

import { COLOR_POR_CONFIANZA } from '../src/geometria.js';
import { crearGestorDeCeldas } from './gestor-celdas.js';
import { crearOrigenFlotante } from '../src/origen-flotante.js';
import { crearControles } from './controles.js';

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

/** Radio de carga. Un poco mas de un kilometro: cuatro celdas a la redonda. */
const RADIO_CARGA = 1100;

/** Altura inicial de la camara, en metros. */
const ALTURA_INICIAL = 320;

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
function centroUrbano(indice) {
  const lado = indice.territorio.ladoCeldaMetros;
  const densa = indice.celdas.reduce((mejor, celda) =>
    celda.edificios > mejor.edificios ? celda : mejor,
  );
  return {
    este: densa.origen.este + lado / 2,
    norte: densa.origen.norte + lado / 2,
  };
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
  escena.fog = new THREE.Fog(0x10131a, RADIO_CARGA * 0.55, RADIO_CARGA);

  escena.add(new THREE.HemisphereLight(0xbfd4ff, 0x2b2a28, 2.1));
  const sol = new THREE.DirectionalLight(0xfff2e0, 1.5);
  sol.position.set(-0.6, 1, 0.45);
  escena.add(sol);

  const camara = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.5,
    RADIO_CARGA * 1.5,
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
  camara.rotation.set(-0.85, 0, 0, 'YXZ');

  const controles = crearControles(camara, renderer.domElement);
  const gestor = crearGestorDeCeldas({ escena, indice, base, origen, radioMetros: RADIO_CARGA });

  window.addEventListener('resize', () => {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Bucle. Sin `THREE.Clock`, que esta obsoleto desde r186, y sin su
  // sustituto: el reloj de un bucle son dos lineas y una resta.
  let ultimoInstante = performance.now();
  let rebases = 0;
  let fotogramas = 0;
  let acumulado = 0;
  let fps = 0;

  renderer.setAnimationLoop(() => {
    const ahora = performance.now();
    // Acotado: una pestana en segundo plano vuelve con un salto de segundos y
    // la camara se iria al otro lado de la ciudad de golpe.
    const segundos = Math.min((ahora - ultimoInstante) / 1000, 0.1);
    ultimoInstante = ahora;
    controles.actualizar(segundos);

    // Rebase y grafo de escena se mueven en el MISMO fotograma. Cuando haya
    // fisicas, el mundo de Rapier se mueve tambien aqui, no en el siguiente.
    const rebase = origen.rebasarSiHaceFalta(camara.position);
    if (rebase.rebasado) {
      gestor.rebasar(rebase.delta);
      camara.position.x -= rebase.delta.x;
      camara.position.z -= rebase.delta.z;
      rebases += 1;
    }

    const posicion = origen.aProyectado(camara.position);
    gestor.actualizar(posicion);
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
      $('m-rebases').textContent = rebases;
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
