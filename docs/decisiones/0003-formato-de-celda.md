# 0003 — El formato de celda `.urbscell`

- **Estado**: aceptada
- **Fecha**: 2026-09-25
- **Ámbito**: pipeline de preprocesado y runtime del navegador
- **Depende de**: [0001 — Coordenadas y celdas](./0001-coordenadas-y-celdas.md)

## Contexto

El preprocesado trocea el territorio en celdas y escribe una por archivo. El
runtime carga y descarga esas celdas según la posición del jugador. Hacía falta
decidir qué viaja dentro de cada archivo y con qué reparto de bytes.

Tres restricciones marcaban la decisión:

1. **La celda lleva semántica, no una malla.** Extruir en el runtime permite
   retocar las reglas de fachada sin regenerar el territorio, sacar el LOD del
   mismo anillo e instanciar edificios. Para una celda sintética de 250 m,
   huellas más atributos ocupan unos 16,8 KiB frente a los 621 KiB de la malla
   cocida equivalente.
2. **glTF no sirve para esto.** El `GLTFLoader` de three.js no soporta
   `EXT_structural_metadata` ni `EXT_mesh_features`, así que el único canal para
   los atributos por edificio es `extras`, y eso obliga a un nodo y una
   primitiva por edificio: unas 280 veces más de JSON y cientos de *draw calls*.
   Tampoco existe un `GLTFLoader` seguro en un worker.
3. **La regla de coordenadas de la decisión 0001 es innegociable.** Una
   coordenada UTM absoluta en un `Float32Array` cuantiza A Coruña a una retícula
   de medio metro en el eje norte.

## Decisión

Un formato binario propio, `.urbscell`, definido en
`packages/urbs-core/src/formato/celda-binaria.js`.

Vive en `urbs-core` y no tiene ni una dependencia, porque lo escribe el
pipeline en Node y lo lee un worker en el navegador. Ese doble uso es
exactamente la razón de que no esté en `urbs-pipeline`.

La estructura del archivo es siempre la misma:

```
[ cabecera fija, 72 bytes ]
[ 16 secciones de arrays tipados, cada una alineada a 8 bytes ]
[ tabla de atributos en JSON UTF-8 ]
```

Todo el archivo es **little-endian**. La alineación a 8 bytes existe para que
el lector pueda crear vistas tipadas sobre el mismo `ArrayBuffer` sin copiar
nada.

### Reglas de coordenadas

- Toda coordenada de una sección tipada es **local a la celda**, relativa a su
  esquina suroeste.
- El **origen absoluto aparece una sola vez**, en la cabecera, en `float64`.
- El **ancla** de cada elemento (su centroide, el punto que decidió a qué celda
  pertenece) tiene que caer estrictamente en `[0, lado)`. El codificador la pasa
  por `exigirCoordenadasLocales`, así que un UTM absoluto revienta con un
  `RangeError` en vez de cuantizar la geometría en silencio.
- Los **vértices** pueden salirse de `[0, lado)`. Los elementos se asignan por
  centroide y no se recortan (ver *Consecuencias*), así que una calle larga
  sobresale por los dos lados de su celda. El rango admitido es
  `[-margen, lado + margen)`, y el margen viaja en la cabecera.

El margen por defecto son **cuatro lados de celda** (1.000 m con celdas de
250 m). No es un número mágico ni una licencia: con `lado + margen = 1.250 m`,
el escalón de `float32` es de 0,000122 m, muy por debajo del milímetro que el
formato promete. El codificador comprueba esa cuenta con `esSeguroEnFloat32` y
rechaza cualquier margen que la rompa, diciendo cuál sería el escalón.

## Cabecera (72 bytes)

Todos los desplazamientos son desde el principio del archivo.

