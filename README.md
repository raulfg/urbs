# URBS

**UR**ban **R**eal-world **B**lock **S**andbox.

Motor que genera ciudades jugables en navegador a partir de datos geográficos abiertos. La ciudad es un **dato de entrada**, no código: el mismo pipeline debe poder generar cualquier territorio del mundo.

> Estado: la cadena completa funciona de punta a punta — OSM → celdas → navegador. Se puede volar sobre A Coruña. No hay físicas, ni tráfico, ni fachadas, ni terreno: lo que se ve son volúmenes extruidos sobre huellas reales.

## La idea

Casi todos los generadores de ciudad hacen una de dos cosas: inventan la ciudad procedimentalmente, o cargan un modelo fijo de una ciudad concreta. URBS hace la tercera: toma datos abiertos de un territorio **real** y construye una ciudad jugable con ellos.

El primer territorio es A Coruña, pero eso es una consecuencia de dónde vive quien lo escribe, no una decisión de diseño. Si algo en el motor está atado a A Coruña, es un bug.

## Regla fundacional

> El core nunca sabe de qué país ni de qué ciudad come.

Lo específico de un lugar vive en dos sitios y en ninguno más:

- un **territorio** (`crearTerritorio`), que describe el área, su sistema de coordenadas y el tamaño de celda,
- un **proveedor**, que sabe hablar con una fuente de datos concreta.

## Degradación, no dependencia

Solo OSM tiene cobertura mundial. Catastro y PNOA son exclusivos de España. Así que el motor **pide capas**, no fuentes, y el registro resuelve quién la sirve mejor en cada área:

| Capa | Fuente rica (España) | Fallback global | Qué se pierde |
| :---- | :---- | :---- | :---- |
| Edificios | Catastro INSPIRE | OSM `building` + multipolígonos | Cobertura |
| Plantas | Catastro (por parte) | OSM `building:levels` | Hay que estimar |
| Altura | *nadie la aporta* | *nadie la aporta* | Se deriva siempre de las plantas |
| Viario | OSM | OSM | Nada, fuente única |
| Relieve | MDT LiDAR PNOA (0,5 m) | Copernicus DEM (30 m) | Resolución |
| Suelo | Ortofoto PNOA (25 cm) | *no existe equivalente libre* | Hay que ir a textura procedural |

Dos filas de esa tabla son limitaciones reales, no huecos por rellenar. Fuera de España no hay ortofoto libre de 25 cm con cobertura uniforme, y **la altura de los edificios no la da ninguna fuente**: `heightAboveGround` no existe en el Catastro y `height` cubre el 0,3 % en OSM. Se deriva de las plantas, a 3 m por planta, que es la constante que el propio Catastro delata en sus datos bajo rasante.

Por eso el orden de trabajo es **OSM primero**. Si se construye antes el camino rico, el camino pobre nace muerto y se pudre sin que nadie lo note, hasta el día que intentas generar Lisboa.

## Procedencia

Cada valor del dominio declara de dónde sale y con qué confianza: `medido` (LiDAR), `declarado` (fuente oficial o etiqueta explícita) o `estimado` (lo ha deducido URBS).

Una altura medida y una estimada valen lo mismo para extruir, pero no valen lo mismo para fiarse. El dominio guarda las dos cosas.

## Paquetes

| Paquete | Responsabilidad |
| :---- | :---- |
| `urbs-core` | Dominio y contratos. Sin dependencias, sin IO, sin render |
| `urbs-providers` | Implementaciones de fuentes: OSM, Catastro, PNOA |
| `urbs-pipeline` | Preprocesado offline: reproyección, troceado en celdas, exportación |
| `urbs-viewer` | Runtime en el navegador: extrusión, origen flotante y streaming por proximidad |

## Arquitectura

```
Proveedores  ->  Preprocesado offline (Node)  ->  Celdas (~250 m)  ->  Navegador
                 reproyección a UTM local        + indice.json        three.js
                 troceado por centroide                               extrusión en runtime
                                                                      origen flotante
                                                                      streaming por proximidad
```

La zona UTM se deduce del territorio; no es una constante. A Coruña sale en EPSG:25829 (ETRS89 / UTM 29N) porque es donde cae, y porque es el datum nativo de Catastro y PNOA.

## Celdas

Cada celda se escribe en un archivo `.urbscell`: una cabecera fija, secciones de arrays tipados y una tabla de atributos en JSON. Lo que viaja son **huellas y semántica**, no mallas cocidas — la extrusión pasa en el runtime, así que las reglas de fachada se pueden retocar sin regenerar el territorio.

Toda coordenada de la geometría es local a su celda. El origen absoluto aparece una sola vez, en la cabecera, en `float64`: un UTM absoluto dentro de un `Float32Array` cuantizaría A Coruña a una retícula de medio metro.

El reparto byte a byte está en [`docs/decisiones/0003-formato-de-celda.md`](docs/decisiones/0003-formato-de-celda.md), con detalle suficiente para escribir un lector desde cero.

```js
import { crearArea, crearRegistro, crearTerritorio } from 'urbs-core';
import { generarCeldas } from 'urbs-pipeline';

const informe = await generarCeldas({ territorio, registro });
// informe.totales      -> celdas, edificios, tramos y bytes escritos
// informe.capas        -> qué proveedor sirvió cada capa
// informe.atribuciones -> lo que debe salir en la pantalla de créditos
```

## Requisitos

