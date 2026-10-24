# Tokinoto Online: Especificación Técnica v4 (versión final aprobada)

**Fuentes de verdad:** (1) el reglamento (`reglas_del_juego_tokinoto.md` y el PDF "Reglamento Oficial y Compendio de Reglas de Juego"), y (2) las aclaraciones confirmadas por el responsable del proyecto, que prevalecen sobre el reglamento donde lo corrigen. `contexto.txt` está vacío.

**Leyenda**
- 🟢 **REGLA OFICIAL**: está en el reglamento o fue confirmada por el responsable.
- 🟠 **DECISIÓN PENDIENTE (DP-xx)**: sin definir. Hay que decidir juntos.
- 🔵 **RECOMENDACIÓN TÉCNICA**: sugerencia técnica, no es regla del juego. **Aprobada por el responsable.**
- ✅ **DECISIÓN ONLINE APROBADA**: valor por defecto del modo online, aprobado por el responsable.

**Etapa:** solo análisis. No se eligen tecnologías ni se escribe código.

**Estado general:** especificación **completa y aprobada**. Todas las reglas del juego están definidas, las recomendaciones técnicas (🔵) fueron aprobadas y las decisiones del modo online (sección 14) también. No quedan decisiones pendientes (🟠).

---

## 0. Registro de aclaraciones confirmadas

| ID | Tema | Decisión confirmada |
|---|---|---|
| DP-01 | Mazo | **53 cartas**: 2 al As de los 4 palos (52) + **1 Comodín**. El "51" del reglamento fue un error. |
| DP-02 | Palos | **Indiferentes.** Solo importa el número o letra. Sin obligación de seguir palo ni triunfos. |
| DP-03 | Ganador de la baza | Gana la **carta más alta**. En empate de valor gana **quien la tiró primero**. |
| DP-04 | Sentido de la mesa | **Siempre hacia la derecha** (apuestas, tiradas, reparto). Se ignora "sentido horario". |
| DP-05 | Primer repartidor | Se **sortea al inicio del juego**: el mazo se pone en el medio, cada jugador saca una carta al azar y quien tenga el valor más alto empieza repartiendo. |
| DP-06 | Mano al inicio de cada partida | Es **el jugador a la derecha del repartidor**. No depende de quién ganó la última baza anterior. |
| DP-07 | Repartidor | El **repartidor es siempre el Pié**. En cada partida nueva reparte el jugador a la derecha del repartidor anterior, dando toda la vuelta. |
| DP-08 | Visibilidad | Cada jugador ve **solo sus propias cartas**. |
| DP-08b | Bazas anteriores | Se muestra **solo la carta ganadora y quién ganó**, nada más. |
| DP-09 | Rango de apuestas | **0 a N**, con N = cantidad de cartas de la partida. |
| DP-10 | Empate final | Gana quien tenga el **mejor puntaje en una sola partida**; si persiste, el segundo mejor, y así sucesivamente. |
| DP-10b | Empate absoluto | Si persiste incluso así, **se comparte el podio**. |
| DP-17 | Quién abre las apuestas | El **Mano al inicio de la partida** (derecha del repartidor). |
| DP-26 | Empate en el sorteo inicial | Los jugadores que sacaron la carta más alta **vuelven a sacar**, las veces que haga falta, hasta desempatar. |

---

## 1. Vocabulario

| Término del reglamento | Nombre propuesto 🔵 | Significado |
|---|---|---|
| Juego | `Game` | Las 14 partidas completas |
| Partida | `Round` | Una ronda con N cartas por jugador |
| mano / ronda (que se gana) | `Trick` (baza) | Una vuelta de cartas en la mesa. Es lo que se apuesta |
| Mano (jugador) | `Lead` | Jugador que abre la baza tirando la primera carta |
| Pié | `Last` | Último en apostar. Siempre es el repartidor |
| Repartidor | `Dealer` | Quien baraja y reparte en esa partida |

🔵 Usar estos nombres de forma consistente en código, datos e interfaz.

---

## 2. Orden de mesa, repartidor, Mano y Pié

🟢 Todo gira **hacia la derecha**. Sea `der(i)` el asiento a la derecha del asiento `i`, con el orden circular.

