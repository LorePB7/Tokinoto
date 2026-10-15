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
| `sala.crear` | `{ nombre, maxJugadores? }` | Cualquiera sin sala. `maxJugadores` es el cupo, de 4 a 7 (por defecto 7) |
| `sala.unirse` | `{ codigo, nombre }` | Cualquiera sin sala, con el lobby abierto |
| `sala.salir` | — | En el lobby, o con el juego terminado |
| `sala.iniciar` | — | Anfitrión, en el lobby, con 4 a 7 jugadores |
| `sala.pausarResumen` | `{ pausar }` | Anfitrión, durante el juego (DP-23) |
| `juego.apostar` | `{ valor }` | Quien tiene el turno de apuesta |
| `juego.jugarCarta` | `{ idCarta }` | Quien tiene el turno de tirada |
| `juego.revancha` | — | Anfitrión, con el juego terminado (DP-20) |
| `sync.pedir` | `{ ultimoSeq? }` | Cualquier jugador de la sala. Pide una foto nueva |
| `ping` | — | Cualquiera. Responde la hora del servidor |

Validaciones del esquema: el nombre se recorta y tiene de 1 a 20 caracteres, sin caracteres de control. El código de sala tiene 8 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` y se acepta en minúsculas. No se aceptan campos de más.

El cliente **no puede** pedir sortear, barajar, repartir, avanzar ni resolver una baza. Esos tipos no existen en el protocolo.

Ejemplos:

```json
{ "v": 1, "tipo": "sala.crear", "idPedido": "a1", "datos": { "nombre": "Ana", "maxJugadores": 5 } }
{ "v": 1, "tipo": "sala.unirse", "idPedido": "b1", "datos": { "codigo": "K7QM2XPA", "nombre": "Beto" } }
{ "v": 1, "tipo": "sala.salir", "idPedido": "b2" }
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
| `sala.crear`, `sala.unirse` | `{ codigo, idJugador, token }`. El `token` es secreto: sirve para recuperar el asiento al reconectar (etapa 6) |
| `ping` | `{ horaServidor }` en milisegundos |

Si el mensaje no se puede leer, el `error` llega con `idPedido: null`.

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
| `SALA_LLENA` | La sala alcanzó su cupo |
| `SALA_NO_EXISTE` | No hay sala con ese código |
| `JUEGO_YA_INICIADO` | La sala ya está jugando (no se puede entrar ni salir) |
| `JUEGO_NO_INICIADO` | Comando de juego sin juego en curso |
| `NOMBRE_EN_USO` | Ya hay alguien con ese nombre en la sala (sin distinguir mayúsculas) |
| `YA_ESTAS_EN_UNA_SALA` | La conexión ya está en una sala |
| `MENSAJE_INVALIDO` | No cumple el esquema |
| `VERSION_NO_SOPORTADA` | Otra versión del protocolo: hay que actualizar la página |
| `DEMASIADOS_MENSAJES` | Superó el límite de frecuencia |
| `ERROR_INTERNO` | Falla inesperada del servidor |

🔵 Respecto del diseño técnico se agregaron `JUEGO_NO_INICIADO`, `NOMBRE_EN_USO`, `YA_ESTAS_EN_UNA_SALA`, `VERSION_NO_SOPORTADA` y `ERROR_INTERNO`.

---

## Eventos del servidor

Todos llevan `seq`. Cada jugador recibe todos los eventos de su sala desde que entró, sin saltos. Si el cliente detecta un salto, pide una foto nueva con `sync.pedir` (ver "Seguimiento del estado en el cliente").

### Sala

```json
{ "v": 1, "tipo": "sala.jugadorEntro", "seq": 3, "datos": { "idJugador": "…", "nombre": "Caro" } }
{ "v": 1, "tipo": "sala.jugadorSalio", "seq": 4, "datos": { "idJugador": "…" } }
{ "v": 1, "tipo": "sala.anfitrionCambio", "seq": 5, "datos": { "anfitrion": "…idJugador…" } }
{ "v": 1, "tipo": "jugador.conexion", "seq": 90, "datos": { "idJugador": "…", "asiento": 2, "conectado": false } }
{ "v": 1, "tipo": "sala.resumenPausado", "seq": 120, "datos": { "pausado": true } }
```

Quien entra no recibe su propio `sala.jugadorEntro`, porque su foto ya lo incluye.

### Juego

```json
{ "tipo": "juego.iniciado", "datos": { "asientos": [ { "asiento": 0, "idJugador": "…", "nombre": "Ana" } ] } }
{ "tipo": "sorteo.cartasSacadas", "datos": { "sacadas": [ { "asiento": 0, "carta": "K-picas" } ], "repiten": [0, 3] } }
{ "tipo": "sorteo.resultado", "datos": { "repartidor": 3 } }
{ "tipo": "partida.iniciada", "datos": { "partida": 1, "cartasPorJugador": 1, "repartidor": 3, "pie": 3, "mano": 4 } }
{ "tipo": "partida.manoRepartida", "datos": { "cantidades": [1, 1, 1, 1, 1], "cartas": ["7-treboles"] } }
{ "tipo": "apuesta.turno", "datos": { "asiento": 4, "valorProhibido": null, "fechaLimite": null } }
{ "tipo": "apuesta.realizada", "datos": { "asiento": 4, "valor": 1, "porPiloto": false } }
{ "tipo": "baza.iniciada", "datos": { "baza": 1, "mano": 4 } }
{ "tipo": "baza.turno", "datos": { "asiento": 4, "baza": 1, "fechaLimite": null } }
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
- `porPiloto` y `fechaLimite` quedan reservados para la etapa 6 (piloto automático y tiempo límite). Hoy valen `false` y `null`.
- 🔵 Respecto del diseño técnico se agregaron `baza.iniciada` y `sala.resumenPausado`.

### Ritmo

El servidor maneja los tiempos (DP-23):

- Tras `baza.resuelta`, la baza queda a la vista unos **3 s** antes de seguir.
- Tras `partida.puntajes`, el resumen dura unos **10 s**, salvo que el anfitrión lo pause con `sala.pausarResumen`. La pausa sigue activa en los resúmenes siguientes hasta que se reanude.

## Foto del estado

La foto (`estado.foto`) es la **vista completa** de un jugador: todo lo que puede saber de su sala y del juego en curso, y nada más. Se envía al entrar a la sala y como respuesta a `sync.pedir`. Su `seq` es el del último evento que ya incluye, así que el siguiente evento llega con `seq + 1`.

```json
{
  "v": 1, "tipo": "estado.foto", "seq": 212,
  "datos": {
    "codigo": "K7QM2XPA", "estado": "JUGANDO", "yo": "…", "anfitrion": "…", "maxJugadores": 7,
    "resumenPausado": false,
    "jugadores": [ { "idJugador": "…", "nombre": "Ana", "conectado": true } ],
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
      "turno": { "tipo": "carta", "asiento": 2, "fechaLimite": null },
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

| Mensaje | Etapa |
|---|---|
| `sala.reconectar` (con el `token`) | 6 |
| Fecha límite por turno, piloto automático y `jugador.pilotoAutomatico` | 6 |
