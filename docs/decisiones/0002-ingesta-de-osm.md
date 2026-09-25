# 0002 — Ingesta de OpenStreetMap

- **Estado**: aceptada
- **Fecha**: 2026-09-25
- **Ámbito**: `packages/urbs-providers` — capas `edificios` y `viario`

## Contexto

OSM es la única fuente que cubre el planeta entero, así que en URBS no es una
opción más: es el suelo bajo los pies del motor. Si Catastro no llega, si PNOA
no llega, tiene que seguir habiendo ciudad.

Antes de escribir el proveedor se midió la cobertura real de etiquetas contra
el *bbox* de la *vertical slice* (Ciudad Vieja, Pescadería y Orzán:
`43.36,-8.42,43.38,-8.39`). Los números cambian por completo las decisiones que
uno tomaría a ojo:

| Dato | Medición |
| :---- | :---- |
| Edificios | 5.463 (5.373 *ways* + 90 relaciones `type=multipolygon`) |
| Relaciones con anillos interiores | 90 de 90, con 116 miembros `inner` |
| `building:levels` | 96,7 % de los edificios |
| `height` | 0,3 % (18 edificios), con valores sucios como `"0.5"` y `"119"` |
| Vías | 2.897 *ways*, de los cuales 1.423 son `footway` y 491 `residential` |
| `width` en vías | 2,1 % |
| `lanes` en vías | 16,1 % |
| *Ways* de vía cerrados | 147, de los cuales solo 46 llevan `area=yes` |
| Respuesta de Overpass | 20,86 MB de JSON en ~3 s con `out geom` |

La cobertura de `building:levels` es anormalmente alta para OSM porque en
A Coruña OSM **ya incorpora la importación del Catastro español**: el dato
llega pre-limpiado. No conviene extrapolarlo a la periferia (Arteixo,
Culleredo), donde esa densidad no está garantizada.

## Decisión

### Overpass con caché en disco, no el `.pbf` de Geofabrik

Se descarga de Overpass y se guarda la respuesta cruda en `datos/crudos/`. Ese
fichero es la entrada real del preprocesado: mientras exista, el pipeline se
ejecuta **offline y reproducible**.

La alternativa era el extracto `.pbf` de Galicia: 111,4 MB para la comunidad
entera, más una resolución de nodos a dos pasadas escrita a mano, frente a
20,86 MB con la geometría ya resuelta por el servidor. Para 1–2 km² no hay
color. Al escalar a los 200+ km² el `.pbf` volverá a ser la opción razonable, y
por eso la decisión vive **detrás del contrato de proveedor**: cambiarla no
toca el dominio.

Redescargar es una decisión explícita (`refrescar`), nunca un efecto lateral.
Una caché corrupta se denuncia; no se repone a escondidas. Un fallo de lectura
que se "arregla" solo con tráfico contra Overpass es justo lo que convierte una
ejecución rota en una IP baneada.

Junto a cada caché se escribe un *sidecar* `.meta.json` con el *bbox*, el texto
exacto de la consulta y el `timestamp_osm_base` de la respuesta. Ese último
campo es el que dice si la ciudad generada está al día: la fecha de descarga no
sirve, porque Overpass sirve cortes de datos, no el presente.

### Trampas de Overpass que el código da por hechas

- **HTTP 406** con el *User-Agent* por defecto de `curl` y de `undici`. Se
  envía uno identificable.
- **Páginas de error con estado 200**: cuando limita peticiones, Overpass
  devuelve XML o HTML. Se valida `content-type` además del estado, y nada toca
  el disco hasta que el JSON está parseado y trae `elements`.
- **Dos huecos simultáneos por IP**. No hay rotación automática de espejos:
  `overpass.kumi.systems` agotó 240 s en la misma consulta que
  `overpass-api.de` respondió en 3.

### La geometría se delega en `osm2geojson-lite@2.0.1`

Dos errores de los que un recorrido ingenuo de `elements` no protege, y que en
este *bbox* concreto son devastadores:

1. **Las 90 relaciones `type=multipolygon` llevan todas anillos interiores.**
   El `building` vive en la relación, no en sus *ways*, que están sin etiquetar.
   Recorrer solo *ways* cerrados pierde los 90 edificios **y** rellena los 116
   patios. Ciudad Vieja y Pescadería son manzanas de perímetro cerrado
   alrededor de patios: el resultado serían bloques macizos de granito donde
   hay un patio de luces.
2. **Un *way* cerrado no es un área.** De 147 vías cerradas solo 46 son
   `area=yes`. Tratarlas todas como polígonos convierte cada rotonda en una
   explanada de asfalto.

La heurística correcta para el segundo punto es la tabla de etiquetas de OSM, y
está resuelta en `osm2geojson-lite`: ESM, sin dependencias de tiempo de
ejecución, versión fija. Las dependencias viven en `urbs-providers`;
`urbs-core` sigue con cero.

### La altura se deriva, y se dice que se deriva

Ninguna fuente da la altura fiable, así que la cascada es:

1. `height` etiquetado, si es plausible (entre 2 y 300 m) → `Confianza.DECLARADO`.
2. `building:levels` por la altura de planta → `Confianza.ESTIMADO`.
3. Tabla por valor de `building=*` → `Confianza.ESTIMADO`.

Los valores sucios reales del *bbox* (`height="0.5"` sobre un edificio de
cuatro plantas) se rechazan **con motivo**, no en silencio. Lo descartado sale
por el canal de incidencias del proveedor.

### La estimación de anchura es el modelo, no el último recurso

Con `width` al 2,1 % y `lanes` al 16,1 %, la tabla de estimación se usa el
~84 % de las veces. `ANCHURA_POR_TIPO` (en `urbs-core`) se queda corta ahí:
`footway` y `pedestrian` caen los dos en `TipoVia.PEATONAL`, pero una acera
mide 2,5 m y una plaza peatonal 10.

Se añade un escalón intermedio, `ANCHURA_POR_HIGHWAY`, que vive **en el
proveedor y no en el dominio**: es conocimiento sobre OSM. `urbs-core` no tiene
por qué saber que existe la etiqueta `steps`. La cascada del dominio
(`resolverAnchura`) se sigue usando y se mantiene como último escalón.

### Las peatonales se conservan; el grafo del tráfico se filtra aparte

Más de la mitad de las vías del *bbox* son `footway`, `steps` o `pedestrian`.
Si el grafo del tráfico no las filtra, la IA conduce por las aceras. Pero
tirarlas sería perder la capa de peatones antes de empezar.

Por eso son dos cosas distintas: `tipoDeVia` describe la vía y `esConducible`
decide si entra en el grafo rodado. El proveedor devuelve todo por defecto y
`soloConducibles` recorta. El filtro mira **etiquetas**, no tipo de dominio,
porque un `service` con `access=no` sigue siendo `TipoVia.SERVICIO`.

## Consecuencias

- El preprocesado funciona sin red mientras exista la caché del *bbox*.
- Cambiar Overpass por el `.pbf` al escalar no toca `urbs-core`.
- Toda altura y toda anchura llegan al dominio con su `Confianza`, así que el
  motor puede decidir de qué se fía sin adivinar.
- Los créditos de OSM (ODbL) los agrega el registro automáticamente a partir de
  los proveedores que realmente cubren el área.

## Pendiente

- **`building:part`**: hay 14.761 *ways* en el *bbox* con 99,9 % de cobertura
  de `building:levels` — una proporción de 2,7 partes por edificio. Es
  *Simple 3D Buildings*: la descomposición en bajo, entreplanta y ático ya
  hecha. No hay ninguna relación `type=building` en el *bbox*, así que cada
  parte se asocia a su edificio **espacialmente** (punto en polígono del
  centroide contra las huellas, idealmente con índice R-tree). Es trabajo real
  que los datos no hacen por nosotros, y queda fuera de esta decisión.
- **`Tramo` no lleva si es conducible.** Hoy se deduce del tipo, lo que pierde
  el matiz de `access=no`. Si el tráfico lo necesita, el campo debería subir al
  dominio.
- **Comparar la importación de OSM con el Catastro actual.** OSM puede ir por
  detrás; el Catastro se mantiene en la hoja de ruta como enriquecimiento, no
  como bloqueante.