| Rol | Cómo se determina |
|---|---|
| **Repartidor (Dealer)** partida 1 | Sorteo inicial (sección 3) |
| **Repartidor** partida k+1 | `der(repartidor de la partida k)` |
| **Mano inicial** de cada partida | `der(repartidor)` |
| **Pié** de cada partida | El repartidor |
| **Orden de apuesta** | Mano inicial → … → repartidor (Pié) |
| **Mano de cada baza siguiente** | El ganador de la baza anterior |

- El Mano inicial de una partida **no** depende de quién ganó la última baza de la partida anterior.
- Dentro de una partida, el Mano cambia con cada baza; el repartidor y el Pié **no** cambian.
- Como el repartidor avanza un asiento por partida, el Mano inicial también avanza un asiento. Con 4 a 7 jugadores, el ciclo completo de repartidores se repite en las 14 partidas.

---

## 3. Sorteo inicial del primer repartidor

🟢 Antes de la partida 1:
1. Se pone el mazo en el medio de la mesa.
2. Cada jugador saca una carta al azar.
3. Quien tenga el **valor más alto** empieza repartiendo. El Comodín cuenta como el más alto.
4. 🟢 Si hay empate entre los que sacaron el valor más alto, **solo esos jugadores** vuelven a sacar, las veces necesarias hasta que haya un único máximo.

🔵 Detalles técnicos (no son reglas del juego):
- El servidor asigna una carta al azar a cada jugador sin repetir, y todos las ven.
- Las cartas sacadas en el sorteo se devuelven al mazo, que se baraja de nuevo antes de repartir la partida 1.
- Los palos no cuentan para el desempate (DP-02).

---

## 4. Estructura completa de una partida (Round)

🟢
1. Se determina el repartidor (sección 2), se baraja y se reparten N cartas a cada jugador. Cada uno ve solo las suyas.
2. **Apuestas:** cada jugador declara cuántas manos ganará, empezando por el Mano (derecha del repartidor) y terminando en el Pié (el repartidor).
3. **Juego:** se juegan N bazas.
   - El Mano abre tirando la primera carta.
   - Los demás tiran una carta por turno, hacia la derecha.
   - Gana la carta más alta (sección 8).
   - El ganador junta las cartas (sección 9) y es el Mano de la baza siguiente.
4. Al agotarse las cartas, se evalúan las apuestas y se suman puntos.
5. La partida se juega completa, aunque alguien ya no pueda cumplir su apuesta.

🟢 Con 53 cartas y hasta 49 repartidas, sobran siempre al menos 4 cartas, que no se usan en esa partida.

---

## 5. Flujo de las 14 partidas

🟢

| Partida | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cartas por jugador | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 7 | 6 | 5 | 4 | 3 | 2 | 1 |

- Fases: Ascendente (1 a 7), Pico (8, segunda partida de 7 cartas), Descendente (9 a 14).
- Las partidas son acumulativas. Total de bazas en un juego: **56**.
- 🔵 Constante de configuración: `CARDS_PER_ROUND = [1,2,3,4,5,6,7,7,6,5,4,3,2,1]`.

---

## 6. Estados del juego (máquina de estados)

🔵 Los estados de partida derivan del reglamento; los de sala son necesidades del modo online.

**Nivel Juego**
| Estado | Descripción |
|---|---|
| `LOBBY` | Sala abierta, esperando jugadores (4 a 7) |
| `READY_TO_START` | Hay entre 4 y 7 jugadores y se puede iniciar |
| `DEALER_DRAW` | Sorteo inicial del repartidor, con repeticiones por empate |
| `IN_PROGRESS` | Juego en curso |
| `FINISHED` | Terminó la partida 14 y se determinó el ranking |
| `ABORTED` | Terminado sin completarse (✅ DP-12) |

**Nivel Partida (dentro de `IN_PROGRESS`)**
| Estado | Descripción |
|---|---|
| `ROUND_SETUP` | Se fija repartidor, Mano y Pié; se baraja y se reparte |
| `BETTING` | Subestado `AWAITING_BET(jugador)`: Mano → … → Pié |
| `PLAYING` | Subestado `AWAITING_CARD(jugador)`: baza en curso |
| `TRICK_RESOLUTION` | Todos tiraron: ganador, montón y nuevo Mano |
| `ROUND_SCORING` | Se agotaron las cartas: se evalúa y suma |
| `ROUND_SUMMARY` | Se muestran resultados antes de la siguiente partida |

