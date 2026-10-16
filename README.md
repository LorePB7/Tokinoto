# Tokinoto

Juego de cartas **Tokinoto** en versión online multijugador (4 a 7 jugadores, 14 partidas).

## Documentación

- [`docs/especificacion-tecnica.md`](docs/especificacion-tecnica.md): reglas del juego y decisiones aprobadas (fuente de verdad).
- [`docs/diseno-tecnico.md`](docs/diseno-tecnico.md): tecnologías, arquitectura, modelo de datos y protocolo cliente-servidor.
- [`docs/protocolo.md`](docs/protocolo.md): mensajes que implementa el servidor, con un ejemplo de cada uno.

## Estructura

```
packages/
  reglas/     Motor de reglas (TypeScript puro, sin red ni base de datos)   ← etapa 1
  simulador/  Simulador en consola que juega juegos completos al azar     ← etapa 2
  protocolo/  Mensajes, vistas por jugador y seguimiento (compartido)     ← etapa 4
  servidor/   Servidor autoritativo con Node.js y Socket.IO                ← etapa 3
  cliente/    Interfaz web con React y Vite (lobby, mesa, apuesta, tirada)  ← etapa 5
docs/         Especificación y diseño
```

## Hoja de ruta

| Etapa | Entregable | Estado |
|---|---|---|
| 1 | Motor de reglas con pruebas automáticas | Hecho |
| 2 | Simulador en consola | Hecho |
| 3 | Servidor mínimo (salas, WebSocket) | Hecho |
| 4 | Vistas por jugador (ocultar cartas ajenas) | Hecho |
| 5 | Cliente básico (lobby, mesa, apuesta y tirada) | Hecho |
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

# Servidor (puerto 3001 por defecto)
npm run iniciar -w @tokinoto/servidor

# Cliente web (http://localhost:5173; busca el servidor en el puerto 3001 del mismo equipo)
npm run dev -w @tokinoto/cliente

# Prueba de punta a punta: abre un navegador por jugador y juega un juego entero
npm run e2e -w @tokinoto/cliente -- --jugadores 4
```
