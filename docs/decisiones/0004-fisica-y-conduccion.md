# 0004 — Física y conducción

- **Estado**: aceptada
- **Fecha**: 2026-09-25
- **Ámbito**: runtime del navegador — mundo de colisiones, vehículo y origen flotante

## Contexto

Hasta este hito la ciudad se podía mirar pero no tocar: volúmenes extruidos
sobre huellas reales y una cámara libre que los atravesaba. El objetivo ahora es
que se pueda **conducir** por ella, y eso obliga a tomar tres decisiones que no
se pueden retocar después sin rehacer el runtime: qué motor de física, qué forma
tiene un edificio para el que choca contra él, y cómo conviven las colisiones
con el origen flotante de la decisión 0001.

## Decisión

### 1. Rapier, y concretamente `@dimforge/rapier3d-compat`

Se usa `@dimforge/rapier3d-compat`, fijado en **0.21.0** y verificado contra el
registro de npm el día de la decisión.

El paquete normal (`@dimforge/rapier3d`) **no sirve en este proyecto**. Está
pensado para pasar por un empaquetador: sus imports internos van sin extensión y
trae un import de WebAssembly que el ESM nativo del navegador no sabe resolver.
URBS no tiene empaquetador ni paso de compilación, por decisión previa. El
paquete `compat` es un único archivo `dist/rapier.mjs` con el wasm incrustado en
base64 y **sin un solo import interno**, así que entra en el mapa de
importaciones exactamente igual que `three` y `earcut`.

El precio es que hay que **`await RAPIER.init()` antes de tocar cualquier cosa**
de la librería. Por eso el arranque del visor es asíncrono.

### 2. Un casco convexo por edificio, deducido de la huella

El colisionador de un edificio es un **casco convexo** (`ColliderDesc.convexHull`)
construido con los vértices de su anillo exterior a cota cero y a cota de
cornisa. Se deduce de la **huella**, nunca de la malla triangulada: si saliera
del triangulado, cualquier cambio en las reglas de fachada movería las paredes
contra las que se choca.

Se descarta la malla de triángulos (`trimesh`) por dos motivos. Es cara de
construir y de consultar con miles de edificios por celda, y sobre todo es una
**superficie sin volumen**: un coche rápido la atraviesa entre dos pasos de
simulación sin que nadie note el contacto.

El precio del casco convexo es real y se acepta a conciencia: **un edificio en L
se rellena por la escotadura**. No se puede entrar en el hueco de una L, que a
ras de calle casi nunca es un sitio al que se pueda ir. En un casco medieval
esto además estrecha las calles, y por eso el coche nace sobre la calle más
**ancha** de su celda y no sobre la más larga.

`convexHull` devuelve `null` con anillos degenerados y **hay que comprobarlo**:
pasarle `null` a `createCollider` revienta la celda entera por un edificio mal
digitalizado. Se comprueba, se cuenta y se enseña en pantalla. Sobre los 5.459
edificios reales de este territorio **no se rechaza ninguno**, porque el pipeline
ya filtra los anillos sin superficie al escribir la celda; el contador sigue ahí
para que el día que deje de ser cierto se vea, en lugar de deducirse.

### 3. Los colisionadores entran y salen con su celda

Un **cuerpo fijo por celda**, con todos sus cascos colgando de él. La celda ya es
la unidad de carga y descarga del streaming, así que también es la unidad del
mundo físico. Además abarata el rebase: mover cincuenta cuerpos en vez de cinco
mil.

Tres reglas que no son opcionales:

- **`removeCollider(colisionador, true)`.** El `true` despierta lo que dormía
  encima. Un cuerpo dormido sobre una celda que se descarga no se entera de que
  el suelo ha desaparecido y se queda flotando.
- **Los manejadores de colisionador se RECICLAN al borrarlos.** Nunca se guarda
  un manejador crudo: los mapas van por clave de celda y los objetos de Rapier
  viven dentro de la entrada de su celda.
- **La retirada se reparte entre fotogramas.** Soltar una celda del casco viejo
  son doscientos y pico `removeCollider`, y hacerlos de golpe se ve como un
  tirón. La cola respeta el orden de entrada, que aquí no es cosmético: los
  colisionadores tienen que irse **antes** que el cuerpo que los sostiene,
  porque quitar el cuerpo invalida los que sigan esperando turno.