- Node >= 20.11
- Sin TypeScript. JavaScript vanilla y ESM.
- Las dependencias externas se fijan a versión exacta.

## Uso

```bash
npm install
npm test
```

### Generar un territorio

Un territorio es un JSON versionado, no código. Para generar otra ciudad se copia el archivo y se cambian las cuatro esquinas.

```bash
npm run generar -- territorios/marineda-casco-historico.json
```

Descarga las capas que falten (una sola petición a Overpass por área), las reproyecta a los metros del territorio, las reparte en celdas y escribe un `.urbscell` por celda con contenido más un `indice.json`.

La red se toca **una vez por área**: la caché de `datos/crudos/` convierte la segunda ejecución en un preprocesado offline y reproducible. Volver a descargar es una decisión explícita (`--refrescar`), nunca un efecto lateral. Ni los datos crudos ni las celdas generadas se versionan.

Esto es lo que salió del *vertical slice* real — Ciudad Vieja, Pescadería y Orzán, `[-8,42 · 43,36]` a `[-8,39 · 43,38]`— el 25 de septiembre de 2026, con datos de OSM con corte `2026-09-25T11:53:03Z`:

| | |
| :---- | ----: |
| Descarga de Overpass | 8.746.226 B (8,3 MiB) |
| Celdas escritas | 90 |
| Edificios | 5.459 |
| Tramos de vía | 2.882 |
| Total en disco | 1.292.862 B (1,23 MiB) |
| Celda media | 14,0 KiB |
| Celda mayor | `x2196z19208` — 49,8 KiB, 250 edificios |

Las celdas pesan **147 veces menos** que el JSON de Overpass del que salen.

De los 5.459 edificios, **17 declaran su altura y 5.442 la tienen estimada** a partir de las plantas o del tipo. Noventa tienen patio, así que la triangulación con huecos la ejercita el dato real, no un caso de prueba. Las capas de `relieve` y `suelo` no tienen proveedor todavía: se anotan en el informe y la generación sigue.

Fuente de ambas capas: `osm-edificios` y `osm-viario`. Atribución obligatoria, calculada a partir de los proveedores que cubren el área: **© colaboradores de OpenStreetMap — ODbL 1.0**.

### Ver el territorio

```bash
npm run visor
```

Abre <http://localhost:4173>. El visor es ESM nativo, sin empaquetador y sin paso de compilación: un mapa de importaciones resuelve `three`, `earcut` y `urbs-core`, y el servidor —sesenta líneas de `node:http`, sin dependencias— sirve la raíz del repo con los tipos MIME correctos.

Clic para tomar el ratón, `WASD` para moverse, `R`/`F` para subir y bajar, `Mayús` para acelerar, `Esc` para soltar.

El panel de la esquina no es decoración. `Geometrías GPU` muestra `renderer.info.memory.geometries`, que es el detector de fugas más barato que existe: alejándose del territorio baja a **cero**, y al volver recupera exactamente el mismo número. `Rebases` cuenta las veces que el origen flotante se ha mudado bajo la cámara.

El color de cada edificio dice la **confianza** de su altura: lo declarado por la fuente y lo estimado por el motor se distinguen de un vistazo.

#### Lo que hace el visor, y lo que no

Extruye las huellas **en tiempo de ejecución**. Lo que viaja en una celda son datos, no mallas cocidas, así que las reglas de fachada se podrán retocar sin regenerar el territorio.

Ninguna coordenada UTM absoluta llega a la GPU: cada celda se coloca en `origen de celda − ancla`, con el ancla en `float64` viajando con la cámara (decisión 0001, capa 2). El ancla se recalcula en absolutos en cada rebase en lugar de acumular desplazamientos, así que mil rebases no dejan deriva.

**No** hay físicas, tráfico, fachadas procedurales, texturas, terreno ni ortofoto. Nada de eso entra en este hito.

## Convenciones

- Documentación y comentarios en castellano. Los comentarios y los identificadores van **sin tildes**, para no depender del encoding en ningún punto de la cadena.
- El dominio habla el lenguaje del dominio, que aquí es español: `Edificio.plantas`, `Tramo.anchuraMetros`, `UsoEdificio.RESIDENCIAL`. Las APIs de terceros se dejan como son.
- Un valor que falta es `null`, nunca un cero disfrazado.

## Fuentes y licencias

| Fuente | Licencia | Atribución |
| :---- | :---- | :---- |
| OpenStreetMap | ODbL | © colaboradores de OpenStreetMap |
| Catastro INSPIRE | Licencia D.G. del Catastro (2016) | Dirección General del Catastro (Ministerio de Hacienda) |
| IGN / PNOA | CC BY 4.0 | Obra derivada de PNOA CC-BY scne.es |
| Copernicus DEM | Licencia Copernicus | Citar la fuente |

Cada proveedor declara su atribución y el motor **agrega solo las de las fuentes que realmente ha usado**, para que la pantalla de créditos no dependa de que alguien se acuerde de actualizarla.

La licencia del Catastro autoriza el uso comercial de la información **transformada** y prohíbe redistribuir la original. Por eso los datos crudos descargados no se versionan ni se empaquetan con el juego: viven detrás de un script de descarga y están en `.gitignore`. Las celdas generadas sí son obra derivada y se distribuyen sin problema.

No se usa geometría ni tiles de Google Maps, ni Street View, ni Photorealistic 3D Tiles.

## Licencia

Sin decidir todavía. Hay que resolver antes cómo interactúa el share-alike del ODbL de OSM con la redistribución de las celdas generadas.
