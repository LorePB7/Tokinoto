# Auditoría responsive (fase 1)

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
