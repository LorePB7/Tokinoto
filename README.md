# Tokinoto

Juego de cartas **Tokinoto** en versión online multijugador (4 a 7 jugadores, 14 partidas).

## Documentación

- [`docs/especificacion-tecnica.md`](docs/especificacion-tecnica.md): reglas del juego y decisiones aprobadas (fuente de verdad).
- [`docs/diseno-tecnico.md`](docs/diseno-tecnico.md): tecnologías, arquitectura, modelo de datos y protocolo cliente-servidor.

## Estructura

```
packages/
  reglas/     Motor de reglas (TypeScript puro, sin red ni base de datos)   ← etapa 1
  simulador/  Simulador en consola que juega juegos completos al azar     ← etapa 2
  servidor/   (pendiente) Node.js + Socket.IO
  cliente/    (pendiente) React + Vite
docs/         Especificación y diseño
```

## Hoja de ruta

| Etapa | Entregable | Estado |
|---|---|---|
| 1 | Motor de reglas con pruebas automáticas | Hecho |
| 2 | Simulador en consola | Hecho |
| 3 | Servidor mínimo (una sala, WebSocket) | Pendiente |
| 4 | Vistas por jugador (ocultar cartas ajenas) | Pendiente |
| 5 | Cliente básico (lobby, mesa, apuesta y tirada) | Pendiente |
| 6 | Reconexión, temporizadores y piloto automático | Pendiente |
| 7 | Persistencia (PostgreSQL) | Pendiente |
| 8 | Pulido de interfaz | Pendiente |
| 9 | Despliegue | Pendiente |

## Desarrollo

Requiere Node.js 20 o superior.

```bash
npm install
npm test          # pruebas de todos los paquetes
npm run typecheck # chequeo de tipos

# Simulador: juega juegos completos al azar y verifica el motor
npm run simular -w @tokinoto/simulador -- --juegos 1 --jugadores 5 --semilla 2 --detalle
```
