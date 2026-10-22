# Auditoría responsive (fases 1 a 3)

Medición del diseño que había en `main` antes de la fase 1, para saber dónde está el problema antes de tocarlo.
Es la base de las fases 2 a 4 del plan de mejoras.

## Cómo se midió

El e2e tiene un modo nuevo que **no hace fallar la prueba, solo mide e informa**:

```
npm run e2e -w @tokinoto/cliente -- --jugadores 7 --auditoria --capturas carpeta
npm run e2e -w @tokinoto/cliente -- --jugadores 7 --dispositivos --auditoria --capturas carpeta
```

En cada vista (inicio, sala de espera, reglas, apostar, mesa en juego, resumen, resultado final) mide, en los 38 tamaños
del barrido y en los tamaños propios de cada navegador:

- **Solapes:** elementos de un asiento que se pisan entre sí, asientos que pisan a otro asiento, cartas de la baza que
  pisan un asiento y montones que pisan a un asiento ajeno.
- **Textos chicos:** menos de 12 px en nombre, marcador, insignias y turno.
- **Toques chicos:** botones y enlaces con un lado menor a 44 px (la medida habitual de las guías de plataformas móviles).
  Las cartas de la mano quedan fuera.

Con `--capturas` deja además un `auditoria.json` con el detalle. Los números de abajo son de una partida de 7 jugadores,
el caso más apretado.

## Resultado

| Qué se midió | Resultado en `main` |
| --- | --- |
| Mesa con solapes (tamaños del barrido) | 16 de 39 |
| Mesa con solapes (dispositivos y tamaños propios) | 23 de 45 |
| Texto más chico en la mesa | 8 px (insignias "Pié", "Mano") |
| Botones de la barra superior en celular | 34 px de alto; "Reglas" de 42 × 34 px |
| Botones de apostar en celular | 39 × 46 px |
| Scroll de página en todas las vistas | 0 px (ya estaba resuelto, no se toca) |

### 1. Panel de Reglas (corregido en esta fase)

Era un cajón fijo a la derecha, de hasta 430 px, en todos los tamaños. En un celular se veía igual que en escritorio
(ver `auditoria-responsive/reglas-movil-antes.png`). Ahora es un componente `Panel` compartido: cajón con fondo oscurecido en
pantallas anchas y hoja que sube desde abajo en celulares, de hasta 820 px de ancho
(`auditoria-responsive/reglas-movil-despues.png`). Se cierra con el botón, con Escape o tocando el fondo, y el foco no se
sale del panel. Reglas ya lo usa; Puntos y Chat lo van a usar.

### 2. Mesa: elementos que se pisan (fase 2)

- **Celulares chicos** (320 × 568, 360 × 560, 568 × 320 y iPhone SE): el asiento propio pisa a sus dos vecinos, hasta
  13 px de ancho y 44 px de alto.
- **Escritorio bajo** (1024 × 600, 1152 × 648, 1280 × 600): los asientos 1-2, 2-3 y 4-5 se pisan entre 1 y 4 px, y en los
  dispositivos hasta 29 px.
- **La carta de la baza pisa a un asiento** en casi todas las pantallas de escritorio y en varios celulares, entre 1 y 30 px
  (por ejemplo 1280 × 720, 1366 × 650, 360 × 640, iPhone 13).

Hoy los asientos se ubican sobre un círculo con `left` y `top` en porcentajes. Cada asiento tiene un tamaño propio que no se
reserva en una grilla, y por eso se pisan cuando la mesa se achica. La fase 2 le da su celda a cada elemento.

### 3. Mesa: textos chicos (fase 2)

| Elemento | Tamaño hoy |
| --- | --- |
| Insignias "Pié" y "Mano" | 8 px |
| Marcador de apuesta y bazas | 8,7 a 11,6 px |
| Nombre del jugador | 10 a 11,5 px |

### 4. Botones chicos (fases 1 y 2)

- Barra superior en celular: "Registro" 73 × 34, "Reglas" 42 × 34, "Salir" 51 × 34.
- Apostar con 7 cartas en celular: 39 × 46 (el ancho queda corto porque son ocho botones en una fila).
- Pestañas de Reglas: 83 × 40.

La barra necesita una decisión de diseño antes de seguir (ver abajo).

### 5. El "×N" y los dorsos en celular

En pantallas de hasta 820 px de ancho las cartitas dadas vuelta de cada asiento están ocultas (`.dorsos .mini`), así que
hoy el texto "×N" es lo único que indica cuántas cartas tiene cada jugador. Borrar el "×N" (pedido 8) deja a los celulares sin
ningún indicador. Hay que decidir si se muestran los dorsos en celular o si ahí se deja el número.

## Barra superior: propuesta

Con Puntos, Chat y Sonido la barra pasaría de 3 a 6 botones. De 44 px cada uno no entran en 360 px de ancho. La propuesta
(`auditoria-responsive/barra-propuesta.png`):

- A mano: **Puntos** y **Chat** (con insignia de mensajes sin leer), de 44 × 44 px, con ícono.
- Dentro de un botón **Menú** (los tres puntos): Reglas, Registro, Sonido y Salir.

Queda sin aplicar hasta que se confirme.

## Qué queda para las fases siguientes

