/**
 * Una hoja del MDT02 abierta, leida por ventanas.
 *
 * Envuelve `geotiff` y no un lector propio, y esa decision tiene motivo: las
 * hojas del CNIG son BigTIFF, Float32, comprimidas con Deflate, teseladas a
 * 512x512 y con piramide COG. Un lector escrito a mano que entienda todo eso ya
 * no son noventa lineas, es una libreria — y esta ya existe, mantenida y
 * verificada contra estos mismos ficheros.
 *
 * DOS TRAMPAS, las dos comprobadas sobre la hoja 0021 cuadrante 3:
 *
 * 1. EL ORDEN DE EJES DECLARADO NO SE HONRA, A PROPOSITO. El cuadrante 3
 *    declara `ProjectedCSTypeGeoKey = 3041` (ETRS89/UTM29N con orden
 *    NORTE-ESTE) mientras el cuadrante 2 declara 25829 (ESTE-NORTE). Es el
 *    mismo sistema, pero los PIXELES van este-norte EN LOS DOS. Un lector que
 *    obedezca lo declarado transpone el cuadrante 3 y saca el relieve girado.
 *    Aqui se leen `getOrigin()` y `getResolution()` tal cual, siempre este y
 *    luego norte, y se comprueba que la resolucion norte sea negativa, que es
 *    la forma de detectar que alguien nos ha dado algo con otra orientacion.
 * 2. EN `geotiff` 3.x LOS CAMPOS DE `fileDirectory` SON PEREZOSOS. `BitsPerSample`
 *    sale `undefined` si se lee directo; hay que usar los accesores
 *    (`getBitsPerSample`, `getSampleFormat`, `getGDALNoData`). Comprobado.
 */

import { fromFile } from 'geotiff';
import { crearMallaElevacion, SIN_DATO } from 'urbs-core';

import { noroesteDeVentana, ventanaDeCaja } from './ventana.js';

/**
 * Abre una hoja. No lee ni un pixel de relieve hasta que se le pide una caja.
 *
 * @param {string} ruta
 */
export async function abrirHoja(ruta) {
  const fichero = await fromFile(ruta);
  const imagen = await fichero.getImage();

  const origenBruto = imagen.getOrigin();
  const resolucion = imagen.getResolution();

  // El norte tiene que decrecer fila a fila. Si no, esta hoja no esta orientada
  // como las del MDT02 y mas vale enterarse aqui que ver el relieve del reves.
  if (!(resolucion[1] < 0)) {
    throw new Error(
      `abrirHoja: "${ruta}" declara una resolucion norte de ${resolucion[1]}, y se esperaba negativa (fila 0 al norte)`,
    );
  }

  const geometria = {
    origen: { este: origenBruto[0], norte: origenBruto[1] },
    paso: { este: Math.abs(resolucion[0]), norte: Math.abs(resolucion[1]) },
    ancho: imagen.getWidth(),
    alto: imagen.getHeight(),
  };

  const nodata = imagen.getGDALNoData();
  const limites = Object.freeze({
    esteMin: geometria.origen.este,
    esteMax: geometria.origen.este + geometria.ancho * geometria.paso.este,
    norteMin: geometria.origen.norte - geometria.alto * geometria.paso.norte,
    norteMax: geometria.origen.norte,
  });

  return Object.freeze({
    ruta,
    limites,
    paso: Object.freeze({ ...geometria.paso }),
    ancho: geometria.ancho,
    alto: geometria.alto,
    nodata,

    /**
     * Malla de elevacion de una caja en metros, o `null` si la caja no toca.
     *
     * Solo se descomprimen las teselas que hagan falta. Leer la hoja entera
     * para quedarse con 250 m funciona una vez y muere a las tres mil.
     *
     * @param {{esteMin: number, esteMax: number, norteMin: number, norteMax: number}} caja
     * @returns {Promise<ReturnType<typeof crearMallaElevacion>|null>}
     */
    async malla(caja) {
      const ventana = ventanaDeCaja(geometria, caja);
      if (ventana === null) {
        return null;
      }

      const [cotas] = await imagen.readRasters({
        window: [ventana.izquierda, ventana.arriba, ventana.derecha, ventana.abajo],
        interleave: false,
      });

      // El centinela del fichero se normaliza al del dominio. Si no, cada
      // proveedor traeria el suyo y `SIN_DATO` dejaria de significar nada.
      if (nodata !== null && nodata !== SIN_DATO) {
        for (let i = 0; i < cotas.length; i += 1) {
          if (cotas[i] === nodata) cotas[i] = SIN_DATO;
        }
      }

      return crearMallaElevacion({
        cotas,
        ancho: ventana.derecha - ventana.izquierda,
        alto: ventana.abajo - ventana.arriba,
        noroeste: noroesteDeVentana(geometria, ventana),
        paso: geometria.paso,
      });
    },

    /** @returns {Promise<void>} */
    async cerrar() {
      await fichero.close?.();
    },
  });
}