### 4. El radio de físicas es mayor que el de render

**1.500 m de colisiones contra 1.100 m de dibujo**, y `radiosDeStreaming` lo
comprueba al arrancar en lugar de confiarlo a que nadie toque los números.

No es un margen de cortesía. Si el mundo físico acabara donde acaba lo que se
ve, se llegaría al borde justo cuando la celda de delante aún no ha bajado, y se
caería por un agujero que además no se ve venir. Con el colchón, cuando pisas el
último suelo dibujado llevas ya una celda larga de suelo invisible por delante.

El precio es bajo: el anillo de más se descarga y da cascos convexos, pero no
produce ni un triángulo ni una llamada de dibujo.

### 5. El rebase mueve el grafo de escena y el mundo de Rapier en el MISMO fotograma

Es la regla 3 de la decisión 0001, y con físicas delante pasa de ser un consejo a
ser **la parte más peligrosa del motor**.

Mover los gráficos y no los colisionadores no se ve venir: la ciudad se dibuja
perfectamente y el coche se cae a través del suelo, o aparece dentro de un
edificio a un kilómetro de donde estaba. El síntoma no se parece en nada a la
causa, y el fallo solo ocurre cada vez que se recorre un kilómetro.

**La forma de no incumplir la regla no es acordarse: es no poder.** Nadie llama a
`rebasarSiHaceFalta` por su cuenta. Se llama a `crearRebase(...).aplicar(...)`, y
esa función muda el ancla y avisa a **todos** los sujetos apuntados —la escena,
el mundo físico, el coche y la cámara— antes de devolver el control. Un sujeto
que se olvide de apuntarse se nota enseguida; un sujeto al que se avise un
fotograma tarde, no.

Dos detalles que se derivan de ahí:

- Antes de mover nada se **vacía la cola de retiradas entera**. Un colisionador
  que espera turno pertenece a un cuerpo que ya no está en el mapa de celdas y
  que por tanto no se va a rebasar: se quedaría un par de fotogramas en el sitio
  viejo, que tras el rebase es un sitio equivocado por un kilómetro. Un fantasma
  contra el que chocar.
- El coche se rebasa **despertándolo** (`wakeUp = true`) y los cuerpos de celda
  no. Los cuerpos de celda son fijos y lo que esté encima se mueve el mismo delta
  en el mismo fotograma, así que ninguna posición relativa cambia. El coche, en
  cambio, es dinámico: si estuviera dormido se quedaría en el sitio viejo
  mientras la ciudad entera se mueve un kilómetro, es decir, dentro de un
  edificio.

Si un sujeto falla al rebasar, la excepción **sube**. Tragársela dejaría el ancla
mudada y media ciudad sin mover, que es exactamente el estado incoherente que
toda esta pieza existe para evitar.

### 6. Vehículo de rayos, no ruedas simuladas

El coche usa `DynamicRayCastVehicleController`: un rayo por rueda hacia abajo, y
de la distancia al suelo salen la suspensión, el agarre y el empuje. Es un coche
**arcade**, no un simulador: sin embrague, sin marchas y sin curva de par. El
objetivo declarado es que se pueda dar una vuelta por la Ciudad Vieja treinta
segundos sin pelearse con él.

Lo que decide cómo se *siente* el coche vive en `src/conduccion.js`, que es puro
y está probado en Node. `publico/coche.js` solo traduce sus tres números —fuerza
de motor, freno y ángulo de dirección— a llamadas de Rapier. Dos reglas del
estado, que son casi todo lo que separa "se conduce solo" de "es imposible":

- **El freno no es la marcha atrás.** La misma tecla hace las dos cosas, pero
  cuál depende de si el coche va hacia delante o está parado. Sin ese estado,
  pisar el freno a ochenta lanza el coche marcha atrás.
- **La dirección se cierra con la velocidad.** Con el mismo tope a 100 que a 10,
  el coche da un trompo a la mínima corrección.

### 7. El suelo es un plano en y = 0, y no se rebasa

