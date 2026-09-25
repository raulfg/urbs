# 0005 — Relieve y agua

- **Estado**: aceptada
- **Fecha**: 2026-09-25
- **Ámbito**: proveedores, formato de celda, pipeline y runtime

## Contexto

Hasta aquí la ciudad era plana. A Coruña no lo es —hay celdas de 250 m con
**108,7 m de desnivel**— y además es una península: más de la mitad de cualquier
recorte es mar, y el mar se dibujaba del mismo gris que el asfalto.

El encargo venía en ese orden: primero el mar, luego las alturas. La primera
medición lo invirtió, y conviene contar por qué, porque el razonamiento es la
mitad de esta decisión.

### Por qué OSM no puede dar el mar

Verificado contra `osm2geojson-lite` con un *fixture*: `natural=water` sale como
`Polygon`, pero **`natural=coastline` sale como `LineString`**. En OSM el mar
abierto **no existe como área**: existe una línea con un convenio (tierra a la
izquierda). Pintar el mar desde OSM habría exigido escribir un cerrador de
costas —encadenar *ways*, recortar a la celda, cerrar por el borde— y meter
polígonos de agua en el formato.

### Por qué el MDT lo da gratis

El MDT del PNOA da alturas **ortométricas sobre el nivel medio del mar**. El agua
aparece como cota baja, así que **el relieve y la costa son el mismo dato**, y
hacer primero las alturas entrega las dos cosas.

Los dos hitos eran uno.

## Decisión

### 1. La fuente: MDT02 del CNIG, no el WCS del IDEE

**MDT01 a 0,5 m no existe para A Coruña** —tercera cobertura sin completar, cero
ficheros para la provincia 15—, así que **MDT02 a 2 m, PNOA-LiDAR segunda
cobertura** (RMSE Z ≤ 25 cm, vuelos 2015-2021) es lo mejor disponible.

El WCS de elevación del IDEE sirve como fuente de conveniencia a 5 m, pero **no
vale como evidencia**: reencoda a Int16 y **borra el centinela de nodata**.
Comprobado —`getGDALNoData()` devuelve `null` sobre sus respuestas—, y esa fue
la causa de la primera medición equivocada de este hito.

La descarga del Centro de Descargas está verificada contra el servicio, sin
registro ni licencia que aceptar:

```
POST /CentroDescargas/descargaDir   con   secDescDirLA=<id>
-> 200 image/tiff
   Content-Disposition: attachment; filename=MDT02-ETRS89-HU29-0021-3-COB2.tif
```

**El campo es `secDescDirLA` y no es intercambiable**: la propia página usa
`secuencial` para `descargaDirS3`. Mandar el que no toca devuelve HTML con
estado 200, así que se validan tipo MIME **y** bytes mágicos antes de escribir:
un `.tif` de 700 bytes que es una página de error revienta muchísimo después y
muy lejos.

### 2. Se adopta `geotiff`, no un lector propio

Se escribió un lector a mano y **se descartó**. Estas hojas son BigTIFF
(`II+\0`), Float32, Deflate, teseladas 512×512 y con pirámide COG. Un lector que
entienda todo eso ya no son noventa líneas: es una librería, y `geotiff@3.0.5`
ya existe y está verificada contra estos mismos ficheros.

Dos trampas, ambas comprobadas sobre la hoja 0021-3:

- **El orden de ejes declarado NO se honra, a propósito.** El cuadrante 3 declara
  `ProjectedCSTypeGeoKey = 3041` (norte-este) y el 2 declara 25829 (este-norte)
  —mismo sistema—, pero **los píxeles van este-norte en los dos**. Un lector que
  obedezca lo declarado transpone el cuadrante 3. Se leen `getOrigin()` y
  `getResolution()` tal cual y se **exige resolución norte negativa**.
- En `geotiff` 3.x los campos de `fileDirectory` son perezosos: `BitsPerSample`
  sale `undefined`. Se usan los accesores.

### 3. Lectura por ventanas desde el primer día