| Fase | Qué toma de esta auditoría |
| --- | --- |
| 2 | Celdas propias para cada elemento del asiento, tamaños mínimos de texto y la decisión sobre el "×N" |
| 3 | Panel de Puntos y pantalla de carga sobre el `Panel` |
| 4 | Control de sonido en la barra |
| 7 | Panel de Chat sobre el `Panel` |

## Resultado de la fase 2 (mesa más clara)

Qué cambió en la mesa:

- Cada jugador muestra "Apostó N" y "Ganó M" en dos renglones, al lado de la ficha. El "×N" se eliminó por completo.
- Los asientos se ubican sobre una elipse que usa el ancho disponible (antes, un círculo del tamaño de la mesa). Las
  medidas salen de propiedades CSS registradas (`--rx`, `--ry`), así que no hace falta JavaScript.
- Todo el texto del asiento tiene 12 px o más (antes llegaba a 8 px). La cuenta regresiva va en el renglón de las insignias.
- Las cartas de la baza se juntan más hacia el centro cuando hay muchos jugadores.
- La tabla de fin de partida se ordena de mayor a menor total y los empatados comparten lugar.

| Qué se midió | Fase 1 (`main`) | Fase 2 |
| --- | --- | --- |
| Mesa con solapes, tamaños del barrido (7 jugadores) | 16 de 39 | 7 de 39 |
| Mesa con solapes, dispositivos y tamaños propios | 23 de 45 | 11 de 45 |
| Texto más chico en la mesa | 8 px | 12 px |

Lo que sigue con solapes: celulares muy chicos con 7 jugadores (320 × 568, 568 × 320, iPhone SE), 360 × 560 y 360 × 640,
y escritorios bajos (1024 × 600 y parecidos) con solapes de 1 a 8 px. Con 7 asientos de 12 px de texto, 320 px de ancho no
alcanzan y se deja como "que funcione". Los casos de 360 px son el siguiente candidato si hace falta seguir (por ejemplo
acortando la zona de la mano). Los solapes siguen siendo informativos: el e2e los informa pero no falla por ellos.

## Fase 3: barra, Puntos, pantalla de carga y firma

- **Barra de la mesa.** En pantallas anchas quedan Puntos, Reglas y Salir a la vista. En celulares (hasta 820 px de ancho, o
  acostados y bajos) quedan **Puntos** y **Menú**, de al menos 44 × 44 px; dentro del Menú van Reglas, Registro y Salir.
  El e2e comprueba esas medidas. Chat y Sonido se suman a la barra en las fases 4 y 7.
- **Panel de Puntos.** Usa el `Panel` compartido (cajón en escritorio, hoja en celular). Tabla de mayor a menor total con
  lugares compartidos; el total va antes de las partidas para verlo sin desplazar, y las partidas que faltan muestran "–".
  El e2e verifica el orden y que el panel entre en la pantalla.
- **Pantalla de carga.** "El Niño Games" y "Un juego 100% argentino", una sola vez al abrir el juego: se va a los 1,8 segundos
  o con un toque, Enter o Escape. Respeta "reducir movimiento".
- **Firma.** "Hecho por Lorenzo Píccolo · El Niño Games" al pie del inicio y de la sala de espera. En pantallas de menos de
  640 px de alto no se muestra, porque ahí no hay lugar sin hacer scroll.

## Arreglo: entrada (login) y pantalla de carga

Barrido de la entrada en los 39 tamaños, antes y después del cambio.

- **Entrada apilada en todas las pantallas.** Antes, desde 560 px de ancho, Google e invitado iban en dos columnas en una
  tarjeta de 760 px. Ahora es una tarjeta de 420 px como en celular: Google arriba, una línea con "o" y el invitado abajo.
  Se sacó la frase "Guardamos tu nombre y tus partidas. Nunca tu correo." (sigue en la página de privacidad).
- **Botón de Google cortado en los extremos.** Google lo dibuja en un iframe con ancho fijo en píxeles, 10 px más ancho por
  lado que el botón para el brillo al pasar y al tocar. El contenedor tenía `overflow: hidden`, que cortaba ese brillo, y el
  ancho se calculaba una sola vez: si la ventana se achicaba, el botón quedaba más ancho que su lugar. Ahora el contenedor no
  corta y el botón se vuelve a dibujar cuando cambia el ancho disponible. El e2e verifica en el barrido que el botón entre
  en su lugar.
- **Ventanas muy bajas (hasta 440 px de alto).** Apilada, la entrada se pasaba 25 px en 568 × 320. Ahí se ocultan los
  títulos "Con Google" y "Como invitado": los botones ya lo dicen.
- **Enlace "Privacidad".** Medía 70 × 17 px para tocar; ahora tiene área de toque de 44 px de alto sin mover el texto.
- **Pantalla de carga.** Suma "Desarrollado por Lorenzo Píccolo" debajo de "Tocá para entrar". El e2e lo verifica.

Quedan, sin cambiar (fuera de este alcance):

- El botón de Google mide 40 px de alto: es el tamaño "large" de Google y no se puede agrandar.
- Los botones flotantes Sonido y Reglas miden 36 px de alto en celulares (menos de los 44 recomendados). Son los mismos de la
  sala de espera, así que agrandarlos se prueba aparte.
