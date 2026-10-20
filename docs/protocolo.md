# Protocolo cliente ↔ servidor (versión 1)

Este documento describe los mensajes que implementa `@tokinoto/servidor`. El diseño general está en [`diseno-tecnico.md`](diseno-tecnico.md), sección 4. Los esquemas, los tipos de cada mensaje y las vistas viven en el paquete compartido [`@tokinoto/protocolo`](../packages/protocolo), que usan tanto el servidor como el cliente. Este documento se mantiene junto a ellos.

## Transporte

- **Socket.IO** sobre WebSocket.
- El cliente envía cada comando en el evento **`comando`**.
- El servidor envía todo (respuestas, eventos y fotos) en el evento **`mensaje`**.

## Sobre común

| Campo | Significado |
|---|---|
| `v` | Versión del protocolo (hoy `1`) |
| `tipo` | Nombre del mensaje |
| `idPedido` | En comandos y en sus respuestas. Texto de 1 a 64 caracteres, único por comando |
| `seq` | En eventos y fotos: número correlativo dentro de la sala |
| `datos` | Contenido de cada tipo |

Reglas generales:

- **Idempotencia.** Si llega dos veces el mismo `idPedido` de un mismo jugador, el comando se ejecuta una sola vez y la respuesta se repite.
- **Orden.** La respuesta (`ok` o `error`) llega antes que los eventos que provocó el comando.
- **Rechazos privados.** Un `error` lo recibe solo quien envió el comando. Los demás no se enteran.
- **Identidad.** El servidor deduce quién es el jugador por su conexión. Ningún comando lleva el jugador, el asiento ni el turno.
- **Cartas.** Viajan como identificador: `"2-picas"` … `"10-corazones"`, `"J-diamantes"`, `"Q-treboles"`, `"K-picas"`, `"A-corazones"` y `"COMODIN"`. El cliente obtiene el valor con `getCardById` de `@tokinoto/reglas`.
- **Asientos.** Durante el juego, los jugadores se identifican por número de asiento (0 a n−1). "A la derecha" de un asiento es el siguiente. La lista de asientos llega en `juego.iniciado`.

---

## Comandos del cliente

| Tipo | Datos | Quién y cuándo |
|---|---|---|
| `sala.crear` | `{ nombre, tiempoTurno? }` | Cualquiera sin sala. La sala admite hasta 7 jugadores y el anfitrión inicia con 4 a 7 (DP-11). `tiempoTurno` son los segundos por jugada, de 10 a 120 (por defecto 30), o `null` para jugar sin límite (DP-13). `maxJugadores` es **obsoleto**: se acepta y se ignora, para no romper pestañas con un cliente viejo |
| `sala.configurar` | `{ tiempoTurno }` | Anfitrión, en el lobby, antes de iniciar. Cambia los segundos por jugada (10 a 120, o `null` sin límite) y todos reciben `sala.configuracion` |
| `sala.consultar` | `{ token }` | Cualquiera, sin estar en una sala. Responde `{ vigente }` (y `codigo` y `estado` si es `true`): si ese lugar sigue en una sala con el juego sin terminar. No conecta a nadie; sirve para ofrecer "volver a tu partida" solo cuando existe |
| `sala.unirse` | `{ codigo, nombre }` | Cualquiera sin sala, con el lobby abierto |
| `sala.reconectar` | `{ token }` | Cualquiera sin sala. Vuelve al asiento con el `token` que entregó `sala.crear` o `sala.unirse` (DP-14) |
| `sala.salir` | — | Cualquier jugador. Con el juego en curso es **abandonar**: el asiento queda y el piloto automático juega por él |
| `sala.iniciar` | — | Anfitrión, en el lobby, con 4 a 7 jugadores |
| `sala.pausarResumen` | `{ pausar }` | Anfitrión, durante el juego (DP-23) |
| `juego.apostar` | `{ valor }` | Quien tiene el turno de apuesta |
| `juego.jugarCarta` | `{ idCarta }` | Quien tiene el turno de tirada |
| `juego.retomarControl` | — | Quien tiene el piloto automático activo por vencimientos, con el juego en curso |
| `juego.revancha` | — | Anfitrión, con el juego terminado (DP-20) |
| `sync.pedir` | `{ ultimoSeq? }` | Cualquier jugador de la sala. Pide una foto nueva |
| `ping` | — | Cualquiera. Responde la hora del servidor |