Un cuadrante son 6835×4725 en float32: 60 MB en disco y 129 MB descomprimido.
**Medido sobre la hoja real**: una celda de 250 m son 127×127 píxeles en **38 ms**
frente a **1.321 ms** la hoja entera. Cargar la hoja para quedarse con 250 m
funciona con una celda y muere con las 3.000 del territorio completo.

### 4. Dos resoluciones distintas, con trabajos distintos

Esta es la decisión que más consecuencias tiene.

- **La fuente se muestrea a su paso NATIVO (2 m)** cuando hace falta precisión:
  la cota base de un edificio sale del mínimo bajo su huella, y un edificio
  pequeño cabe entre dos postes de una malla gruesa. **Esa precisión se consume
  en el preprocesado y NO se envía.** Es la única razón por la que se baja dato
  de 2 m.
- **Lo que se ENVÍA es una malla más gruesa**, porque es lo que se dibuja y lo
  que pisa el coche.

El paso se eligió **midiendo**, barriendo 400 celdas de la hoja real y comparando
contra la verdad de 2 m sobre un acantilado (108,7 m de desnivel), una ladera
fuerte y una celda urbana:

| paso | bytes/celda | triángulos | Ciudad Vieja | ladera fuerte | acantilado |
| --: | --: | --: | :-- | :-- | :-- |
| 5 m | 5.202 | 5.000 | rms 0,06 · peor 1,06 | rms 0,09 · peor 1,23 | rms 0,22 · peor 3,10 |
| **10 m** | **1.352** | **1.250** | **rms 0,17 · peor 1,84** | **rms 0,22 · peor 2,53** | **rms 0,61 · peor 4,71** |
| 25 m | 242 | 200 | rms 0,47 · peor 3,25 | rms 0,59 · peor 3,76 | rms 1,89 · peor 10,34 |
| 50 m | 72 | 50 | rms 0,76 · peor 4,04 | rms 1,39 · peor 6,44 | rms 4,66 · peor 18,64 |

**Se elige 10 m.** 1,35 KB por celda es el 10 % de la celda actual, frente al 37 %
que costaría a 5 m; y 0,17 m rms bajo ruedas de 32 cm no se siente. El nativo de
2 m serían 31,7 KB y 15.750 triángulos por celda.

**Tolerancia aceptada**: rms ≤ 0,25 m en suelo urbano conducible, ~0,6 m en
acantilado. Rapier lee esta misma malla, así que la tolerancia cubre lo que se
ve y lo que se conduce sin una segunda historia que contar.

**El paso viaja en la cabecera de la celda, no es una constante**, para que un
territorio o un nivel de LOD lo cambien sin tocar la versión del formato.

Los peores casos —1,84 m en zona urbana, 4,71 m en acantilado— **no son ruido**:
son muros de contención y escaleras que el MDT captura de verdad y que la malla
alisa. Es terreno real perdido al paso de malla, y **subir el paso es la palanca**
si algún día importan.

### 5. Todo lo que se apoya en el suelo se apoya en la MALLA ENVIADA

No en el dato fino del que salió. Una calle que tomara su cota del dato fino
quedaría flotando o hundida respecto a lo que se ve, con **luz por debajo a lo
largo de toda la calle** — y un edificio disimula ese desfase tras sus paredes,
pero una calle no puede.

### 6. La base de un edificio es el MÍNIMO bajo su huella, menos un zócalo

De los tres errores posibles, **el hueco bajo un edificio es el único que se VE y
por el que además se CAE**. Enterrar treinta centímetros de un portal sólo queda
un poco raro.

- **Rechazada la media**: entierra media fachada y hace flotar la otra. Lo peor
  de las dos.
- **Rechazada la muestra en el centroide**: flota por el lado de abajo en
  cualquier calle en cuesta, que en Ciudad Vieja son casi todas.
- **Rechazado aterrazar o partir el edificio por tramos de pendiente**: da el
  resultado correcto, pero cambia la huella, el formato y el colisionador. Es
  otro hito.

El mínimo se busca sobre la **malla enviada**, no sobre la verdad fina: buscarlo
en el dato fino dejaría el edificio flotando allí donde la malla quede por
debajo.