| Offset | Bytes | Tipo | Campo |
| :---- | :---- | :---- | :---- |
| 0 | 8 | `char[8]` | Magia, exactamente `URBSCELL` en ASCII |
| 8 | 2 | `uint16` | Versión del formato (hoy `1`) |
| 10 | 2 | `uint16` | Tamaño de la cabecera en bytes (hoy `72`) |
| 12 | 4 | `int32` | Índice de celda `x` (columna, con signo) |
| 16 | 4 | `int32` | Índice de celda `z` (fila, con signo) |
| 20 | 4 | `int32` | Código EPSG del sistema proyectado |
| 24 | 8 | `float64` | Origen: este absoluto, en metros |
| 32 | 8 | `float64` | Origen: norte absoluto, en metros |
| 40 | 8 | `float64` | Lado de celda, en metros |
| 48 | 8 | `float64` | Margen admitido fuera de la celda, en metros |
| 56 | 4 | `uint32` | `nE`: número de edificios |
| 60 | 4 | `uint32` | `nT`: número de tramos |
| 64 | 4 | `uint32` | Desplazamiento de la tabla de atributos |
| 68 | 4 | `uint32` | Tamaño de la tabla de atributos, en bytes |

Un lector **debe** verificar tres cosas antes de seguir:

1. Los ocho primeros bytes son `URBSCELL`.
2. La versión es una que sabe leer. Si no, se niega; no improvisa.
3. El origen guardado coincide con `índice × lado`. Si no coincide, el archivo
   está corrupto o se generó con otro lado de celda.

## Secciones

Las dieciséis secciones aparecen en este orden. Cada una empieza en el primer
múltiplo de 8 que haya en o después del final de la anterior; la primera empieza
en el byte 72. Ninguna se omite: con cero elementos, las secciones CSR siguen
teniendo un elemento (el cero final) y las demás quedan vacías.

| # | Sección | Tipo | Longitud |
| :---- | :---- | :---- | :---- |
| 1 | `edificiosInicioAnillo` | `uint32` | `nE + 1` |
| 2 | `anillosInicioVertice` | `uint32` | `nA + 1` |
| 3 | `edificiosVertices` | `float32` | `nVE × 2` |
| 4 | `edificiosAncla` | `float32` | `nE × 2` |
| 5 | `edificiosAlturaMetros` | `float32` | `nE` |
| 6 | `edificiosPlantas` | `int16` | `nE` |
| 7 | `edificiosUso` | `uint8` | `nE` |
| 8 | `edificiosProcedencia` | `uint16` | `nE` |
| 9 | `tramosInicioVertice` | `uint32` | `nT + 1` |
| 10 | `tramosVertices` | `float32` | `nVT × 2` |
| 11 | `tramosAncla` | `float32` | `nT × 2` |
| 12 | `tramosAnchuraMetros` | `float32` | `nT` |
| 13 | `tramosCarriles` | `int16` | `nT` |
| 14 | `tramosBanderas` | `uint8` | `nT` |
| 15 | `tramosTipo` | `uint8` | `nT` |
| 16 | `tramosProcedencia` | `uint16` | `nT` |

`nE` y `nT` salen de la cabecera. Las otras tres longitudes **no están en la
cabecera**: se leen de la última posición de la sección anterior, que es lo que
hace que el formato no pueda contradecirse a sí mismo.

- `nA` (total de anillos) = `edificiosInicioAnillo[nE]`
- `nVE` (total de vértices de edificio) = `anillosInicioVertice[nA]`
- `nVT` (total de vértices de viario) = `tramosInicioVertice[nT]`

### Cómo se lee la geometría

Las secciones 1 y 2 son índices CSR de dos niveles. Los anillos del edificio `i`
son los que van de `edificiosInicioAnillo[i]` hasta `edificiosInicioAnillo[i+1]`
sin incluirlo. Los vértices del anillo `a` van de `anillosInicioVertice[a]` hasta
`anillosInicioVertice[a+1]` sin incluirlo. Los índices de vértice cuentan
**vértices, no floats**: el vértice `v` está en `edificiosVertices[v × 2]` (este)
y `edificiosVertices[v × 2 + 1]` (norte).

El primer anillo de cada edificio es el contorno exterior; los demás son huecos
(patios interiores).

El viario es igual pero con un solo nivel: los vértices del tramo `i` van de
`tramosInicioVertice[i]` a `tramosInicioVertice[i+1]`.