No hay modelo digital del terreno todavía, así que el suelo es una losa fija en
`y = 0`. **Eso es lo correcto para este hito y no un apaño**: la ciudad se generó
plana, y los edificios arrancan todos a cota cero.

Conviene decirlo claro porque se nota al mirar: **A Coruña tiene cuestas de
verdad y aquí no hay ninguna**. Las alturas que varían son las de los edificios
(de 2 a 119 m), no las del terreno. El relieve entra cuando entre el MDT LiDAR
del PNOA, con `ColliderDesc.heightfield`, alturas en orden de **columna** (los
ráster vienen por filas: hay que trasponer una vez en el pipeline) y
`HeightFieldFlags.FIX_INTERNAL_EDGES`, o los vehículos dan botes en terreno
llano.

El suelo **no se rebasa**, ni el visual ni el de físicas. Es uniforme e infinito
en intención, así que dejarlo clavado en el origen de la escena equivale a que
siga al jugador: haga lo que haga el ancla, siempre hay suelo debajo. Rebasarlo
solo serviría para que algún día se acabara.

### 8. La cámara libre es un volumen cinemático

La cámara no es un cuerpo físico y por eso atravesaba las fachadas. Se le da una
bola cinemática y un `KinematicCharacterController`: en vez de moverla a pelo, se
le pide a Rapier cuánto de ese movimiento **cabe**. El controlador además desliza
a lo largo de la pared en vez de clavarse.

Sin gravedad, sin pegado al suelo y sin escalones: no es un peatón, es una cámara
que vuela y a la que la ciudad le resulta sólida. `controles.js` pasa a devolver
la **intención** de movimiento en lugar de aplicarla, que es lo que permite
meterla por el mundo de colisiones antes de tocar la cámara.

## Lo que se aprendió en el navegador y no se podía deducir

Tres cosas costaron sesión de navegador porque el síntoma no señalaba a la causa:

1. **La geometría de la suspensión tiene que cuadrar con la del chasis.** Si el
   chasis apoya la panza antes de que las ruedas lleguen al suelo, ninguna rueda
   encuentra contacto, y un vehículo de rayos **solo empuja por las ruedas que
   tocan**. El coche aceleraba a fondo sin moverse. La cuenta está escrita en el
   código: el suelo queda a `|altura del eje| + reposo de suspensión + radio` por
   debajo del origen, y eso tiene que ser mayor que la semialtura del chasis. De
   aquí sale el contador "Ruedas en suelo" del panel, que es la única cosa en
   pantalla capaz de explicar ese fallo.
2. **El signo de `currentVehicleSpeed()` depende de cómo Rapier deduzca el eje
   "adelante" a partir del eje de las ruedas**, y salía invertido respecto al
   convenio de este proyecto. El coche arrancaba, la máquina de estados leía
   velocidad negativa, creía que iba marcha atrás y clavaba el freno; el
   resultado era un coche tartamudeando a 3 km/h. Ahora la velocidad se calcula
   proyectando la velocidad lineal sobre el "adelante" del chasis, que no depende
   de ningún convenio ajeno.
3. **El valor de freno de Rapier no son newtons.** Su escala no tiene nada que
   ver con la de la fuerza del motor: con 9.000 el coche pasaba de 91 km/h a
   parado en menos de un segundo. El valor actual está **medido**, no deducido.

## Consecuencias

- El arranque del visor es asíncrono por el `init()` del wasm.
- Las dependencias de física viven en `urbs-viewer`. `urbs-core` sigue con **cero
  dependencias**, y hay una prueba que lo afirma.
- La física y el render se prueban donde se puede: las partes puras —geometría de
  calzada, derivación de cascos, aritmética del rebase, máquina de estados de
  conducción, cámara de persecución— tienen pruebas en Node. La simulación y el
  render se verifican en un navegador de verdad y se reporta lo que se ha visto.
  No se retuerce el diseño para fingir que se puede probar sin GPU.
- El panel del visor gana los contadores de física, que son el mismo detector de
  fugas que ya había para las geometrías: los cuenta **Rapier**, no el visor,
  porque una contabilidad propia se equivocaría igual que el código que pretende
  vigilar.