El zócalo **se deriva** de la pendiente bajo la huella y se acota por los dos
lados; no es un número elegido, igual que la guarda de float32, el recorte del
inglete y el margen de celda tampoco lo son.

**Coste aceptado, con fecha de caducidad**: un edificio largo en calle empinada
se hunde por el extremo de arriba. OSM ya trae **14.761 `building:part`** en este
bbox, y un edificio largo en cuesta suele ser varias partes: cuando cada parte
tome su propia base, el defecto se disuelve casi solo. Aceptarlo ahora es barato,
no permanente.

### 7. Puentes y túneles no se pegan al terreno

En el *slice*: **24 puentes y 28 túneles** de 5.277 tramos, y entre los puentes
la Avenida Alcalde Alfonso Molina, que es por donde se entra a la ciudad.
Muestrearlos vértice a vértice los hunde en lo que cruzan.

- Un **túnel** sale de la malla visible.
- Un **puente** traza una rampa entre las cotas de sus dos extremos —repartida
  por distancia acumulada, no por índice de vértice— y luego sube en bloque lo
  justo para no bajar de 1,2 m sobre el terreno en ningún punto. La rampa se
  conserva; no se hunde en nada. Deliberadamente tosco: sin pilas ni peralte.

**Hallazgo que cambia la regla**: de las 81 vías con `tunnel` en el *slice*,
**cincuenta y tres son `building_passage`**. No van bajo tierra: son calles que
pasan por debajo de un edificio, los soportales de Ciudad Vieja. Tratarlas como
túnel habría **borrado 53 calles conducibles del casco viejo**. Van a rasante.
`covered=yes` igual: estar techado no es estar enterrado.

El **nivel** (`layer`) va aparte de la estructura porque **no son el mismo
conjunto**: hay 70 vías en `layer=-1` y sólo 28 túneles. Un paso inferior a cielo
abierto está bajo nivel y no es un túnel.

### 8. Qué es agua: umbral del territorio + conectividad del preprocesado

Son **dos mitades y ninguna sirve sin la otra**.

**El umbral lo declara el TERRITORIO** (`umbralAguaMetros`), no el dominio. La
regla fundacional de `urbs-core` es que nunca sabe de qué país come, y «a qué
cota deja de haber agua» es justo el saber local que la rompe: depende de la
altura de los muelles, de la marea y de si el sitio es un delta o un polder. Un
número afinado contra A Coruña ahogaría Rotterdam.

Que el umbral haga falta está medido **sobre el territorio que de verdad se
envía**: de 108.160 postes, **sólo SIETE bajan de cero estricto**, pero el
**13,0 % cae en la banda 0-1 m** y el 5,3 % en la de 1-2. Aquí el mar no lee cero:
lee una banda baja. Con una regla de `cota === 0` este territorio habría salido
prácticamente seco.

En el dominio queda `UMBRAL_AGUA_DE_RESERVA = 0`, y **no es una calibración**:
está elegido para que, si alguien se olvida de declararlo, el fallo sea «falta
agua» —visible al instante— y no «sobra agua», que inunda calles sin avisar.

**Pero el umbral por sí solo nunca basta.** Estar por debajo de la cota del agua
no basta para ser agua: hay tierra ahí abajo por motivos que no tienen nada que
ver con el mar —una trinchera de carretera, un dique seco, una rampa de
aparcamiento, una excavación—. Medido sobre la hoja real: **46.690 píxeles,
dieciocho hectáreas y media**, están bajo el umbral **sin salida al mar**. Y en
las celdas generadas hay **510 postes bajo el umbral que son tierra** y **7 a
cota negativa y secos**. Tierra bajo la línea de flotación existe y no es rara.

Lo que distingue el mar de un socavón es que **el mar SALE del territorio**, así
que la máscara se propaga desde el borde, con **cuatro vecinos y no ocho**: con
ocho, dos masas que sólo se tocan por una esquina se funden y el mar se cuela al
otro lado de un espigón por un único píxel en diagonal.

