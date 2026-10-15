# @tokinoto/servidor

Servidor autoritativo de Tokinoto (etapas 3 y 4). Maneja salas privadas con código de invitación, mantiene el estado en memoria y valida cada jugada con el motor de reglas (`@tokinoto/reglas`). Se comunica con los navegadores por Socket.IO.

El protocolo de mensajes está documentado en [`docs/protocolo.md`](../../docs/protocolo.md). Los esquemas, las vistas y el seguimiento del lado del cliente están en el paquete compartido [`@tokinoto/protocolo`](../protocolo).

## Uso

Desde la raíz del repositorio:

```bash
npm run iniciar -w @tokinoto/servidor
# Servidor de Tokinoto escuchando en el puerto 3001
```

| Variable de entorno | Significado | Por defecto |
|---|---|---|
| `PUERTO` | Puerto HTTP | `3001` |
| `TOKINOTO_ORIGENES` | Sitios web permitidos, separados por coma (por ejemplo `https://tokinoto.com`) | `*` (cualquiera; solo para desarrollo) |

`GET /salud` responde `ok`. Sirve para que el alojamiento compruebe que el servidor está vivo.

## Cómo funciona

- **Servidor autoritativo.** El cliente manda intenciones ("quiero apostar 2"). La sala las valida con el motor y emite los eventos resultantes. El jugador se identifica por su conexión, nunca por lo que diga el mensaje.
- **Una sala = un estado = una cola.** Comandos, pausas programadas y desconexiones se procesan de a uno y en orden. Dos jugadas simultáneas nunca se pisan.
- **Eventos numerados.** Cada evento lleva un `seq` correlativo y queda guardado en el registro de la sala. Ese registro va a servir para resincronizar (etapa 4) y para guardar en la base (etapa 7).
- **Información oculta.** Cada jugador recibe solo su vista (`proyectarJuego`): sus cartas, y de los demás solo cuántas tienen. Las cartas ajenas se ven al ser jugadas.
- **Fotos.** Al entrar, y cuando el cliente pide `sync.pedir`, recibe una foto con su vista completa de la sala y del juego en curso.
- **El tiempo lo maneja el servidor.** La baza resuelta queda 3 s a la vista y el resumen de cada partida dura 10 s, con pausa opcional del anfitrión. El reloj es inyectable para probar sin esperas.
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
| `reloj.ts` | Reloj real o manual (para las pruebas) |
| `principal.ts` | Punto de entrada |

La sala no conoce Socket.IO: recibe un `Destino` por jugador. Así sus pruebas corren sin red.

## Pruebas

```bash
npm test -w @tokinoto/servidor
```

- **Sala, sin red y con reloj manual:** lobby, anfitrión, inicio, cada código de error, idempotencia, pausas de 3 s y 10 s, pausa del resumen, revancha, desconexiones y juegos completos de 4 a 7 jugadores. También verifica que nadie ve una carta ajena antes de que se juegue y que el `seq` llega sin saltos.
- **Vistas (etapa 4):** en cada paso de juegos completos de 4 a 7 jugadores, lo que cada cliente reconstruye con los eventos es idéntico a la foto que le armaría el servidor. Esto también vale con pausas, desconexiones, cambio de anfitrión y revancha. Además, `sync.pedir` funciona y ninguna foto contiene cartas ajenas ni tokens.
- **Seguridad:** códigos de sala, límite de frecuencia y origen.
- **Integración con Socket.IO real:** clientes simulados juegan juegos completos de 4 y de 7 jugadores, y deciden solo con el estado que reconstruyen con `aplicarMensaje`, igual que hará el navegador. No hay ningún rechazo. Un cliente que pierde eventos lo detecta, pide una foto y termina el juego sabiendo lo mismo que los demás.

## Límites actuales

- Si un jugador se desconecta durante el juego, su asiento se conserva, pero el juego espera su turno. La reconexión con el token, el tiempo límite y el piloto automático llegan en la **etapa 6**.
- Si se desconectan todos, la sala se cierra.
- El estado vive en memoria: un reinicio del servidor termina las salas activas (la persistencia llega en la **etapa 7**).
