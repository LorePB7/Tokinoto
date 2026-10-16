# @tokinoto/persistencia

Historial de juegos en PostgreSQL (etapa 7, DP-21). Guarda cada juego terminado o abortado: quién jugó, el puntaje de cada partida, el ranking final y el registro de eventos para auditar. **No hay ranking global ni cuentas.** Las salas y los juegos en curso viven en memoria, en el servidor.

## Qué se guarda

| Tabla | Contenido |
|---|---|
| `salas` | Código de la sala y cuándo se creó |
| `juegos` | Estado (`EN_CURSO`, `TERMINADO`, `ABORTADO`), motivo de aborto, configuración, inicio y cierre |
| `jugadores_de_juego` | Asiento, identificador y nombre de cada jugador |
| `puntajes_de_partida` | Por partida y asiento: apuesta, bazas ganadas y puntos |
| `ranking_final` | Por asiento: total y puesto (los empates comparten puesto) |
| `eventos` | Los eventos del motor de reglas, en orden (`seq`) |

Una revancha es otro juego de la misma sala. Los puntajes, el ranking y el cierre se derivan de los eventos al guardarlos, y todo se escribe en una sola transacción por lote. Repetir un lote (un reintento) no duplica nada.

### Desviaciones del diseño técnico (3.6)

- 🔵 **Sin semilla.** En vez de guardar una semilla para repetir el juego, se guardan los eventos del motor (incluidas las manos repartidas). Con ellos se reconstruye el juego exacto, sin depender del generador de azar.
- 🔵 **Una sola tabla de eventos**, la del motor. No se guarda aparte lo que se emitió a los clientes, porque se deriva de esa tabla.
- 🔵 **No se retoman salas en curso** tras un reinicio (DT-05: se acepta abortar). Al apagar el servidor, y de nuevo al iniciarlo (por si se cayó sin avisar), los juegos que seguían `EN_CURSO` se cierran como `ABORTADO` con el motivo "Reinicio del servidor".
- 🔵 **Privacidad.** La tabla `eventos` contiene las manos de todos los jugadores. Es de uso interno: ningún mensaje del servidor a los clientes sale de ella, y nunca debe exponerse por una API.

## Uso

El servidor guarda el historial si encuentra `DATABASE_URL` (ver [`@tokinoto/servidor`](../servidor)). Las migraciones se aplican solas al iniciar.

```bash
export DATABASE_URL=postgres://usuario:clave@localhost:5432/tokinoto
npm run iniciar -w @tokinoto/servidor
```

Sin `DATABASE_URL` el servidor funciona igual, pero no guarda nada.

### Consultar el historial

```bash
npm run historial -w @tokinoto/persistencia -- listar --limite 10
npm run historial -w @tokinoto/persistencia -- ver <idJuego>
npm run historial -w @tokinoto/persistencia -- verificar todos
```

`verificar` reconstruye cada juego desde sus eventos (`createGame` más un `evolve` por evento), comprueba los invariantes y lo compara con los puntajes, el ranking y el estado guardados. Si algo no coincide, lo informa y termina con error.

### Cambiar el esquema

El esquema está en `src/esquema.ts`. Después de modificarlo:

```bash
npm run generar -w @tokinoto/persistencia   # crea una migración nueva en migraciones/
```

Hay que subir la migración generada junto con el cambio. No se editan las migraciones ya aplicadas.

## En el código

```ts
import { abrirRepositorioPostgres } from '@tokinoto/persistencia';
const repo = await abrirRepositorioPostgres(process.env.DATABASE_URL!); // migra y conecta
```

- `abrirRepositorioPostgres(url)`: producción.
- `abrirRepositorioPglite()`: PostgreSQL embebido, solo para pruebas.
- `crearRepositorioEnMemoria()`: sin base, mismo contrato; sirve para pruebas.
- `reconstruirJuego` y `verificarJuego`: reconstrucción y verificación.

## Pruebas

```bash
npm test -w @tokinoto/persistencia
# Además contra un PostgreSQL real (vacía las tablas de esa base):
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/tokinoto_prueba npm test -w @tokinoto/persistencia
```

Las mismas pruebas corren contra la versión en memoria, PGlite y PostgreSQL: guardado de juegos completos, idempotencia, abortos, revanchas, listados, rechazo de eventos de un juego inexistente y detección de historiales dañados (puntaje, ranking o evento alterado o faltante).
