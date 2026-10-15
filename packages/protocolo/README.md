# @tokinoto/protocolo

Este paquete lo comparten el servidor y el cliente (etapa 4). Define cómo se hablan y qué puede ver cada jugador. El detalle de cada mensaje está en [`docs/protocolo.md`](../../docs/protocolo.md).

## Contenido

| Archivo | Qué tiene |
|---|---|
| `protocolo.ts` | Sobre de mensajes y esquemas Zod de los comandos (`leerPedido`). También los tipos de cada evento (`DatosEventos`), de las respuestas y de la foto |
| `errores.ts` | Códigos de error en español y su traducción desde el motor |
| `vista.ts` | `proyectarJuego(estado, jugador)`: la vista del juego para un jugador (la regla de oro). Incluye los tipos `VistaSala` y `VistaJuego` |
| `seguimiento.ts` | `aplicarMensaje(estado, mensaje)`: cómo el cliente mantiene su estado con la foto y los eventos, y cómo detecta saltos |

## La regla de oro

El servidor **nunca** envía el estado completo del juego. Cada jugador recibe solo su vista:

- **Su mano:** completa.
- **Manos de los demás:** solo la cantidad de cartas.
- **Baza en curso:** todas las cartas, porque son públicas.
- **Bazas cerradas:** la carta ganadora y quién ganó.
- **Apuestas, bazas ganadas y puntajes:** todos.
- **Mazo:** nada.

`proyectarJuego` es la única función que lee las manos para armar lo que ve un jugador, y solo lee la mano de ese jugador.

## Pruebas

```bash
npm test -w @tokinoto/protocolo
```

- **Regla de oro (propiedad con fast-check):** se recorren juegos completos al azar, de 4 a 7 jugadores, con miles de estados reales. En cada estado y para cada jugador se comprueba que la vista no contiene ninguna carta de otra mano, ni cartas que no sean propias o públicas.
- **Pruebas que se rompen a propósito:** se introdujeron cuatro filtraciones distintas en el proyector (la mano del vecino, todas las manos, una sola carta ajena y una carta colada en el sorteo). Las pruebas detectaron las cuatro.
- **Seguimiento:** foto inicial, eventos en orden, repetidos, saltos, resincronización e inmutabilidad.

La garantía "foto = eventos" se prueba en el servidor (`packages/servidor/test/vistas.test.ts`), porque necesita la sala completa.
