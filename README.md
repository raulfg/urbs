# URBS

**UR**ban **R**eal-world **B**lock **S**andbox.

Motor que genera ciudades jugables en navegador a partir de datos geográficos abiertos. La ciudad es un **dato de entrada**, no código: el mismo pipeline debe poder generar cualquier territorio del mundo.

> Estado: hay dominio, contratos, el proveedor de OSM y el preprocesado completo — de grados a archivos de celda. Todavía no hay nada que se vea en pantalla.

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

## Arquitectura

```
Proveedores  ->  Preprocesado offline (Node)  ->  Celdas (~250 m)  ->  Navegador
                 reproyección a UTM local                             three.js + Rapier
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