Validaciones del esquema: el nombre se recorta y tiene de 1 a 20 caracteres, sin caracteres de control. El código de sala tiene 8 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` y se acepta en minúsculas. No se aceptan campos de más.

El cliente **no puede** pedir sortear, barajar, repartir, avanzar ni resolver una baza. Esos tipos no existen en el protocolo.

Ejemplos:

```json
{ "v": 1, "tipo": "sala.crear", "idPedido": "a1", "datos": { "nombre": "Ana" } }
{ "v": 1, "tipo": "sala.unirse", "idPedido": "b1", "datos": { "codigo": "K7QM2XPA", "nombre": "Beto" } }
{ "v": 1, "tipo": "sala.reconectar", "idPedido": "b3", "datos": { "token": "K7QM2XPA.…" } }
{ "v": 1, "tipo": "sala.salir", "idPedido": "b2" }
{ "v": 1, "tipo": "juego.retomarControl", "idPedido": "b4" }
{ "v": 1, "tipo": "sala.iniciar", "idPedido": "a2" }
{ "v": 1, "tipo": "sala.pausarResumen", "idPedido": "a3", "datos": { "pausar": true } }
{ "v": 1, "tipo": "juego.apostar", "idPedido": "a4", "datos": { "valor": 2 } }
{ "v": 1, "tipo": "juego.jugarCarta", "idPedido": "a5", "datos": { "idCarta": "K-corazones" } }
{ "v": 1, "tipo": "juego.revancha", "idPedido": "a6" }
{ "v": 1, "tipo": "sync.pedir", "idPedido": "a8", "datos": { "ultimoSeq": 41 } }
{ "v": 1, "tipo": "ping", "idPedido": "a7" }
```

## Respuestas

```json
{ "v": 1, "tipo": "ok", "idPedido": "a4", "datos": {} }
{ "v": 1, "tipo": "error", "idPedido": "a4", "datos": { "codigo": "APUESTA_PROHIBIDA_PIE", "mensaje": "..." } }
```

Algunas respuestas `ok` traen datos:

| Comando | `datos` del `ok` |
|---|---|
| `sala.crear`, `sala.unirse`, `sala.reconectar` | `{ codigo, idJugador, token }`. El `token` es secreto: sirve para recuperar el asiento al reconectar. Empieza con el código de la sala y sigue con 24 bytes de azar criptográfico |
| `ping` | `{ horaServidor }` en milisegundos |

Si el mensaje no se puede leer, el `error` llega con `idPedido: null`. También llega con `idPedido: null` el aviso `SESION_REEMPLAZADA` a una conexión que fue reemplazada por otra con el mismo token.

### Códigos de error

| Código | Significado |
|---|---|
| `NO_ES_TU_TURNO` | Acción fuera de turno |
| `ESTADO_INVALIDO` | La acción no corresponde a este momento del juego |
| `APUESTA_FUERA_DE_RANGO` | Fuera de 0 a N, o no entera |
| `APUESTA_PROHIBIDA_PIE` | Es el valor que haría que la suma de apuestas sea N |
| `APUESTA_YA_REALIZADA` | Ya apostó en esta partida |
| `CARTA_NO_EN_MANO` | No la tiene, ya la jugó o no existe |
| `JUEGO_TERMINADO` | El juego ya terminó o fue abortado |
| `CANTIDAD_JUGADORES_INVALIDA` | Se intentó iniciar con menos de 4 jugadores |
| `NO_PERTENECE_A_SALA` | No está en una sala (o no en esta) |
| `NO_ES_ANFITRION` | Acción reservada al anfitrión |
| `SALA_LLENA` | La sala ya tiene 7 jugadores |
| `SALA_NO_EXISTE` | No hay sala con ese código |
| `JUEGO_YA_INICIADO` | La sala ya está jugando (no se puede entrar ni salir) |
| `JUEGO_NO_INICIADO` | Comando de juego sin juego en curso |
| `NOMBRE_EN_USO` | Ya hay alguien con ese nombre en la sala (sin distinguir mayúsculas) |
| `YA_ESTAS_EN_UNA_SALA` | La conexión ya está en una sala |
| `SESION_INVALIDA` | El token no corresponde a ningún asiento (la sala ya no existe, o salió del lobby) |
| `SESION_REEMPLAZADA` | La misma sesión se abrió desde otra conexión: esta deja de valer |
| `MENSAJE_INVALIDO` | No cumple el esquema |
| `VERSION_NO_SOPORTADA` | Otra versión del protocolo: hay que actualizar la página |
| `DEMASIADOS_MENSAJES` | Superó el límite de frecuencia |
| `ERROR_INTERNO` | Falla inesperada del servidor |

🔵 Respecto del diseño técnico se agregaron `JUEGO_NO_INICIADO`, `NOMBRE_EN_USO`, `YA_ESTAS_EN_UNA_SALA`, `SESION_INVALIDA`, `SESION_REEMPLAZADA`, `VERSION_NO_SOPORTADA` y `ERROR_INTERNO`.

---

## Eventos del servidor

Todos llevan `seq`. Cada jugador recibe todos los eventos de su sala desde que entró, sin saltos. Si el cliente detecta un salto, pide una foto nueva con `sync.pedir` (ver "Seguimiento del estado en el cliente").

### Sala

```json
{ "v": 1, "tipo": "sala.jugadorEntro", "seq": 3, "datos": { "idJugador": "…", "nombre": "Caro" } }
{ "v": 1, "tipo": "sala.jugadorSalio", "seq": 4, "datos": { "idJugador": "…" } }
{ "v": 1, "tipo": "sala.anfitrionCambio", "seq": 5, "datos": { "anfitrion": "…idJugador…" } }
{ "v": 1, "tipo": "sala.configuracion", "seq": 6, "datos": { "tiempoTurnoMs": 60000 } }
{ "v": 1, "tipo": "jugador.conexion", "seq": 90, "datos": { "idJugador": "…", "asiento": 2, "conectado": false } }
{ "v": 1, "tipo": "jugador.pilotoAutomatico", "seq": 91, "datos": { "idJugador": "…", "asiento": 2, "activado": true, "motivo": "desconexion" } }
{ "v": 1, "tipo": "sala.resumenPausado", "seq": 120, "datos": { "pausado": true } }
```

Quien entra no recibe su propio `sala.jugadorEntro`, porque su foto ya lo incluye. Del mismo modo, quien vuelve con `sala.reconectar` no recibe su propio `jugador.conexion` ni el `jugador.pilotoAutomatico` que lo desactiva.

`jugador.pilotoAutomatico.motivo` es `desconexion`, `abandono` (salió con `sala.salir`) o `tiempo` (3 vencimientos seguidos). Al desactivarse, `activado` es `false` y `motivo` es `null`.

### Juego

```json
{ "tipo": "juego.iniciado", "datos": { "asientos": [ { "asiento": 0, "idJugador": "…", "nombre": "Ana" } ] } }
{ "tipo": "sorteo.cartasSacadas", "datos": { "sacadas": [ { "asiento": 0, "carta": "K-picas" } ], "repiten": [0, 3] } }
{ "tipo": "sorteo.resultado", "datos": { "repartidor": 3 } }
{ "tipo": "partida.iniciada", "datos": { "partida": 1, "cartasPorJugador": 1, "repartidor": 3, "pie": 3, "mano": 4 } }
{ "tipo": "partida.manoRepartida", "datos": { "cantidades": [1, 1, 1, 1, 1], "cartas": ["7-treboles"] } }
{ "tipo": "apuesta.turno", "datos": { "asiento": 4, "valorProhibido": null, "fechaLimite": 1760572830000 } }
{ "tipo": "apuesta.realizada", "datos": { "asiento": 4, "valor": 1, "porPiloto": false } }
{ "tipo": "baza.iniciada", "datos": { "baza": 1, "mano": 4 } }
{ "tipo": "baza.turno", "datos": { "asiento": 4, "baza": 1, "fechaLimite": 1760572861000 } }
{ "tipo": "baza.cartaJugada", "datos": { "asiento": 4, "carta": "Q-diamantes", "porPiloto": false } }
{ "tipo": "baza.resuelta", "datos": { "baza": 1, "ganador": 0, "cartaGanadora": "A-picas", "tieneFicha": true } }
{ "tipo": "partida.puntajes", "datos": { "partida": 1, "resultados": [ { "asiento": 0, "apuesta": 1, "bazasGanadas": 1, "puntos": 6 } ], "totales": [6, 0, 0, 0, 5] } }
{ "tipo": "juego.terminado", "datos": { "ranking": [ { "asiento": 0, "total": 87, "puesto": 1 } ] } }
{ "tipo": "juego.abortado", "datos": { "motivo": "…" } }
```

(En los ejemplos de juego se omiten `v` y `seq`.)

Notas:

- `sorteo.cartasSacadas.repiten` lista los asientos empatados con la carta más alta, que vuelven a sacar. Vacío si no hubo empate.
- `partida.manoRepartida` es el único evento con datos **privados**. Cada jugador recibe `cartas` con **solo sus cartas**, y todos reciben `cantidades`, que es cuántas cartas tiene cada asiento.
- Si el anfitrión pide la revancha con el resumen en pausa, el juego nuevo empieza sin pausa y se avisa con `sala.resumenPausado` (`pausado: false`).
- `apuesta.turno.valorProhibido` es el valor que el Pié no puede apostar. Es `null` si no le toca al Pié o si no hay restricción efectiva.
- `baza.resuelta`: el ganador es el Mano de la baza siguiente. `tieneFicha` indica si el montón lleva ficha.
- `fechaLimite` es la hora del servidor (en ms) en que vence el turno. Es `null` si la sala no tiene límite o si juega el piloto automático.
- `porPiloto` es `true` si la apuesta o la carta la eligió el piloto automático.
- Un turno puede anunciarse de nuevo (otro `apuesta.turno` o `baza.turno` para el mismo asiento) si cambia quién lo controla: por ejemplo, si el jugador se desconecta en su turno o vuelve. Vale el último.
- 🔵 Respecto del diseño técnico se agregaron `baza.iniciada` y `sala.resumenPausado`.

### Ritmo

El servidor maneja los tiempos (DP-23):

- Tras `baza.resuelta`, la baza queda a la vista unos **3 s** antes de seguir.
- Tras `partida.puntajes`, el resumen dura unos **10 s**, salvo que el anfitrión lo pause con `sala.pausarResumen`. La pausa sigue activa en los resúmenes siguientes hasta que se reanude.

### Ausencias: tiempo límite, piloto automático y reconexión

Reglas oficiales del modo online (DP-12 a DP-14):

- **Tiempo límite** (DP-13): cada apuesta y cada tirada tiene el tiempo de la sala (30 s por defecto). Si vence, el piloto automático hace esa jugada. Tras **3 vencimientos seguidos**, el piloto toma el asiento hasta que el jugador actúe de nuevo.
- **Piloto automático** (DP-12b): apuesta el menor valor válido (0, o 1 si 0 está prohibido) y juega la carta de menor valor.
- **Desconexión o abandono** (DP-12): el asiento nunca se elimina. El piloto juega por él y sus puntos se conservan.
- **Reconexión** (DP-14): con su `token`, el jugador vuelve a su asiento sin límite de tiempo mientras el juego siga. Recibe la foto completa y el piloto se desactiva. Si le tocaba, su turno vuelve a empezar con el plazo completo.
- **Nadie conectado** (DP-12): si no queda ningún jugador conectado durante **3 minutos**, el juego pasa a `ABORTADO` y la sala se cierra.

🔵 Recomendaciones técnicas (no son reglas del juego; se pueden cambiar en la configuración del servidor):

- El piloto espera **1 s** antes de jugar, para que la mesa se pueda seguir.
- Mientras no hay nadie conectado, el piloto **no juega**: la mesa espera a que alguien vuelva o a que venza la espera de 3 minutos.
- Quien tiene el piloto por vencimientos puede recuperar el control con `juego.retomarControl`, o simplemente jugando en su turno antes de que el piloto actúe.
- En el **lobby**, quien se desconecta conserva su lugar **15 s** (por ejemplo, si recarga la página). Si no vuelve, sale de la sala.
- Si la misma sesión se abre desde otra conexión (otra pestaña), la nueva reemplaza a la anterior, que recibe `SESION_REEMPLAZADA`.
- En la revancha, quien sigue desconectado empieza con el piloto activo.

## Foto del estado

La foto (`estado.foto`) es la **vista completa** de un jugador: todo lo que puede saber de su sala y del juego en curso, y nada más. Se envía al entrar a la sala, al volver con `sala.reconectar` y como respuesta a `sync.pedir`. Su `seq` es el del último evento que ya incluye, así que el siguiente evento llega con `seq + 1`.

```json
{
  "v": 1, "tipo": "estado.foto", "seq": 212,
  "datos": {
    "codigo": "K7QM2XPA", "estado": "JUGANDO", "yo": "…", "anfitrion": "…", "maxJugadores": 7,
    "tiempoTurnoMs": 30000, "resumenPausado": false,
    "jugadores": [ { "idJugador": "…", "nombre": "Ana", "conectado": true, "piloto": null } ],
    "horaServidor": 1760572800000,
    "juego": {
      "fase": "TIRADAS",
      "asientos": [ { "asiento": 0, "idJugador": "…", "nombre": "Ana" } ],
      "miAsiento": 0,
      "sorteo": [ { "sacadas": [ { "asiento": 0, "carta": "9-picas" } ], "repiten": [] } ],
      "repartidor": 3, "partida": 5, "totalPartidas": 14, "cartasPorJugador": 5, "mano": 1,
      "miMano": ["2-picas", "J-corazones", "COMODIN"],
      "cantidades": [3, 2, 3, 3, 3],
      "apuestas": [1, 0, 2, 1, 2],
      "bazasGanadas": [1, 1, 0, 0, 0],
      "bazaActual": { "baza": 3, "mano": 1, "tiradas": [ { "asiento": 1, "carta": "7-diamantes" } ], "ganador": null },
      "bazasCerradas": [ { "baza": 1, "ganador": 0, "cartaGanadora": "A-treboles", "tieneFicha": true } ],
      "puntajes": [[6, 0, 7, 5], [0, 5, 0, 6]],
      "totales": [18, 11],
      "turno": { "tipo": "carta", "asiento": 2, "fechaLimite": 1760572830000 },
      "ranking": null,
      "motivoAborto": null
    }
  }
}
```

(Para abreviar, algunas listas muestran menos asientos de los que tendría la mesa.)

- `estado` puede ser `ESPERANDO` (lobby), `JUGANDO` o `TERMINADO`. En el lobby, `juego` es `null`.
- `fase` puede ser `SORTEO`, `APUESTAS`, `TIRADAS`, `BAZA_RESUELTA` (la pausa de ~3 s), `RESUMEN` (la pausa de ~10 s), `TERMINADO` o `ABORTADO`.
- **Regla de oro:** `miMano` trae solo las cartas propias. De los demás, solo `cantidades`. De las bazas cerradas, solo la carta ganadora y quién ganó. La baza en curso muestra todas sus cartas, que son públicas. El mazo no aparece.
- `puntajes[asiento][partida - 1]` son los puntos de cada partida jugada. Sirven para el desempate final.
- `jugadores[].piloto` indica si el piloto automático juega por ese jugador y por qué (`desconexion`, `abandono`, `tiempo`), o `null`.
- `horaServidor` permite al cliente calcular la diferencia con su reloj y mostrar bien la cuenta regresiva.

## Seguimiento del estado en el cliente

El cliente guarda la última foto y le aplica cada evento en orden, con `aplicarMensaje` de `@tokinoto/protocolo`:

1. Al recibir una foto, reemplaza todo su estado.
2. Al recibir el evento con `seq` siguiente, lo aplica.
3. Si llega un evento repetido o viejo, lo ignora.
4. Si detecta un salto en `seq`, queda **desincronizado**: ignora eventos, envía `sync.pedir` y espera la foto nueva.

**Garantía** (verificada por las pruebas en cada paso de juegos completos): lo que el cliente reconstruye con los eventos es idéntico a la foto que le armaría el servidor en ese momento.

## Seguridad

- Todo comando se valida con Zod antes de usarse.
- Hay un límite de frecuencia por conexión: ráfagas de hasta 20 mensajes y 10 por segundo sostenidos.
- Un mensaje no puede superar los 16 KB.
- Solo se aceptan conexiones desde los sitios configurados en `TOKINOTO_ORIGENES`.
- Los códigos de sala tienen unos 40 bits de azar criptográfico, y el mezclado del mazo también usa azar criptográfico.

## Pendiente para próximas etapas

| Tema | Etapa |
|---|---|
| Guardar los juegos terminados y el registro de eventos (DP-21) | 7 |
| Retomar las salas tras un reinicio del servidor (hoy un reinicio las cierra) | 7 |