**Transiciones**
```
LOBBY → READY_TO_START → DEALER_DRAW → IN_PROGRESS
ROUND_SETUP → BETTING → PLAYING ⇄ TRICK_RESOLUTION → ROUND_SCORING → ROUND_SUMMARY
ROUND_SUMMARY → ROUND_SETUP   (si partida < 14)
ROUND_SUMMARY → FINISHED      (si partida = 14)
```

🔵 Un solo estado como fuente de verdad. A quién le toca actuar se deriva de él.

---

## 7. Estado y datos de cada jugador

**Identidad y sala (🔵 online)**
- `playerId`, nombre visible, `seatIndex`, estado de conexión, anfitrión (sí/no).

**Datos de juego**
| Campo | Alcance | Visibilidad | Fuente |
|---|---|---|---|
| `seatIndex` | Todo el juego | Pública | 🟢 |
| `isDealer` (= Pié) | Por partida | Pública | 🟢 |
| `hand` (cartas en mano) | Por partida | **Privada** (solo el dueño) | 🟢 |
| `bet` | Por partida | Pública | 🟢 |
| `tricksWon` | Por partida | Pública | 🟢 |
| `chipsRemaining` | Por partida | Pública | 🟢 (derivado) |
| `wonPiles` (montones ganados) | Por partida | Pública, ver sección 9 | 🟢 |
| `isLead` (es Mano) | Por baza | Pública | 🟢 |
| `roundScore[1..14]` | Por partida | Pública | 🟢 |
| `totalScore` | Todo el juego | Pública | 🟢 |

- 🔵 Distinguir `bet = null` (todavía no apostó) de `bet = 0` (apostó cero).
- `chipsRemaining = max(0, bet - tricksWon)`.

---

## 8. Mazo, cartas y ganador de cada baza

### 8.1 Mazo
🟢
- **53 cartas:** 2 al As en los 4 palos (52) + 1 Comodín.
- **Orden de valores:** 2 < 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < Comodín.
- El Comodín es la carta de mayor jerarquía y la **única que le gana al As**.
- **Los palos no importan** para ninguna comparación.

🔵 Estructura:
```
Card { id (único e inmutable), rank (2..14), suit | null, isJoker }
Deck { cards[53] }
```
- Valor numérico propuesto: 2..10, J=11, Q=12, K=13, A=14, Comodín=15.
- El mazo se baraja en el servidor con un generador aleatorio de calidad.
- Pruebas: 53 cartas únicas, exactamente 1 Comodín, 13 valores × 4 palos.

### 8.2 Ganador de la baza
🟢
1. Gana **la carta más alta**.
2. El **Comodín** gana a todas, incluido el As.
3. Si dos o más jugadores tiran el **mismo valor** y es el más alto, gana **el primero que lo tiró**.
4. Una carta baja no gana por ser del Mano: si el Mano abre con un 5 y después alguien tira algo más alto, gana esa carta.

**Ejemplos**
- Mano tira K, luego K, K, Q → gana el Mano.
- Mano tira 5, luego J, K, K → gana el primero que tiró K.
- Mano tira A, luego el Comodín → gana el Comodín.
- Mano tira 10, luego 3, 7, 2 → gana el Mano.

**Consecuencia de juego:** si un jugador necesita **perder** una baza y tiene una carta alta (por ejemplo, una J), puede descartarla sin riesgo cuando alguien antes ya tiró una J o más. El sistema **no debe** impedir ni sugerir nada de esto: la jugada es libre.

**Algoritmo 🔵**
```
ganador = primera tirada
Para cada tirada siguiente, en orden:
    si valor(carta) > valor(ganador.carta) → ganador = esta tirada
    (si es igual no reemplaza: el que tiró primero conserva la baza)
Devolver ganador.jugador
```

---

## 9. Montones ganados y fichas

