# @tokinoto/simulador

Simulador en consola (etapa 2). Juega juegos completos de Tokinoto con apuestas y cartas elegidas **al azar pero siempre legales**, y comprueba que el motor de reglas (`@tokinoto/reglas`) nunca viole un invariante. Sirve para ver el juego funcionando y para detectar errores del motor antes de armar el servidor.

> Las jugadas son al azar: las estadísticas sirven para comprobar el motor, **no** para balancear el juego.

## Uso

Desde la raíz del repositorio:

```bash
# Simula 1000 juegos (de 4 a 7 jugadores) y muestra un informe
npm run simular -w @tokinoto/simulador

# Cuenta un juego completo, partida por partida y baza por baza
npm run simular -w @tokinoto/simulador -- --juegos 1 --jugadores 5 --semilla 2 --detalle

# 5000 juegos de 6 jugadores
npm run simular -w @tokinoto/simulador -- --juegos 5000 --jugadores 6
```

| Opción | Significado |
|---|---|
| `--juegos N` | Cantidad de juegos (por defecto 1000) |
| `--jugadores N\|todos` | De 4 a 7, o `todos` para alternar de 4 a 7 (por defecto `todos`) |
| `--semilla N` | Semilla inicial; el juego número `i` usa `semilla + i` (por defecto 1) |
| `--detalle` | Narra el primer juego completo: sorteo, manos, apuestas, cada baza y puntajes |
| `--sin-verificar` | No chequea invariantes tras cada acción (más rápido) |
| `-h`, `--ayuda` | Muestra la ayuda |

## Torneo de bots (fase 8)

Hace jugar a los niveles de bot entre sí (y contra jugadas al azar) y muestra cuántos puntos suma cada uno por juego. Sirve para ajustar la estrategia de `reglas/src/bots.ts`: lo que se promete es el orden difícil > medio > fácil, y un test lo exige.

```bash
npm run torneo -w @tokinoto/simulador -- --juegos 200 --jugadores todos --niveles facil,medio,dificil,azar
```

Cada participante va pasando por todos los asientos. El difícil es más lento (simula repartijas en cada jugada): con muchos juegos tarda unos minutos.

Con la verificación activada se procesan unos 19 juegos por segundo. El programa termina con código `0` si todo salió bien, `1` si algún juego violó una regla y `2` si los argumentos son inválidos.

## Qué verifica

En cada acción (salvo con `--sin-verificar`) se ejecutan los invariantes del motor (`checkInvariants`): 53 cartas únicas, suma de apuestas distinta de N, al menos un jugador con 0 puntos por partida, tamaño de las manos, puntajes en rango, entre otros. Al terminar cada juego se comprueba además que:

- se resolvieron exactamente 56 bazas y 14 partidas;
- el estado reconstruido desde los eventos es idéntico al estado final;
- el motor nunca rechazó una jugada legal.

Si un juego falla, el informe muestra las violaciones y el comando exacto para reproducirlo con su semilla.

## Informe

Además del resultado, el informe resume lo que pasó en los juegos completos: aciertos exactos (en total y por tamaño de partida), cuántas veces el Pié tuvo un valor prohibido, bazas ganadas por el Mano y por el Comodín, sorteos del repartidor con repetición por empate, podios compartidos y puntaje del ganador.

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `juego.ts` | Simula un juego completo y detecta violaciones |
| `estadisticas.ts` | Calcula y acumula estadísticas a partir de los eventos |
| `narracion.ts` | Cuenta un juego en líneas de texto |
| `corrida.ts` | Simula muchos juegos seguidos |
| `informe.ts` | Arma el informe final |
| `argumentos.ts` | Lee la línea de comandos |
| `formato.ts` | Cartas y números en español |
| `cli.ts` | Punto de entrada |
