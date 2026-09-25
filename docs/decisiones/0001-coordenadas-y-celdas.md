# 0001 — Coordenadas y celdas

- **Estado**: aceptada
- **Fecha**: 2026-09-25
- **Ámbito**: todo el motor — pipeline, formato de celda, runtime y persistencia

## Contexto

URBS construye la ciudad a partir de datos geográficos reales. El sistema de
trabajo es UTM en metros: para A Coruña, EPSG:25829 (ETRS89 / UTM 29N), donde
el este ronda los 547.000 m y el norte los 4.800.000 m.

El problema es que la GPU trabaja en `float32`, y un `float32` tiene 24 bits de
mantisa. El escalón entre dos valores consecutivos depende de la magnitud:

| Magnitud | Intervalo binario | Escalón (ULP) |
| :---- | :---- | :---- |
| 4.800.000 m (norte de A Coruña) | 2²² … 2²³ | **0,5 m** |
| 547.000 m (este de A Coruña) | 2¹⁹ … 2²⁰ | **0,0625 m** |
| 250 m (lado de celda) | 2⁷ … 2⁸ | 0,0000153 m (15 µm) |
| 125 m (centro de una celda) | 2⁶ … 2⁷ | 0,0000076 m (8 µm) |

Meter una coordenada UTM absoluta en un `Float32Array` de vértices cuantiza la
ciudad entera a una retícula de medio metro en el eje norte. Los síntomas no se
parecen a un problema de precisión, y por eso cuesta tanto diagnosticarlos:

- huecos entre medianeras de edificios que en el Catastro comparten pared;
- *z-fighting* en aceras y calzadas que quedan al mismo nivel;
- normales incorrectas, porque triángulos finos degeneran al colapsar sus
  vértices sobre el mismo punto de la retícula;
- temblor visible de la geometría al conducir, porque la cámara se mueve de
  forma continua sobre un mundo que salta de medio metro en medio metro.

No es un problema que se pueda arreglar más tarde: afecta al formato de celda,
al grafo de escena, al mundo de físicas y a lo que se persiste en disco. La
decisión hay que tomarla antes de escribir la primera celda.

## Decisión

Se adopta una solución de **dos capas**.

### Capa 1 — Coordenadas locales de celda (datos, pipeline)

El territorio se trocea en celdas cuadradas de `ladoCeldaMetros` (250 m por
defecto). Cada celda guarda su geometría **relativa a su propia esquina
suroeste**, en el rango `[0, ladoCeldaMetros)`. Con 250 m de lado, el `float32`
ofrece unas 15 µm de resolución: cuatro órdenes de magnitud por debajo de
cualquier detalle urbano que vayamos a modelar.

La retícula se ancla en **múltiplos globales del lado de celda**, nunca en el
área del territorio. El índice de una celda es `Math.floor(coordenada / lado)`
y depende solo del punto y del lado. Retocar el área de un territorio no
desplaza ni renombra ninguna celda, y dos territorios solapados comparten
índices. El origen absoluto se reconstruye del índice con una sola
multiplicación (`índice × lado`), en `float64`: es exacto y no acumula deriva,
a diferencia de ir sumando el lado celda a celda.

Se usa `Math.floor`, no truncamiento hacia cero, para que las coordenadas
negativas —hemisferio sur, o sistemas proyectados locales con origen dentro del
territorio— caigan en la celda correcta en lugar de producir coordenadas
locales negativas.

Esto vive en `packages/urbs-core/src/dominio/celda.js`.

### Capa 2 — Origen flotante (runtime)

Aunque los datos estén en coordenadas locales, la posición del jugador dentro
del mundo vuelve a crecer a medida que se aleja del origen de la escena. El
runtime mantiene un **origen flotante**: cuando el jugador supera un umbral de
distancia (~1 km), se rebasa el mundo restando ese desplazamiento a todo lo que
está cargado.

Esta capa **no forma parte de esta decisión de implementación** y se aborda
cuando exista runtime, pero la regla que impone sí es definitiva y está en la
lista de abajo.

### Guarda ejecutable

La regla del `float32` se convierte en código en lugar de quedarse en un
comentario. `pasoFloat32(magnitud)` calcula el escalón real a partir del
exponente binario de la magnitud —no hay tabla de umbrales que se quede
obsoleta al cambiar de ciudad o de lado de celda— y
`exigirCoordenadasLocales(punto, celda)` lanza un `RangeError` accionable
cuando una coordenada absoluta está a punto de usarse donde se esperan
coordenadas locales.

## Reglas no negociables

1. **Ninguna coordenada UTM absoluta llega jamás a un `Float32Array` ni a un
   uniform de shader.** Lo que se sube a la GPU es siempre local a su celda.
   Todo punto de entrada a un buffer pasa por `exigirCoordenadasLocales`.
2. **El origen de la celda vive una sola vez, en `float64`**, junto a los
   metadatos de la celda, y se reconstruye del índice por multiplicación exacta.
   Nunca se replica por vértice ni se acumula sumando.
3. **El runtime rebasa el grafo de escena y el mundo de físicas juntos, en el
   mismo fotograma.** Mover uno sin el otro desincroniza render y colisiones, y
   el resultado es peor que el problema original.
4. **Todo lo que persista posiciones absolutas guarda `float64` en UTM y
   convierte al leer.** Aplica a ficheros de celda, cachés del pipeline,
   partidas guardadas y cualquier índice espacial. Si un formato solo admite
   `float32`, guarda coordenadas locales más el índice de celda, nunca la
   coordenada absoluta recortada.
5. **La proyección de grados a metros es responsabilidad del pipeline.** El
   dominio trabaja en metros proyectados que le entrega quien lo llama, y el
   EPSG se deduce del territorio (ver `proyeccion.js`), no se cablea.

## Consecuencias

- El pipeline debe asignar cada elemento a su celda y convertir su geometría a
  coordenadas locales antes de escribir nada.
- Un elemento que cruza el borde de una celda hay que recortarlo o duplicarlo,
  y esa decisión se toma por capa (edificios, viario, terreno). Queda fuera de
  esta decisión.
- El lado de celda tiene techo: con 1 mm de precisión exigida, el `float32`
  aguanta hasta 2¹⁴ = 16.384 m. Cualquier lado razonable cabe con margen de
  sobra, pero la guarda lo comprueba en vez de suponerlo.
- Los índices de celda son enteros con signo y su clave (`x2188z19202`) sirve
  igual como clave de mapa que como nombre de fichero.
