# @tokinoto/cliente

Interfaz web de Tokinoto (React 19, Vite y Zustand). Es la etapa 5: se puede jugar un juego entero entre varias pestañas. El diseño es sobrio y sin animaciones; el pulido llega en la etapa 8.

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
- `e2e` levanta el servidor y Vite, abre un Chromium por jugador (el último con pantalla de celular), juega un juego completo tocando la pantalla y verifica que todos vean el mismo ranking, sin avisos de error ni errores de consola. Después prueba la revancha. Con `--capturas` guarda imágenes de cada pantalla.
- Hace falta Chromium: el que instala Playwright (`npx playwright-core install chromium`) o uno propio indicado en `CHROMIUM_PATH`.

## Estructura

```
src/
  estado/      tienda.ts (conexión y estado), registro.ts (texto de los eventos), contexto.tsx
  componentes/ Carta, Ficha, Asiento, MesaRedonda, PanelApuesta, Mano, Registro, Resumen, Resultados, Aviso
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

## Límites conocidos (etapa 6)

- No hay reconexión: si se corta la conexión, aparece una pantalla para volver al inicio.
- Durante el juego no hay botón de salir.
- Si alguien se desconecta, la mesa espera su turno: todavía no hay tiempo límite ni piloto automático.
