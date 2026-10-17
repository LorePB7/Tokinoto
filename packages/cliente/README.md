# @tokinoto/cliente

Interfaz web de Tokinoto (React 19, Vite y Zustand). Se puede jugar un juego entero entre varias pestañas (etapa 5), con reconexión, tiempo límite y piloto automático (etapa 6). Desde la etapa 8 tiene el aspecto de una pulpería argentina: madera gastada, paño verde botella, cartel de papel, tipografía de cartel antiguo y fichas bordó. Es sobrio y sin animaciones.

## Cómo correrlo

```bash
npm run iniciar -w @tokinoto/servidor   # servidor en el puerto 3001
npm run dev -w @tokinoto/cliente        # cliente en http://localhost:5173
```

Para jugar, abrí entre 4 y 7 pestañas. Una crea la sala y las demás entran con el código o con el enlace `?sala=CODIGO` que ofrece la sala de espera.

El cliente busca el servidor en `VITE_SERVIDOR`. Si no está definida, usa el puerto 3001 del mismo equipo desde el que se abrió la página.

## Pruebas

```bash
npm test -w @tokinoto/cliente        # utilidades, registro, tienda y componentes
npm run typecheck -w @tokinoto/cliente
npm run e2e -w @tokinoto/cliente -- --jugadores 7 --capturas ./capturas
```

- Las pruebas de tienda y de componentes usan un **servidor real** en un puerto libre, con pausas cortas. No hay maquetas del servidor.
- `e2e` levanta el servidor y Vite, abre un Chromium por jugador (el último con pantalla de celular), juega un juego completo tocando la pantalla y verifica que todos vean el mismo ranking, sin avisos de error ni errores de consola. A mitad del juego, un jugador recarga la página y otro cierra la pestaña (juega el piloto) y vuelve desde una nueva con "Volver a esa partida". Al final prueba la revancha. Con `--capturas` guarda imágenes de cada pantalla.
- Hace falta Chromium: el que instala Playwright (`npx playwright-core install chromium`) o uno propio indicado en `CHROMIUM_PATH`.

## Estructura

```
src/
  estado/      tienda.ts (conexión y estado), registro.ts (texto de los eventos), contexto.tsx
  componentes/ Carta, Ficha, Asiento, MesaRedonda, PanelApuesta, Mano, Registro, Reglas, Resumen, Resultados, Aviso
  pantallas/   Inicio, Lobby, Mesa
  util/        cartas.ts, geometria.ts (asientos alrededor de la mesa), preferencias.ts
test/          pruebas con Vitest y Testing Library
e2e/           prueba de punta a punta con navegadores reales
```

## Cómo funciona

- El cliente **no deduce nada**: muestra lo que confirma el servidor. Mantiene la última foto y le aplica los eventos con `aplicarMensaje` (de `@tokinoto/protocolo`). Si nota un salto en `seq`, pide una foto nueva con `sync.pedir`.
- Cada comando lleva un `idPedido` y espera la respuesta hasta 10 s. Los rechazos se muestran como un aviso que se cierra solo.
- La mesa es redonda: yo estoy abajo y el juego gira hacia la derecha, así que los asientos siguientes van hacia la derecha de la pantalla y luego hacia arriba.
- Nunca se reciben cartas ajenas; de los demás solo se ve la cantidad.

## Aspecto y ayudas para principiantes (etapa 8)

- **Estilo.** Todo el aspecto vive en `src/estilos.css`, con los colores y tipografías definidos como variables al principio. Los títulos usan Abril Fatface y los nombres y números, Playfair Display (paquetes `@fontsource`, que viajan con la aplicación: no se piden a Internet). El texto corrido usa la letra del sistema, por legibilidad.
- **Fichas.** Todas son iguales (bordó); lo que cambia es el número.
- **Acciones claras.** Cuando te toca apostar aparece un cartel con un botón por cada número posible; el que el Pié no puede elegir queda tachado. Cuando te toca jugar, tus cartas se marcan con un borde y una indicación ("Tocá la carta que querés jugar"). El turno propio se ve en una etiqueta destacada.
- **Reglas.** El botón "Reglas" (arriba a la derecha, en todas las pantallas) abre un panel al costado con cómo se juega, el valor de las cartas de menor a mayor (incluido el Comodín), la restricción del Pié, los puntos y el desempate. Se cierra con "Cerrar" o con Escape. El texto sigue la especificación aprobada (v4).

## Ausencias (etapa 6)

- **Reconexión:** el token de la sesión se guarda en la pestaña (`sessionStorage`). Si se corta la conexión, la tienda reintenta sola y vuelve al asiento con `sala.reconectar`; al recargar la página, también. Mientras tanto se muestra "Volviendo a la mesa…".
- **Otra pestaña:** la última sesión también queda en `localStorage`, y la pantalla de inicio ofrece "Volver a esa partida" (por ejemplo, si se cerró la pestaña). Si la misma sesión se abre en dos pestañas, la anterior se desconecta y ofrece "Jugar en esta pestaña".
- **Tiempo límite:** el turno muestra la cuenta regresiva, corregida con la hora del servidor. Al crear la sala se elige 30 s, 60 s o sin límite.
- **Piloto automático:** quien está ausente lleva la insignia "Piloto". Si a mí se me vence el tiempo 3 veces seguidas, aparece "Retomar el control".
- **Salir:** durante el juego, "Salir" pide confirmación: el asiento queda y el piloto juega hasta el final.
