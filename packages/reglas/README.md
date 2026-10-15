# @tokinoto/reglas

Motor de reglas de Tokinoto. Es la **única parte que sabe cómo se juega**: no conoce la red, las pantallas, la base de datos ni los temporizadores. Lo usarán el servidor (para validar de verdad) y el cliente (para habilitar o deshabilitar botones).

## Cómo funciona

Dos funciones puras, sin efectos secundarios:

```
decide(estado, acción, azar)  →  eventos  |  error
evolve(estado, evento)        →  estado nuevo
apply = decide + evolve de cada evento
```

- **Puro:** nunca modifica el estado recibido y no usa reloj ni `Math.random`. El azar entra desde afuera (`Rng`): `createSeededRng(semilla)` para pruebas y `createCryptoRng()` para producción.
- **Los eventos son el resultado principal.** El estado se reconstruye con `replay(estadoInicial, eventos)`, sin necesidad de azar: los eventos ya traen las cartas repartidas.
- **El motor no distingue quién envía una acción.** Que un cliente solo pueda enviar `APOSTAR` y `JUGAR_CARTA` es responsabilidad del servidor.

## Fases

```
READY_TO_START → DEALER_DRAW → BETTING → PLAYING ⇄ TRICK_RESOLUTION → ROUND_SUMMARY
                                  ↑___________________________________________|  (partida < 14)
                                                                  ROUND_SUMMARY → FINISHED  (partida 14)
                                                                  cualquier fase → ABORTED
```

`LOBBY` vive en el servidor. `ROUND_SETUP` y `ROUND_SCORING` son transitorios: ocurren dentro de una misma transición.

## Acciones

| Acción | Quién | Fase válida |
|---|---|---|
| `INICIAR_JUEGO` | servidor | `READY_TO_START` |
| `SORTEAR_REPARTIDOR` | servidor | `DEALER_DRAW` (sortea, reparte y abre las apuestas de la partida 1) |
| `APOSTAR` | jugador de turno | `BETTING` |
| `JUGAR_CARTA` | jugador de turno | `PLAYING` |
| `AVANZAR` | servidor, tras las pausas de lectura | `TRICK_RESOLUTION`, `ROUND_SUMMARY` |
| `PILOTO_AUTOMATICO` | servidor | `BETTING`, `PLAYING` |
| `ABORTAR_JUEGO` | servidor | cualquiera salvo `FINISHED` y `ABORTED` |

## Errores

`NO_ES_TU_TURNO`, `ESTADO_INVALIDO`, `APUESTA_FUERA_DE_RANGO`, `APUESTA_PROHIBIDA_PIE`, `APUESTA_YA_REALIZADA`, `CARTA_NO_EN_MANO`, `JUEGO_TERMINADO`, `JUGADOR_DESCONOCIDO`, `JUGADORES_DUPLICADOS`, `CANTIDAD_JUGADORES_INVALIDA`, `CONFIGURACION_INVALIDA`.

## Módulos

| Archivo | Responsabilidad |
|---|---|
| `cartas.ts` | Mazo de 53 cartas, valores, validación del mazo |
| `rng.ts` | Fuente de azar inyectable y mezcla |
| `mesa.ts` | Orden hacia la derecha, repartidor, Mano, Pié |
| `sorteo.ts` | Sorteo inicial del repartidor con repetición entre empatados |
| `apuestas.ts` | Apuestas válidas y valor prohibido del Pié |
| `bazas.ts` | Ganador de la baza, fichas de los montones |
| `puntaje.ts` | Puntos por partida |
| `ranking.ts` | Ranking final, desempate y podio compartido |
| `selectores.ts` | Datos derivados: de quién es el turno, apuestas válidas, fichas |
| `piloto.ts` | Qué hace el piloto automático |
| `maquina.ts` | Estados y transiciones: `createGame`, `decide`, `evolve`, `apply`, `replay` |
| `invariantes.ts` | Chequeo de integridad del estado (para pruebas y auditoría) |

## Convención de nombres

Las entidades siguen el vocabulario aprobado en inglés (`Game`, `Round`, `Trick`, `Lead`, `Last`, `Dealer`); las acciones, eventos y códigos de error están en español, tal como en el protocolo del diseño técnico. Los asientos se numeran de `0` a `n-1`, y "a la derecha" de un asiento es siempre el siguiente.

## Qué no incluye (todavía)

- Las **vistas por jugador** (ocultar cartas ajenas) son la etapa 4. Hoy el estado y los eventos son completos y **privados del servidor**: nunca deben enviarse tal cual a los clientes.
- Sala, anfitrión, conexiones, temporizadores y persistencia son del servidor.

## Pruebas

```bash
npm test -w @tokinoto/reglas
```

Incluyen los ejemplos oficiales del reglamento, un rechazo por cada error, y juegos completos con jugadas al azar que verifican los invariantes en cada paso (suma de apuestas distinta de N, 53 cartas únicas, cartas nunca repetidas, al menos un jugador con 0 puntos por partida, etc.) y la reconstrucción exacta del estado desde los eventos.
