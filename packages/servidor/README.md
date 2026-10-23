# @tokinoto/servidor

Servidor autoritativo de Tokinoto (etapas 3, 4, 6 y 7). Maneja salas privadas con código de invitación, mantiene el estado en memoria y valida cada jugada con el motor de reglas (`@tokinoto/reglas`). Se comunica con los navegadores por Socket.IO.

El protocolo de mensajes está documentado en [`docs/protocolo.md`](../../docs/protocolo.md). Los esquemas, las vistas y el seguimiento del lado del cliente están en el paquete compartido [`@tokinoto/protocolo`](../protocolo).

## Uso

Desde la raíz del repositorio:

```bash
npm run iniciar -w @tokinoto/servidor
# Servidor de Tokinoto escuchando en el puerto 3001
```

| Variable de entorno | Significado | Por defecto |
|---|---|---|
| `PUERTO` o `PORT` | Puerto HTTP (Render define `PORT`) | `3001` |
| `NODE_ENV` | `production`: entrega también el cliente web (`packages/cliente/dist`), agrega HSTS y exige orígenes definidos | sin definir: desarrollo |
| `TOKINOTO_ORIGENES` | Sitios web permitidos, separados por coma (por ejemplo `https://tokinoto.com`) | en Render, `RENDER_EXTERNAL_URL`; en desarrollo, `*` (cualquiera). En producción `*` no se permite |
| `TOKINOTO_CLIENTE` | Carpeta del cliente construido | en producción, `packages/cliente/dist` |
| `DATABASE_URL` | Conexión a PostgreSQL para guardar el historial de los juegos (etapa 7). `sslmode=require` se convierte en `verify-full` | sin definir: no se guarda nada |

`GET /salud` responde `ok`. Sirve para que el alojamiento compruebe que el servidor está vivo.

## Cómo funciona

- **Servidor autoritativo.** El cliente manda intenciones ("quiero apostar 2"). La sala las valida con el motor y emite los eventos resultantes. El jugador se identifica por su conexión, nunca por lo que diga el mensaje.
- **Una sala = un estado = una cola.** Comandos, pausas programadas y desconexiones se procesan de a uno y en orden. Dos jugadas simultáneas nunca se pisan.
- **Eventos numerados.** Cada evento lleva un `seq` correlativo y queda guardado en el registro de la sala. Ese registro sirve para resincronizar a los clientes.
- **Información oculta.** Cada jugador recibe solo su vista (`proyectarJuego`): sus cartas, y de los demás solo cuántas tienen. Las cartas ajenas se ven al ser jugadas.
- **Fotos.** Al entrar, al volver con `sala.reconectar` y cuando el cliente pide `sync.pedir`, recibe una foto con su vista completa de la sala y del juego en curso.
- **Ausencias (etapa 6).** Cada jugada tiene tiempo límite (30 s por defecto, configurable por sala o sin límite). Si vence, juega el piloto automático; tras 3 vencimientos seguidos, el piloto toma el asiento hasta que el jugador actúe. Si alguien se desconecta o abandona, el asiento queda y juega el piloto. Con su token, vuelve cuando quiera. Si no queda nadie conectado durante 3 minutos, el juego se aborta. Detalle en [`docs/protocolo.md`](../../docs/protocolo.md#ausencias-tiempo-límite-piloto-automático-y-reconexión).
- **Historial (etapa 7).** Si hay `DATABASE_URL`, cada juego se guarda en PostgreSQL (puntajes, ranking y registro de eventos del motor). El guardado va aparte del juego: se escribe en orden y en lotes, reintenta si la base falla y, si no lo logra, avisa del error pero la partida sigue. No se retoman juegos en curso tras un reinicio: se cierran como abortados (DT-05). Detalle en [`@tokinoto/persistencia`](../persistencia).
- **El tiempo lo maneja el servidor.** La baza resuelta queda 3 s a la vista y el resumen de cada partida dura 6 s, sin pausa. El reloj es inyectable para probar sin esperas.
- **Idempotencia.** Un comando repetido con el mismo `idPedido` se ejecuta una sola vez.
- **Seguridad básica.** Validación con Zod, límite de frecuencia y de tamaño por conexión, control de origen, códigos de sala no adivinables y azar criptográfico.

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `sala.ts` | Sala: lobby, juego, cola de tareas, pausas, emisión de eventos y fotos |
| `eventos.ts` | Traduce los eventos del motor a eventos del protocolo, separando los datos privados |
| `gestor.ts` | Crea y busca salas, y genera los códigos de invitación |
| `servidor.ts` | HTTP + Socket.IO: conexiones, límite de frecuencia y origen |
| `limitador.ts` | Límite de frecuencia por conexión |
| `guardador.ts` | Guarda el historial sin frenar el juego: orden, lotes y reintentos |
| `reloj.ts` | Reloj real o manual (para las pruebas) |
| `principal.ts` | Punto de entrada |

La sala no conoce Socket.IO: recibe un `Destino` por jugador. Así sus pruebas corren sin red.

## Pruebas

```bash
npm test -w @tokinoto/servidor
```

- **Sala, sin red y con reloj manual:** lobby, anfitrión, inicio, cada código de error, idempotencia, pausas de 3 s y 6 s, revancha, desconexiones y juegos completos de 4 a 7 jugadores. También verifica que nadie ve una carta ajena antes de que se juegue y que el `seq` llega sin saltos.
- **Vistas (etapa 4):** en cada paso de juegos completos de 4 a 7 jugadores, lo que cada cliente reconstruye con los eventos es idéntico a la foto que le armaría el servidor. Esto también vale con pausas, desconexiones, cambio de anfitrión y revancha, y con ausencias al azar: desconexiones, reconexiones, vencimientos, piloto y abandono.
- **Ausencias (etapa 6):** fecha límite de cada turno, jugada del piloto al vencer (menor apuesta válida, carta más baja), toma del asiento tras 3 vencimientos y reinicio de la cuenta al jugar a tiempo, desconexión en el turno, reconexión con token, conexión reemplazada, abandono, aborto sin nadie conectado (y su cancelación si alguien vuelve), gracia en el lobby y revancha con ausentes. Juegos completos con 3 ausentes y sin que nadie juegue nunca. Además, `sync.pedir` funciona y ninguna foto contiene cartas ajenas ni tokens.
- **Historial (etapa 7):** juegos completos guardados con sus puntajes, ranking y eventos (contra PGlite), revancha, aborto por falta de jugadores y por apagado del servidor, y que las manos guardadas para auditar nunca llegan a los demás jugadores. Si la base falla siempre, a ratos o lanza excepciones, el juego se juega completo igual; sin base, el servidor funciona como antes.
- **Seguridad:** códigos de sala, límite de frecuencia y origen.
- **Integración con Socket.IO real:** clientes simulados juegan juegos completos de 4 y de 7 jugadores, y deciden solo con el estado que reconstruyen con `aplicarMensaje`, igual que hará el navegador. No hay ningún rechazo. Un cliente que pierde eventos lo detecta, pide una foto y termina el juego sabiendo lo mismo que los demás.

## Límites actuales

- El estado vive en memoria: un reinicio del servidor termina las salas activas (la persistencia llega en la **etapa 7**).
- **Publicación (etapa 9).** En producción el mismo servidor entrega la página (cargada en memoria, comprimida con gzip, con política de contenido y cabeceras de seguridad), responde `/salud` para la vigilancia de Render y limita las conexiones simultáneas (300). Guía en [`docs/despliegue.md`](../../docs/despliegue.md).