🟢 Al terminar cada baza, el ganador **junta las cartas** de esa baza y arma un montón:
- La **carta ganadora queda arriba**.
- Si al jugador **todavía le quedan fichas** (apostó más bazas de las que lleva ganadas), pone **una ficha encima** del montón.
- Si ya no le quedan fichas, el montón queda **sin ficha**.
- Los montones son visibles para todos, así se ve quién ganó cada baza.

🟢 **Información pública de una baza ya jugada: solo la carta ganadora y quién la ganó.** Nada más. Las demás cartas de esa baza no se muestran.

**Datos 🔵**
```
WonTrick { trickNumber, winnerPlayerId, winningCard, hasChip }
hasChip = (cantidad de bazas ganadas por ese jugador, incluida esta) ≤ bet
```
- El servidor conserva internamente las cartas completas de cada baza (para auditar), pero **no las envía** a los clientes una vez terminada la baza.
- Mientras la baza está en curso, las cartas ya tiradas sobre la mesa son visibles para todos, como en la mesa real.
- 🔵 Sugerencia de interfaz: mostrar las cartas de la baza unos segundos antes de que el ganador las junte.

---

## 10. Sistema de apuestas y restricción del Pié

🟢 **Reglas**
- Antes de tirar cartas, cada jugador declara cuántas manos ganará, en un rango de **0 a N**.
- **Orden:** empieza el Mano inicial (derecha del repartidor), sigue hacia la derecha y termina el Pié (el repartidor).
- Cada jugador recibe tantas fichas visibles como manos apostó.
- **Restricción del Pié:** la suma de todas las apuestas **no puede ser igual** a N. Esto garantiza que al menos un jugador falle.
- Ejemplo oficial: en una partida de 6 cartas, si los anteriores suman 5, el Pié no puede apostar 1.

**Validación 🔵**
```
sumaPrevia = suma de las apuestas de los jugadores anteriores al Pié
valorProhibido = N - sumaPrevia
Si 0 ≤ valorProhibido ≤ N → el Pié no puede apostar valorProhibido.
Si valorProhibido < 0 → no hay restricción efectiva.
```
- Con N ≥ 1 y rango 0..N el Pié siempre tiene al menos una opción válida.
- Invariante para pruebas: `sum(bets) ≠ N` en toda partida terminada.
- Interfaz: mostrar el valor prohibido deshabilitado, pero validar siempre en el servidor.

---

## 11. Puntuación

🟢 Evaluación estricta por jugador al final de cada partida:
- **Acierto exacto** (`tricksWon == bet`): `5 + bet` puntos.
- **Fallo** (más o menos): **0** puntos. Sin puntaje negativo ni parcial.
- Ejemplos oficiales: apostar 2 y ganar 2 = 7. Apostar 0 y ganar 0 = 5.

```
puntos = (tricksWon == bet) ? 5 + bet : 0
```

**Invariantes 🔵**
- La suma de `tricksWon` de todos los jugadores es siempre N.
- `sum(bets) ≠ N`, así que en cada partida al menos un jugador puntúa 0.
- Ningún jugador puntúa más de `5 + N` en una partida.

---

## 12. Finalización y ganador

🟢 El juego termina al concluir la partida 14. Gana el jugador con **más puntos totales acumulados**.

🟢 **Desempate:**
1. Se compara el **mayor puntaje obtenido en una sola partida**.
2. Si persiste el empate, el **segundo mejor**, y así sucesivamente.
3. Si todos los puntajes coinciden, **se comparte el podio**.

**Algoritmo 🔵**
```
Para cada jugador empatado en totalScore:
    lista = roundScore[1..14] ordenada de mayor a menor
Comparar las listas posición por posición.
Gana quien tenga el primer valor mayor.
Si las listas son idénticas, quedan en el mismo puesto.
```
Un valor repetido en dos partidas cuenta como dos elementos.

🔵 El resultado final debe permitir **más de un ganador**.

---

## 13. Funciones, validaciones, casos especiales y errores

### 13.1 Funciones y validaciones 🔵 (cada una debería probarse por separado)