### Valores ausentes

Un valor que falta es ausente, nunca un cero disfrazado.

| Sección | Centinela de ausente |
| :---- | :---- |
| `edificiosAlturaMetros` | `NaN` |
| `edificiosPlantas` | `-1` |
| `tramosCarriles` | `-1` |
| `tramos.nombres` (JSON) | `null` |

Ni las plantas ni los carriles pueden ser cero o negativos en el dominio, así
que `-1` es inequívoco. El codificador rechaza enteros mayores que 32.767.

### Banderas

`tramosBanderas` es un mapa de bits por tramo. Hoy solo está definido el bit 0:

| Bit | Significado |
| :---- | :---- |
| 0 (`0x01`) | Sentido único |
| 1–7 | Reservados, se escriben a cero |

## Tabla de atributos

Al final del archivo, en el desplazamiento que indica la cabecera, hay un
documento JSON codificado en UTF-8 con esta forma:

```json
{
  "diccionarios": {
    "usos": ["residencial", "comercial"],
    "tiposVia": ["residencial", "primaria"],
    "procedencias": [
      { "proveedor": "osm", "confianza": "declarado", "nota": null }
    ]
  },
  "edificios": { "ids": ["way/1"] },
  "tramos": { "ids": ["way/9"], "nombres": ["Rúa Real"] }
}
```

Las secciones 7, 8, 15 y 16 son índices dentro de estos diccionarios. La
deduplicación no es un detalle de compresión: doscientos edificios de OSM
comparten una sola procedencia, así que ocupa una entrada y no doscientas.

Los diccionarios viajan **dentro del archivo** en lugar de estar cableados en el
lector. Añadir un uso de edificio o un tipo de vía al dominio no obliga a subir
la versión del formato.

Límites: los diccionarios de uso y tipo de vía se indexan con `uint8` (256
valores distintos por celda) y el de procedencias con `uint16` (65.536). El
codificador falla con un mensaje explícito si se pasan.

En el JSON no hay `undefined`: una nota de procedencia ausente es `null`.

## Ejemplo completo

Una celda con un edificio de un anillo de cinco vértices y un tramo de dos
vértices ocupa **511 bytes**:

| Tramo del archivo | Desplazamiento | Bytes |
| :---- | :---- | :---- |
| Cabecera | 0 | 72 |
| Secciones 1–16 | 72 | 168 |
| Tabla de atributos | 240 | 271 |

Su cabecera dice `índice {x: 2188, z: 19202}`, `origen {547000, 4800500}`,
`lado 250`, `margen 1000`, `epsg 25829`, `nE 1`, `nT 1`.

## Consecuencias

- **La geometría no se recorta en el borde de la celda.** Recortar obliga a
  inventar vértices en la línea de corte y parte medianeras entre dos archivos;
  duplicar obliga al runtime a deduplicar por id al cargar celdas vecinas.
  Guardar el elemento entero en la celda de su centroide es lo único que no
  rompe nada, y el margen es lo que lo hace representable.
- **El ancla no es solo una comprobación.** Es el punto que el runtime usa para
  ordenar por distancia, filtrar e instanciar sin abrir la geometría.
- **Un lector big-endian no funciona.** El codificador y el lector comprueban la
  plataforma y fallan con un mensaje claro en vez de devolver bytes al revés.
  Ninguna plataforma de destino (x86, ARM, WASM) es big-endian.
- **La salida es estable byte a byte.** Dos ejecuciones con los mismos datos
  producen archivos idénticos, así que sirven de caché y se pueden comparar.
- **Todavía no viaja el relieve ni el suelo.** Cuando entren el MDT y la
  ortofoto habrá que añadir secciones y subir la versión del formato a 2. La
  cabecera ya lleva versión y tamaño propio precisamente para eso.
- **Falta un bloque de partes de edificio.** El Catastro da volumetría por
  partes (bajo, entreplanta, ático retranqueado) y este formato solo guarda una
  altura por edificio. Es la primera ampliación previsible.