**Y eso no se puede decidir por celda**: el borde de una celda de 250 m no es el
borde del mundo, así que una ría que entra por el oeste quedaría cortada en la
primera celda y el resto pasaría por depresión interior. La decisión se toma
**una vez, en el preprocesado, con el territorio entero delante**, y cada poste
se lleva su bandera en el archivo. El visor no vuelve a opinar.

### 9. El centinela de «no producido» no es agua, y no se interpola

`SIN_DATO = -32767` significa que el vuelo no cubrió ese píxel. Es **el número
más bajo de la escala**, así que cualquier filtro de «esto está bajo, será mar»
se lo traga entero. Además **no se interpola**: un solo vecino con el centinela
abriría un pozo de treinta kilómetros repartido entre los píxeles de alrededor.
Y no cuenta para el rango de cotas.

### 10. Las cotas viajan en decímetros RELATIVOS a la celda

Es el truco del origen flotante (decisión 0001) aplicado a la vertical, y hace
falta: un `int16` en decímetros **absolutos** llega a 3.276 m y **se queda corto
en el Mulhacén** (3.479 m). Relativo a una cota base de celda —en `float64`, en
la cabecera, como manda la regla 2 de la 0001— no se queda corto en ninguna
parte, porque una celda de 250 m no abarca semejante desnivel.

El decímetro es holgado: el error del propio paso de malla es de 0,17 m rms, tres
veces mayor que el del redondeo.

## Reglas no negociables

1. **La superficie oficial es la malla que se envía.** Edificios, viario, físicas
   y cámara se apoyan en ella. El dato fino es una magnitud de tiempo de
   preprocesado y su única razón de existir es el mínimo bajo la huella.
2. **El campo de alturas de Rapier es esa misma malla.** No hay una segunda
   versión del suelo que pueda discrepar de la primera.
3. **Qué es agua lo decide el preprocesado, no el runtime.** El runtime lee una
   bandera; no recalcula.
4. **El umbral de agua es saber del territorio.** El dominio sólo tiene un
   recurso conservador que falla hacia «falta agua».
5. **`SIN_DATO` no es agua, no se interpola y no entra en los rangos.**
6. **Un cero de postes de relieve significa «esta celda no tiene relieve»**, que
   no es lo mismo que una malla llana a cota cero.

## Consecuencias

- `.urbscell` sube a **v3**. v2 añadió la malla de relieve y la estructura del
  viario (cabecera 72 → 88 bytes); v3 añadió la bandera de agua por poste, en
  bits —676 booleanos son 85 bytes en vez de 676, y a 200 km² eso importa— sin
  tocar la cabecera. Las celdas de versiones anteriores dejan de leerse, que es
  exactamente para lo que existe la guarda de versión.
- `urbs-providers` gana `geotiff@3.0.5` fijado exacto. `urbs-core` sigue con
  **cero dependencias**, y hay una prueba que lo afirma.
- Las hojas del MDT viven en `datos/crudos/` detrás de la caché y **no se
  versionan**: son 60-100 MB por cuadrante.
- Atribución obligatoria, y su formula es parte del requisito:
  **`Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es`**. Difiere de la
  del PNOA de ortofotos. Sale sola en los créditos, calculada del proveedor.

## Lo que se aprendió midiendo, y no se podía deducir

1. **El WCS mentía.** La primera medición de este hito concluyó «el mar es cero
   exacto» a partir de respuestas del WCS, que reencoda a Int16 y borra el
   nodata. Sobre el producto real el mar es una banda, no un valor.
2. **Contar no es mirar.** El recuento bruto decía 81 túneles; mirar los valores
   reveló que 53 son soportales. Habría borrado medio casco viejo.
3. **Escribir la prueba no es usar la función.** La regla de conectividad estuvo
   escrita y probada cinco unidades antes de estar enchufada; mientras tanto el
   visor inundaba 18 hectáreas con un umbral pelado.
4. **Dos caminos de lectura se separan solos.** `decodificarCelda` perdía la
   bandera de agua mientras `vistasDeCelda` la exponía: nada parecía roto, pero
   cualquier herramienta escrita contra la API amable contaba cero agua. Hay una
   prueba que exige que los dos caminos cuenten lo mismo, y esa prueba vale más
   que la representación que se elija.