**Configuración, mazo y sorteo**
- `validarCantidadJugadores(n)`: 4 ≤ n ≤ 7. 🟢
- `cartasPorPartida(numeroPartida)`. 🟢
- `construirMazo()`: 53 cartas únicas con 1 Comodín. 🟢
- `barajar(mazo)`.
- `valorDeCarta(carta)`. 🟢
- `sortearRepartidorInicial(jugadores)`: una carta por jugador, repitiendo solo entre empatados. 🟢
- `repartir(mazo, jugadores, N)`: N cartas por jugador sin repetir; las sobrantes no se usan. 🟢

**Orden de mesa**
- `derecha(asiento)`: siempre el asiento a la derecha. 🟢
- `siguienteRepartidor(repartidorActual)` = `derecha(repartidorActual)`. 🟢
- `manoInicial(repartidor)` = `derecha(repartidor)`. 🟢
- `pie(repartidor)` = repartidor. 🟢
- `ordenDeApuesta(repartidor)`: desde `derecha(repartidor)` hasta el repartidor. 🟢
- `ordenDeTiradas(mano)`: desde el Mano hacia la derecha. 🟢

**Apuestas**
- `apuestasValidasParaJugador(jugador, N, apuestasPrevias)`: 0..N, excluyendo el valor prohibido si es el Pié. 🟢
- `registrarApuesta(jugador, valor)`: valida estado, turno, rango y restricción.
- `apuestasCompletas()`: pasa a `PLAYING` cuando todos apostaron.

**Juego de cartas**
- `esTurnoDelJugador(jugador)`.
- `jugadorTieneLaCarta(jugador, carta)`.
- `jugadaLegal(jugador, carta)`: solo exige turno correcto y carta en la mano. 🟢
- `registrarTirada(jugador, carta)`.
- `bazaCompleta()`.
- `determinarGanadorBaza(tiradas)`. 🟢
- `armarMonton(ganador, baza)`: carta ganadora arriba y ficha si `bazasGanadas ≤ apuesta`. 🟢
- `actualizarMano(ganador)`. 🟢
- `partidaTerminada()`: no quedan cartas en las manos. 🟢

**Puntuación y cierre**
- `puntosDePartida(apuesta, bazasGanadas)`. 🟢
- `acumularPuntajes()`.
- `esUltimaPartida(numero)`: partida 14. 🟢
- `rankingFinal(jugadores)`: total acumulado, desempate por mejores puntajes, empate absoluto compartido. 🟢

### 13.2 Casos especiales (🟢 o derivados)
- **Partida de 1 carta:** una sola baza. El Pié tiene restricción real (por ejemplo, si todos apostaron 0, no puede apostar 1).
- **Apuesta 0 acertada:** da 5 puntos.
- **Comodín como carta de apertura:** el Mano puede abrir con el Comodín y gana.
- **Pié con valor prohibido fuera de rango:** no hay restricción efectiva.
- **Partida 8 (Pico):** partida independiente con 7 cartas, sin regla especial.
- **Apuesta ya imposible de cumplir:** se siguen jugando todas las cartas.
- **Jugador que quiere perder una baza:** juega libremente.
- **Montón sin ficha:** ocurre cuando el jugador ya superó su apuesta.
- **Sorteo inicial con empate:** se repite solo entre los empatados.

### 13.3 Errores que el servidor debe rechazar (🔵)
- Acción fuera de turno (apostar o tirar).
- Apuesta fuera de 0..N, no entera o negativa.
- Apuesta del valor prohibido siendo Pié.
- Apostar dos veces.
- Tirar una carta que no está en la mano, ya jugada o inexistente.
- Tirar durante apuestas, o apostar durante el juego de cartas.
- Acciones sobre un juego terminado o abortado.
- Acciones de un jugador ajeno a la sala.
- Mensajes duplicados por reintento de red. Las acciones deberían ser **idempotentes**.

### 13.4 Errores de integridad (🔵)
- Mazo con cartas repetidas, faltantes, o con más o menos de 1 Comodín.
- Cartas repartidas repetidas entre jugadores.
- Total de bazas ganadas ≠ N al terminar la partida.
- Suma de apuestas = N.
- Pié distinto del repartidor, o Mano inicial distinto de `derecha(repartidor)`.
- Puntaje total que no coincide con la suma de los puntajes por partida.
- Cantidad de jugadores distinta entre partidas.
- Envío al cliente de cartas ajenas o de cartas no ganadoras de bazas ya cerradas.

---

