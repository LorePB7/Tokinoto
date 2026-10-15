# Protocolo cliente ↔ servidor (versión 1)

Este documento describe los mensajes que implementa `@tokinoto/servidor`. El diseño general está en [`diseno-tecnico.md`](diseno-tecnico.md), sección 4. Los esquemas de validación viven en [`packages/servidor/src/protocolo.ts`](../packages/servidor/src/protocolo.ts), y este documento se mantiene junto a ellos.

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

Todos llevan `seq`. Cada jugador recibe todos los eventos de su sala desde que entró, sin saltos. Si el cliente detecta un salto, más adelante podrá pedir una foto nueva con `sync.pedir` (etapa 4).

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
- `apuesta.turno.valorProhibido` es el valor que el Pié no puede apostar. Es `null` si no le toca al Pié o si no hay restricción efectiva.
- `baza.resuelta`: el ganador es el Mano de la baza siguiente. `tieneFicha` indica si el montón lleva ficha.
- `porPiloto` y `fechaLimite` quedan reservados para la etapa 6 (piloto automático y tiempo límite). Hoy valen `false` y `null`.
- 🔵 Respecto del diseño técnico se agregaron `baza.iniciada` y `sala.resumenPausado`.

### Ritmo

El servidor maneja los tiempos (DP-23):

- Tras `baza.resuelta`, la baza queda a la vista unos **3 s** antes de seguir.
- Tras `partida.puntajes`, el resumen dura unos **10 s**, salvo que el anfitrión lo pause con `sala.pausarResumen`. La pausa sigue activa en los resúmenes siguientes hasta que se reanude.

## Foto del estado

Se envía al entrar a la sala. Su `seq` es el del último evento que ya incluye, así que el siguiente evento llega con `seq + 1`.

```json
{
  "v": 1, "tipo": "estado.foto", "seq": 2,
  "datos": {
    "codigo": "K7QM2XPA", "estado": "ESPERANDO", "yo": "…", "anfitrion": "…", "maxJugadores": 7,
    "jugadores": [ { "idJugador": "…", "nombre": "Ana", "conectado": true } ],
    "horaServidor": 1760572800000
  }
}
```

`estado` puede ser `ESPERANDO` (lobby), `JUGANDO` o `TERMINADO`. En la etapa 4 la foto sumará la vista del juego en curso.

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
| `sync.pedir` y la foto completa del juego en curso | 4 |
| Fecha límite por turno, piloto automático y `jugador.pilotoAutomatico` | 6 |