## 14. Modo online: decisiones aprobadas (✅)

Estas decisiones **no** forman parte de las reglas del juego: son la configuración por defecto del modo online. Todas fueron aprobadas. Los tiempos y ajustes de sala siguen siendo configurables.

| ID | Tema | Decisión aprobada ✅ | Motivo |
|---|---|---|---|
| DP-11 | Cantidad de jugadores | **Sin cupo elegible** (cambio aprobado en la fase 5 del plan de mejoras): la sala admite hasta 7 y el anfitrión inicia cuando hay de 4 a 7. Al iniciar, la cantidad **queda fija**. Nadie entra una vez iniciado el juego. | Cambiar la cantidad altera orden de mesa, reparto y restricción del Pié. |
| DP-12 | Desconexión y abandono | El asiento **nunca se elimina**. Si un jugador se desconecta o abandona, un **piloto automático** juega por él y sus puntos se conservan. Si vuelve, recupera el control. Si no queda ningún humano conectado durante un tiempo configurable, el juego pasa a `ABORTED`. **Si todas las personas dejaron la mesa a propósito** (Salir en la mesa, o Abandonar desde el inicio), no se espera: el juego pasa a `ABORTED` en el acto (por ejemplo, al salir de una partida solo contra bots). Quien solo perdió la conexión sigue teniendo el tiempo de espera para volver. Desde el inicio, quien tiene una partida en curso puede **volver** o **abandonarla** para entrar a otra; una partida abandonada ya no se ofrece para volver (cambio pedido después de la fase 8). | Mantiene válida la cantidad de jugadores y las reglas sin cambios. |
| DP-12b | Acciones del piloto automático | Apuesta: el **menor valor válido** (0, o el siguiente si 0 está prohibido). Carta: la **de menor valor** de su mano. | Determinista y predecible. No es una regla del juego, es solo una salida de emergencia. |
| DP-13 | Tiempo límite por acción | **Configurable por sala**: lo elige el anfitrión dentro de la sala, antes de iniciar; por defecto **30 s** por apuesta y por tirada, con opción de **sin límite** para partidas entre amigos. Al vencer, el piloto automático hace esa acción. Tras **3 vencimientos seguidos**, toma el asiento hasta que el jugador actúe de nuevo. | Evita que un jugador trabe la mesa. |
| DP-14 | Reconexión | Cada jugador tiene una **identidad de sesión** y, al reconectarse, recibe el estado completo (su mano y toda la información pública). Sin límite de tiempo mientras el juego siga en curso. | El piloto automático cubre la ausencia. |
| DP-15 | Salas | **Privadas con código o enlace de invitación.** El anfitrión crea la sala, ve quién se une y la inicia cuando hay de 4 a 7 jugadores. Si el anfitrión se va, el rol pasa a otro jugador. Sin salas públicas ni emparejamiento automático. **Expulsar** (cambio aprobado en la fase 7 del plan de mejoras): mientras la sala espera, el anfitrión puede sacar a un jugador (con confirmación, nunca a sí mismo). Esa persona (su cuenta de Google o su identidad de invitado) queda **bloqueada en esa sala** mientras exista. Una vez empezado el juego no se expulsa: para las ausencias está el piloto automático. | Alcance mínimo para una primera versión. Bloquear por cuenta alcanza para un grupo de amigos, aunque se pueda evadir con otra cuenta o como invitado nuevo. |
| DP-16 | Cuentas | **Ingreso obligatorio, con Google o como invitado** (cambio aprobado en la fase 6 del plan de mejoras). Con Google se identifica a la persona por el `sub` de Google (nunca el email, que no se guarda) y el nombre arranca con el de Google y se puede editar. El invitado elige un nombre, sin cuenta ni historial propio. Una persona puede estar en una sola sala activa a la vez. | Una cuenta permite guardar el historial y que una expulsión (fase 7) valga más; el invitado evita exigir Google. |
| DP-18 | Espectadores | **No** en la primera versión. | Hay que decidir qué información ven; se puede sumar luego. |
| DP-19 | Bots | **Bots del servidor en tres niveles: fácil, medio y difícil** (cambio aprobado en la fase 8 del plan de mejoras). "Jugar solo" (contra bots) crea una sala con la persona y de 3 a 6 bots del nivel elegido, sin tiempo por jugada, y la inicia sola. En una sala con amigos, el anfitrión agrega o quita bots en la sala de espera ("sacar" a un bot es quitarlo). Los bots cuentan para el mínimo de 4 y el tope de 7, juegan con una pausa de ~2 s, no hablan en el chat y deciden **solo con su mano y la información pública** (la misma regla de oro de las vistas). Si no queda ninguna persona conectada, la mesa se detiene y, si nadie vuelve, el juego se aborta como siempre: los bots solos no terminan un juego. Un juego con bots se guarda en el historial solo si alguna persona entró con su cuenta; de los invitados no se guarda nada. El piloto automático sigue siendo solo una salida de emergencia para ausencias. | Permite jugar sin juntar 4 personas. Lo que se promete de los niveles es el orden de fuerza (difícil > medio > fácil), medido con el simulador. |
| DP-20 | Revancha | El anfitrión puede iniciar **"jugar de nuevo"** con los mismos jugadores: puntajes en cero y **nuevo sorteo** del repartidor inicial. | Reutiliza la sala. |
| DP-21 | Historial | Se guarda **el resultado de cada juego terminado** (puntajes por partida y ranking final) y el registro de eventos para auditoría. Desde la fase 6, cada jugador del juego queda **asociado a su cuenta de Google**; los invitados quedan marcados como tales, sin historial propio. **Sin ranking global** por ahora. | Útil para depurar y para futuras estadísticas. |
| DP-22 | Chat | **Chat de texto de la sala** (cambio aprobado en la fase 7 del plan de mejoras), en la sala de espera y en la mesa. Mensajes de 1 a 200 caracteres en una línea, con un límite de ritmo por jugador (ráfaga de 3 y después 1 por segundo). **No se guarda**: la sala recuerda en memoria los últimos 50 mensajes (los recibe quien entra o vuelve) y se borran al cerrarse la sala. El texto se muestra siempre como texto, sin HTML ni enlaces clickeables. | Comodidad para jugar sin un canal externo, sin datos guardados que moderar. |
| DP-23 | Ritmo | Tras cada baza, las cartas quedan visibles unos **3 s** antes de que el ganador las junte. Tras cada partida, el resumen se muestra **6 s** con una cuenta regresiva y avanza solo; **nadie lo puede pausar** (cambio pedido después de la fase 8: antes eran ~10 s con pausa del anfitrión). | Da tiempo de lectura sin frenar el juego. |
| DP-24 | Idioma | **Español (Argentina)** únicamente, con la terminología de la sección 1. | Coincide con el reglamento. |
| DP-25 | Variantes | **Ninguna.** Las reglas son fijas. Solo son configurables los tiempos y los ajustes de sala. | Mantiene fiel el reglamento. |

### Recomendaciones técnicas generales 🔵
1. **Servidor autoritativo:** toda validación se hace en el servidor; el cliente solo muestra y envía intenciones.
2. **Información oculta:** al cliente viaja únicamente la mano de su dueño y, de las bazas cerradas, solo carta ganadora y ganador.
3. **Máquina de estados explícita:** una acción solo es válida en el estado que la admite.
4. **Registro de eventos** ordenado de cada apuesta, tirada y resultado de baza.
5. **Acciones idempotentes** con identificador.
6. **Reglas parametrizables:** puntos base (5), bonus (+1), tabla de cartas por partida, límites de jugadores y tiempos como constantes de configuración.
7. **Pruebas basadas en el reglamento:** convertir cada ejemplo oficial (7 y 5 puntos, el Pié en una partida de 6 cartas, los ejemplos de baza y el desempate final) y cada invariante en pruebas automáticas.
8. **Terminología unificada** (sección 1).

---

## Siguiente paso

La especificación de reglas y de modo online queda cerrada. La etapa siguiente es el **diseño técnico**, que todavía no se inició:
1. Elegir tecnologías (aún no decidido).
2. Definir arquitectura, modelo de datos y protocolo de mensajes entre cliente y servidor, a partir de las secciones 6, 7, 9 y 13.
3. Planificar el desarrollo por etapas, empezando por el motor de reglas con sus pruebas automáticas (sección 13).
