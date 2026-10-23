# Tokinoto Online: Diseño Técnico v1 (recomendaciones)

**Base:** `tokinoto_especificacion_tecnica_v4.md` (reglas y decisiones online ya aprobadas).
**Etapa:** diseño. Todavía no se escribe código del juego.
**Estado de este documento:** todo lo que sigue es **🔵 RECOMENDACIÓN** a revisar juntos. Nada es regla del juego ni está aprobado todavía. Al final (sección 6) hay una lista corta de decisiones que necesito que tomes.

**Perfil del equipo considerado:** una persona con conocimientos de React, JavaScript y PHP, abierta a otras tecnologías.

---

## 0. Resumen ejecutivo

| Tema | Recomendación en una línea |
|---|---|
| Lenguaje | **TypeScript en todo el proyecto** (cliente y servidor). Es JavaScript con tipos, así que aprovechás lo que ya sabés. |
| Motor de reglas | Un módulo **puro y sin dependencias**, compartido entre cliente y servidor, que recibe un estado y una acción y devuelve el nuevo estado y los eventos. |
| Servidor | **Node.js** con **WebSockets** (vía Socket.IO). Un solo proceso al principio. |
| Cliente | **React + Vite**, con la lógica del juego siempre en el servidor. |
| Base de datos | **PostgreSQL**, solo para historial y resultados. Las partidas en curso viven en memoria. |
| Arquitectura | **Servidor autoritativo**, estado en memoria, registro de eventos, y una "vista" distinta por cada jugador para no filtrar cartas ajenas. |
| Protocolo | Mensajes con **sobre común** (versión, tipo, id de pedido), **acciones del cliente** muy simples y **eventos numerados del servidor** para poder resincronizar. |
| PHP | **No lo recomiendo** para este proyecto (explicado en 2.3). |

---

## 1. Motor de reglas

### 1.1 Qué es y qué no es
🔵 El motor de reglas es **la única parte que sabe cómo se juega Tokinoto**. No sabe nada de internet, pantallas, bases de datos ni temporizadores. Recibe lo que pasó y responde qué cambia.

Beneficios concretos:
- Se prueba **sin levantar un servidor** ni abrir un navegador.
- Se reutiliza en el cliente para **habilitar o deshabilitar botones** (por ejemplo, el valor prohibido del Pié) y en el servidor para **validar de verdad**. Una sola implementación, cero divergencias.
- Si mañana cambia la tecnología de red o de pantalla, las reglas no se tocan.

### 1.2 Forma recomendada: función pura de transición
🔵
```
aplicar(estado, acción)  →  { estado nuevo, eventos }   o   { error }
```
- **Pura:** misma entrada, misma salida. Sin reloj, sin azar interno, sin lecturas externas.
- **El azar entra desde afuera:** el mezclado y el sorteo reciben una fuente de aleatoriedad como parámetro. Así los tests usan una semilla fija y el servidor usa una fuente criptográficamente segura.
- **Inmutable:** nunca modifica el estado recibido; devuelve uno nuevo. Facilita el registro de eventos y la reconstrucción.
- **Los eventos son el resultado principal:** "se repartió", "Juan apostó 2", "Ana tiró la K", "ganó la baza Luis". El estado se puede reconstruir aplicando eventos en orden.

### 1.3 Acciones que acepta el motor
🔵 Mínimas y explícitas (los nombres siguen el vocabulario aprobado):

| Acción | Quién la envía | Estado en que es válida |
|---|---|---|
| `INICIAR_JUEGO` | Anfitrión | `READY_TO_START` |
| `SORTEAR_REPARTIDOR` | Sistema | `DEALER_DRAW` |
| `APOSTAR(valor)` | Jugador de turno | `BETTING` |
| `JUGAR_CARTA(idCarta)` | Jugador de turno | `PLAYING` |
| `AVANZAR` | Sistema (tras pausas de lectura) | `TRICK_RESOLUTION`, `ROUND_SUMMARY` |
| `PILOTO_AUTOMATICO(jugador)` | Sistema | `BETTING` o `PLAYING` |

El sistema (no un jugador) dispara `SORTEAR_REPARTIDOR`, `AVANZAR` y `PILOTO_AUTOMATICO`. Esto evita que un cliente pueda forzarlos.

### 1.4 Módulos internos sugeridos
🔵 Un archivo o módulo por responsabilidad, cada uno probable por separado. Se corresponden con las funciones de la sección 13.1 de la especificación v4:

| Módulo | Responsabilidad |
|---|---|
| `cartas` | Valor de carta, construcción del mazo de 53, validaciones del mazo |
| `mesa` | Derecha de un asiento, repartidor, Mano, Pié, órdenes de apuesta y de tirada |
| `sorteo` | Sorteo inicial con repetición entre empatados |
| `apuestas` | Apuestas válidas, valor prohibido del Pié |
| `bazas` | Ganador de la baza, armado de montones y fichas |
| `puntaje` | Puntos de partida y acumulado |
| `ranking` | Total, desempate por mejores puntajes, podio compartido |
| `maquina` | Estados y transiciones; decide qué acción es válida en cada estado |
| `vista` | Proyecta el estado completo a lo que puede ver cada jugador (sección 3.4) |

### 1.5 Estrategia de pruebas
🔵 Es lo más valioso de esta etapa, porque el reglamento ya trae ejemplos y propiedades verificables.

1. **Pruebas con ejemplos oficiales:** 7 puntos (apostar 2, ganar 2), 5 puntos (apostar 0, ganar 0), el Pié en una partida de 6 cartas con suma previa 5, los cuatro ejemplos de baza de la sección 8.2, el desempate final.
2. **Pruebas por propiedades:** simular **miles de juegos completos con jugadas al azar** y comprobar los invariantes en cada paso:
   - suma de bazas ganadas = N al cerrar cada partida;
   - suma de apuestas ≠ N;
   - 53 cartas únicas con exactamente 1 Comodín;
   - ninguna carta repartida dos veces;
   - ningún jugador supera `5 + N` puntos en una partida.
3. **Pruebas de rechazo:** una por cada error de la sección 13.3 de la especificación (fuera de turno, valor prohibido, carta ajena, etc.).
4. **Repetición determinista:** con una misma semilla, un juego completo produce siempre el mismo resultado. Sirve para reproducir errores.
5. **Reconstrucción:** aplicar todos los eventos registrados a un estado inicial debe dar exactamente el estado final.

🔵 Meta de calidad sugerida: **no pasar al servidor hasta que el motor pase todas estas pruebas.**

### 1.6 Detalles que conviene fijar desde el principio
- **Identificador de carta estable**, por ejemplo `"K-picas"` o `"COMODIN"`. Es lo que viaja por la red, nunca la posición en la mano.
- **El desempate de la baza** se implementa con la regla "reemplaza solo si es estrictamente mayor", que cubre el Comodín y los empates sin casos especiales (ver 8.2 de la especificación).
- **Cartas sobrantes del mazo:** se ignoran. Las ve solo el servidor y no se registran como visibles para nadie.
- **Constantes en un único archivo de configuración:** `CARDS_PER_ROUND`, puntos base, límites de jugadores, tiempos.

---

## 2. Elección de tecnologías

### 2.1 Criterios
🔵 Ordenados por importancia para este proyecto:
1. **Tiempo real fiable:** reconexión, mensajes en orden, un jugador a la vez.
2. **Una sola persona desarrollando:** menos piezas y menos lenguajes.
3. **Reglas compartidas** entre cliente y servidor.
4. **Costo de alojamiento bajo** al inicio.
5. **Facilidad de que yo te ayude a escribir y revisar el código.**

### 2.2 Recomendación principal

| Capa | Recomendación | Por qué |
|---|---|---|
| Lenguaje | **TypeScript** | Es JavaScript con verificación de tipos. Los tipos protegen justo lo más delicado de este juego: estados, acciones y mensajes. Una sola persona, un solo lenguaje. |
| Servidor | **Node.js** | Excelente para muchas conexiones simultáneas. Comparte código con el cliente. |
| Tiempo real | **Socket.IO** | Resuelve reconexión automática, salas y respaldo si el WebSocket falla. Reduce bastante código de infraestructura. |
| Cliente | **React + Vite** | Ya lo conocés. Vite es rápido y simple de configurar. |
| Estado en el cliente | **Zustand** (o similar liviano) | Estado compartido sin la complejidad de Redux. |
| Estilos y animación | **CSS + una librería de animación liviana** | Las cartas y los montones necesitan movimiento. A definir al diseñar la interfaz. |
| Validación de mensajes | **Zod** (o similar) | Valida que cada mensaje tenga la forma correcta antes de tocar el motor. |
| Base de datos | **PostgreSQL** | Historial, resultados y registro de eventos. |
| Acceso a datos | **Drizzle** o **Prisma** | Cualquiera sirve; elegir al empezar el modelo de datos. |
| Pruebas | **Vitest** + **fast-check** | Vitest para ejemplos; fast-check para las pruebas por propiedades de la sección 1.5. |
| Organización | **Monorepo** con tres paquetes: `reglas`, `servidor`, `cliente` | El paquete `reglas` lo importan los otros dos. |
| Alojamiento inicial | Un proveedor de contenedores simple (Fly.io, Railway, Render o similar) | Un solo proceso Node con WebSocket y una base Postgres gestionada. |

### 2.3 Alternativas y por qué no son mi primera opción

| Alternativa | Ventajas | Por qué no la elijo primero |
|---|---|---|
| **PHP en el servidor** | Ya lo conocés. | PHP clásico atiende cada pedido y termina: **no mantiene en memoria una partida en curso**. Para tiempo real habría que sumar piezas extra (Ratchet, Swoole u otro) o sacar el estado a una base en cada jugada. Además **duplicarías las reglas** en PHP y en JavaScript, y esa duplicación es una fuente clásica de errores. |
| **Colyseus** (framework de juegos multijugador para Node) | Trae salas, sincronización de estado y filtrado por jugador ya resueltos. | Es más opinado: te ata a su forma de sincronizar el estado y su ciclo de vida. Es una **buena segunda opción** si querés acelerar. Aprender sus convenciones cuesta algo. |
| **WebSocket puro (`ws`)** | Más liviano y control total. | Hay que escribir uno mismo la reconexión, las salas y los latidos. |
| **Servicios gestionados (Firebase, Supabase Realtime)** | Menos servidor propio. | La lógica autoritativa (validar turnos, ocultar cartas, temporizadores, piloto automático) igual necesita código de servidor. Terminás con **dos lugares** donde viven reglas. |
| **Cloudflare Durable Objects / PartyKit** | Cada sala es una unidad aislada y escala sola. | Modelo menos conocido. Buena opción **más adelante**, si crecés. Para empezar suma conceptos nuevos. |
| **Python, Go, Elixir, Java** | Son sólidos para servidores. | Obligan a reescribir las reglas para el cliente o a hacerlas solo en servidor. No aportan una ventaja decisiva a esta escala. |

### 2.4 Cuándo cambiaría mi recomendación
- Si **no querés** TypeScript sino JavaScript puro: se puede, pero se pierde buena parte de la protección de tipos. No lo recomiendo para un juego con reglas estrictas.
- Si buscás **la ruta más corta a un prototipo jugable**: Colyseus.
- Si esperás **miles de salas simultáneas**: ver la sección 3.7.

### 2.5 Nota sobre el aprendizaje
🔵 TypeScript no es un lenguaje nuevo desde cero: casi todo lo que sabés de JavaScript y React se aplica igual. La curva real son los tipos y los módulos, y yo puedo acompañarte con eso a medida que avancemos.

---

## 3. Arquitectura y modelo de datos

### 3.1 Vista general
🔵
```
 Navegadores (React)
      │  WebSocket
      ▼
 Servidor Node  ──────────────►  PostgreSQL
  ├─ Conexiones y sesiones          (historial, resultados,
  ├─ Gestor de salas                 registro de eventos)
  │   └─ Sala (en memoria)
  │       ├─ Estado del juego
  │       ├─ Temporizadores
  │       └─ Piloto automático
  └─ Motor de reglas (paquete compartido)
```

### 3.2 Principios
🔵
1. **Servidor autoritativo:** el cliente envía **intenciones** ("quiero tirar esta carta"); el servidor decide. Ningún dato del cliente se acepta como cierto.
2. **Una sala = un estado en memoria = una cola de acciones.** Las acciones de una sala se procesan **de a una, en orden**. Eso elimina las condiciones de carrera (dos jugadores tirando a la vez).
3. **Registro de eventos como fuente de verdad:** cada acción válida genera eventos numerados que se guardan. El estado actual se puede reconstruir desde ellos.
4. **El tiempo lo maneja el servidor:** temporizadores, pausas de 3 y 10 segundos, y piloto automático viven en la sala, no en el cliente.
5. **Cada jugador recibe su propia vista:** nunca el estado completo (sección 3.4).

### 3.3 Componentes del servidor

| Componente | Responsabilidad |
|---|---|
| **Conexiones** | Autentica la sesión, asocia cada conexión con un jugador, detecta desconexiones. |
| **Gestor de salas** | Crea salas con código de invitación, las busca, las cierra. |
| **Sala** | Contiene el estado, procesa acciones en orden, programa temporizadores, activa el piloto automático. |
| **Motor de reglas** | Valida y calcula transiciones (paquete compartido). |
| **Proyector de vistas** | Arma lo que ve cada jugador. |
| **Persistencia** | Guarda eventos y resultados en la base, sin bloquear el juego. |

### 3.4 Información oculta: la regla de oro
🔵 **Principio:** el servidor **nunca envía algo que el jugador no deba ver**, ni siquiera "escondido" en la interfaz.

La función `vista(estado, jugador)` produce lo que cada uno recibe:

| Dato | ¿Qué recibe el jugador? |
|---|---|
| Su mano | Las cartas completas |
| Mano de los demás | **Solo la cantidad de cartas** que les quedan |
| Cartas sobre la mesa en la baza en curso | Todas (son públicas) |
| Bazas ya cerradas | **Solo la carta ganadora y quién ganó** (regla aprobada) |
| Apuestas, fichas restantes, puntajes | Todos |
| Mazo y cartas sobrantes | Nada (ni siquiera cuántas sobran) |
| Registro de eventos completo | Solo la versión filtrada para ese jugador |

🔵 Pruebas obligatorias: para cada jugador y en cada estado, comprobar que la vista no contiene ninguna carta ajena. Es el error más grave posible en un juego de cartas online.

### 3.5 Estado en memoria (modelo lógico)
🔵 Sin sintaxis de ningún lenguaje; solo qué datos hay:

**Sala**
- código, anfitrión, estado de la sala, configuración (cantidad de jugadores, tiempos), lista de asientos.
- Desde la fase 7: los últimos 50 mensajes de chat (solo en memoria, fuera del registro de eventos; se borran al cerrarse la sala) y la lista de personas expulsadas (por clave de identidad), que no pueden volver a esa sala.

**Asiento / Jugador**
- id de jugador, nombre, número de asiento, conectado o no, piloto automático activo o no, contador de vencimientos seguidos, puntajes por partida (hasta 14), puntaje total.

**Juego**
- número de partida actual, repartidor, estado de la máquina, historial de eventos, semilla del azar.

**Partida (Round)**
- número, cartas por jugador, repartidor, Mano inicial, apuestas por asiento (con `null` = todavía no apostó), manos de cada jugador (privadas), baza actual, bazas ganadas por asiento.

**Baza (Trick)**
- número, Mano de esa baza, tiradas en orden (jugador + carta), ganador una vez resuelta.

**Montón ganado**
- número de baza, ganador, carta ganadora, con ficha o sin ficha.

### 3.6 Modelo de datos en la base de datos
🔵 La base **no** guarda partidas en curso (viven en memoria). Guarda lo que importa conservar:

| Tabla | Contenido | Para qué |
|---|---|---|
| `salas` | código, anfitrión, configuración, creación | Identificar juegos |
| `juegos` | sala, inicio, fin, estado final (terminado o abortado), semilla | Historial |
| `jugadores_de_juego` | juego, nombre, asiento | Quién participó |
| `puntajes_de_partida` | juego, jugador, número de partida (1 a 14), apuesta, bazas ganadas, puntos | Resultados y desempate |
| `ranking_final` | juego, jugador, total, posición (con empates) | Resultado oficial |
| `eventos` | juego, número de secuencia, tipo, datos, momento | Auditoría y reconstrucción |

🔵 Notas:
- Las dos tablas de puntajes son **derivables** de `eventos`; se guardan igual por comodidad de consulta.
- Fase 6: se sumó la tabla `cuentas` (id, `sub` de Google, nombre editable, alta) y, en `jugadores_de_juego`, las columnas opcionales `cuenta_id` e `invitado`. Los juegos anteriores quedan sin cuenta. La migración es aditiva.
- Fase 8: `jugadores_de_juego` suma la columna opcional `bot` (nivel del bot, o vacía si jugó una persona). Migración `0002_bots.sql`, aditiva. Un juego con bots se guarda solo si alguna persona tiene cuenta.
- Guardar `semilla` permite **repetir un juego exacto** para investigar un error.
- 🔵 Al guardar eventos que contienen cartas privadas, restringir el acceso: **estos datos nunca se exponen a los clientes**.

> **Implementado en la etapa 7** (ver [`packages/persistencia`](../packages/persistencia/README.md)). Desviaciones: 🔵 no se guarda la semilla, porque se guardan los eventos del motor (con las manos), que reconstruyen el juego exacto; 🔵 hay una sola tabla `eventos`, la del motor; la tabla `salas` guarda código y creación (el anfitrión y la configuración de la sala viven en memoria); la configuración del juego se guarda en `juegos`. Solo se guardan juegos terminados o abortados, sin ranking global (DP-21).

### 3.7 Recuperación y escala
🔵
- **Recuperación tras un reinicio del servidor:** como el estado se reconstruye desde `eventos`, una sala puede **retomarse** donde quedó. Para la primera versión, se puede aceptar que un reinicio **aborte** las salas activas (decisión a confirmar, ver 6). *Etapa 7: es lo que se implementó; al apagar o iniciar el servidor, los juegos `EN_CURSO` quedan `ABORTADO` con el motivo "Reinicio del servidor".*
- **Escala:** un solo proceso Node soporta con holgura cientos de salas de 4 a 7 jugadores, que es mucho más de lo que necesitás al inicio. Si algún día hace falta más: se puede **repartir las salas entre varios procesos** manteniendo cada sala siempre en el mismo proceso. El diseño de "una sala = una cola" lo permite sin reescribir las reglas.
- **Sin Redis al principio.** Se suma solo si hay más de un proceso.

### 3.8 Identidad y sesiones (fase 6: Google o invitado)
Cambió en la fase 6 del plan de mejoras (DP-16). Antes había un token por asiento y ninguna cuenta.
- Para entrar a una sala hay que identificarse: **con Google** (el servidor verifica el token de identidad y guarda el `sub` y el nombre, nunca el email) o **como invitado** (solo un nombre).
- El servidor entrega una **sesión** propia, firmada con HMAC y con vencimiento (30 días), que el navegador guarda en `localStorage`. Cada conexión nueva la presenta antes que nada. Al ser firmada, sobrevive a un reinicio del servidor.
- El asiento se recupera con la sesión: el servidor recuerda en qué sala está sentada cada persona (una sala activa a la vez). El token interno del asiento ya no sale del servidor.
- Quien pierde la sesión (borra los datos del navegador) vuelve a entrar con Google y recupera su asiento; un invitado lo pierde, y lo cubre el piloto automático.
- Detalle en [`protocolo.md`](protocolo.md#cuentas-y-sesiones).
- Fase 7: la expulsión se hace sobre la clave de la persona (`g:<cuentaId>` o `i:<idInvitado>`), así no vuelve a esa sala ni con otra pestaña ni con otro nombre. Con otra cuenta de Google o como invitado nuevo sí podría: para un grupo de amigos alcanza.

### 3.9 Seguridad básica
🔵
- Validar con esquema **todo** mensaje entrante antes de usarlo.
- Limitar la frecuencia de mensajes por conexión.
- Códigos de sala **no adivinables** (largos y aleatorios).
- Nunca confiar en el nombre, el asiento ni el turno que dice el cliente: se derivan del token.
- Fuente de azar **criptográficamente segura** para el mezclado.
- Verificar el origen de las conexiones y usar conexión cifrada.

### 3.10 Sonido (cliente, fase 4)
- Generado con Web Audio en el navegador (`cliente/src/sonido`): sin archivos de audio, sin cambios en la CSP, sin tocar servidor ni protocolo.
- `control.ts`: preferencias (sonido, volumen, música) recordadas en el navegador, todo activado al inicio con volumen bajo; no suena hasta el primer toque; separación mínima por sonido para que turno y chat no suenen en cascada; la música se corta con la pestaña en segundo plano.
- `eventos.ts`: función pura mensaje → sonidos (carta tirada, baza ganada por mí, mi turno, fin de partida, podio). Las fotos no suenan. Desde la fase 7, un `chat.mensaje` de otra persona suena con `chat` (los propios, no).
- `sintetizador.ts`: tonos y música de fondo (La m, Fa, Do, Sol, en loop).
- Control en la barra de la mesa y flotante en inicio y sala. Prueba de oído: agregar `#sonidos` al final de la dirección.

### 3.11 Bots (fase 8)
- **Estrategia** en `reglas/src/bots.ts`, pura: `botView(estado, asiento)` arma lo que ve una persona en ese asiento (su mano, apuestas, bazas, la baza en curso y la carta ganadora de cada baza cerrada) y `botChoice(estado, asiento, nivel, azar)` decide **solo con esa vista**. Un test reparte distinto las cartas que el bot no ve y exige la misma decisión.
- **Niveles:** fácil cuenta cartas altas con margen de error y juega "alta si me faltan, baja si no". Medio estima la probabilidad de ganar con cada carta, elige la apuesta que más puntos espera (`(5 + b) · P(ganar b)`) y juega para cumplirla (descarta la carta más alta que no gana, gana con la justa). Difícil imagina 40 a 48 repartijas de las cartas que no ve, juega cada una hasta el final con la estrategia media para todos y elige la apuesta o la carta que más veces cumple. Tarda unos pocos milisegundos por jugada (peor caso medido: ~35 ms con 7 jugadores).
- **Fuerza medida** con `npm run torneo -w @tokinoto/simulador`. Referencia (200 juegos de 4 a 7 jugadores, todos contra todos): difícil ~66, medio ~58, fácil ~36 puntos por juego; el azar, ~18. Un test exige difícil > medio > fácil > azar.
- **Servidor:** el bot es un `Jugador` de la sala con `bot: nivel`, sin conexión ni sesión. La sala agenda su jugada con `pausaBotMs` (1 s) en la misma cola; no usa tiempo límite ni piloto, y no cuenta para "hay alguien conectado".
- **Cliente:** "Contra bots" en el inicio (panel con rivales y nivel), "+ Bot" en la sala de espera (solo el anfitrión) y una cabecita de robot del color del nivel junto al nombre en la mesa.

---

## 4. Protocolo de mensajes cliente ↔ servidor

### 4.1 Principios
🔵
1. **Dos direcciones con roles distintos:**
   - **Cliente → servidor:** *comandos* ("quiero apostar 2"). Pueden ser rechazados.
   - **Servidor → cliente:** *eventos* ("Ana apostó 2", "empezó la baza 3") y *fotos del estado* (snapshots).
2. **Todo mensaje lleva versión del protocolo**, para poder evolucionarlo sin romper clientes viejos.
3. **Todo comando lleva un `idPedido`** único. El servidor responde confirmando o rechazando **ese** pedido. Si el mismo `idPedido` llega dos veces (reintento de red), **se ejecuta una sola vez** (idempotencia).
4. **Los eventos del servidor van numerados** dentro de cada juego (`seq`). Si el cliente nota un salto, pide resincronizar.
5. **El cliente no deduce nada importante:** muestra lo que el servidor confirma. Puede *anticipar* visualmente (por ejemplo, mover la carta) pero corrige si el servidor rechaza.

### 4.2 Sobre común
🔵 Todos los mensajes tienen:

| Campo | Significado |
|---|---|
| `v` | Versión del protocolo |
| `tipo` | Nombre del mensaje (ver tablas) |
| `idPedido` | Solo en comandos y sus respuestas |
| `seq` | Solo en eventos del servidor |
| `datos` | Contenido específico de cada tipo |

### 4.3 Comandos del cliente

| Tipo | Datos | Cuándo |
|---|---|---|
| `sala.crear` | nombre del jugador | Lobby (el tiempo por jugada se elige después con `sala.configurar`) |
| `sala.unirse` | código, nombre del jugador | Lobby |
| `sala.reconectar` | token de sesión | Al volver |
| `sala.salir` | — | Lobby (en juego, el piloto automático toma el asiento) |
| `sala.iniciar` | — | Solo anfitrión, con 4 a 7 jugadores |
| `sala.pausarResumen` | sí / no | Solo anfitrión, entre partidas (decisión DP-23) |
| `juego.apostar` | valor entero | `BETTING`, en turno |
| `juego.jugarCarta` | idCarta | `PLAYING`, en turno |
| `juego.revancha` | — | Solo anfitrión, tras `FINISHED` |
| `sync.pedir` | último `seq` recibido | Si hay un salto de eventos |
| `ping` | — | Latido de conexión |

🔵 **Comandos que no existen a propósito:** el cliente **no puede** pedir sortear, barajar, repartir, avanzar ni resolver una baza. Eso lo hace el servidor.

### 4.4 Respuestas a comandos

| Tipo | Datos |
|---|---|
| `ok` | `idPedido` |
| `error` | `idPedido`, `codigo`, `mensaje` legible |

### 4.5 Códigos de error recomendados
🔵 Uno por cada caso de la especificación v4 (13.3), para que la interfaz pueda reaccionar con precisión:

| Código | Significado |
|---|---|
| `NO_ES_TU_TURNO` | Acción fuera de turno |
| `ESTADO_INVALIDO` | La acción no corresponde a la fase actual |
| `APUESTA_FUERA_DE_RANGO` | Fuera de 0 a N, o no entera |
| `APUESTA_PROHIBIDA_PIE` | Es el valor que cierra la suma |
| `APUESTA_YA_REALIZADA` | Apostó dos veces |
| `CARTA_NO_EN_MANO` | No la tiene, ya la jugó o no existe |
| `JUEGO_TERMINADO` | Sobre un juego cerrado o abortado |
| `NO_PERTENECE_A_SALA` | Jugador ajeno |
| `NO_ES_ANFITRION` | Acción reservada al anfitrión |
| `SALA_LLENA` / `SALA_NO_EXISTE` / `JUEGO_YA_INICIADO` | Errores de ingreso |
| `CANTIDAD_JUGADORES_INVALIDA` | Fuera de 4 a 7 al iniciar |
| `MENSAJE_INVALIDO` | No cumple el esquema |
| `DEMASIADOS_MENSAJES` | Límite de frecuencia |

### 4.6 Eventos del servidor
🔵 Visibles para todos, salvo los marcados como privados.

**Sala**
| Tipo | Datos |
|---|---|
| `sala.jugadorEntro` / `sala.jugadorSalio` | jugador, asiento |
| `sala.anfitrionCambio` | nuevo anfitrión |
| `jugador.conexion` | jugador, conectado sí/no |
| `jugador.pilotoAutomatico` | jugador, activado sí/no |

**Juego**
| Tipo | Datos |
|---|---|
| `juego.iniciado` | lista de asientos |
| `sorteo.cartasSacadas` | cartas sacadas por cada jugador, y si hay repetición |
| `sorteo.resultado` | primer repartidor |
| `partida.iniciada` | número de partida, cartas por jugador, repartidor, Mano inicial, Pié |
| `partida.manoRepartida` | **privado:** cartas del jugador. A los demás: solo la cantidad |
| `apuesta.turno` | jugador al que le toca, valor prohibido si es el Pié, fecha límite |
| `apuesta.realizada` | jugador, valor |
| `baza.turno` | jugador al que le toca, fecha límite |
| `baza.cartaJugada` | jugador, carta |
| `baza.resuelta` | ganador, carta ganadora, tiene ficha sí/no, nuevo Mano |
| `partida.puntajes` | apuesta, bazas ganadas y puntos de cada jugador, totales |
| `juego.terminado` | ranking final con empates y podio compartido |
| `juego.abortado` | motivo |

### 4.7 Fotos del estado (snapshots)
🔵
- `estado.foto`: la **vista completa** de ese jugador en el momento actual, con el `seq` correspondiente.
- Se envía **al entrar, al reconectar y al resincronizar**.
- Es el mecanismo que cubre cualquier mensaje perdido: si algo falla, el cliente pide la foto y reemplaza todo su estado.

### 4.8 Reconexión y resincronización
🔵 Flujo sugerido:
1. El navegador pierde la conexión. La interfaz muestra "reconectando" y deshabilita acciones.
2. Al volver, envía `sala.reconectar` con el token.
3. El servidor responde con `estado.foto` y marca al jugador como conectado.
4. Si el piloto automático estaba activo, **se desactiva** a partir del siguiente turno del jugador.
5. Si, estando conectado, el cliente recibe un evento con `seq` que no es el siguiente esperado, envía `sync.pedir` y recibe una nueva foto.

### 4.9 Temporizadores
🔵
- El servidor envía **fecha límite absoluta** (hora del servidor) en cada turno. El cliente la usa para dibujar la cuenta regresiva.
- Para evitar que relojes desajustados confundan al jugador, el servidor informa su hora en cada foto y en los `ping`, y el cliente calcula la diferencia.
- Si el tiempo vence, **el servidor** ejecuta la acción del piloto automático. La del cliente que llegue después se rechaza con `NO_ES_TU_TURNO`.

### 4.10 Ejemplo de intercambio (descrito, sin código)
🔵 Una jugada de carta:
1. Ana toca la K de su mano. El cliente envía `juego.jugarCarta` con `idCarta = K-corazones` y un `idPedido`.
2. El servidor comprueba: ¿está en la fase correcta? ¿es el turno de Ana? ¿tiene esa carta? Todo bien.
3. El servidor responde `ok` solo a Ana.
4. El servidor emite `baza.cartaJugada` a todos, con `seq` correlativo.
5. Si era la última tirada: el servidor emite `baza.resuelta`, espera la pausa de 3 segundos, y luego emite `baza.turno` para la siguiente.

Si Ana hubiera enviado una carta que no tiene, solo ella recibe `error` con `CARTA_NO_EN_MANO`, y los demás no se enteran.

### 4.11 Evolución del protocolo
🔵
- Cada cambio incompatible incrementa `v`.
- El servidor rechaza clientes con una versión que no soporta, con un mensaje claro ("actualizá la página").
- Documentar el protocolo en un archivo propio dentro del repositorio, con **un ejemplo por mensaje**, y mantenerlo junto a los esquemas de validación.

---

## 5. Hoja de ruta sugerida

🔵 Orden pensado para detectar errores cuanto antes y poder jugar pronto:

| Etapa | Entregable | Cómo se comprueba |
|---|---|---|
| **1. Motor de reglas** | Paquete `reglas` con todas las funciones y la máquina de estados | Todas las pruebas de la sección 1.5 en verde |
| **2. Simulador en consola** | Un programa que juega juegos completos con jugadas al azar | Miles de juegos sin violar invariantes |
| **3. Servidor mínimo** | Una sala, WebSocket, comandos y eventos básicos, estado en memoria | Pruebas automáticas con clientes simulados |
| **4. Vistas por jugador** | Proyector de vistas y sus pruebas | Ninguna vista contiene cartas ajenas |
| **5. Cliente básico** | Pantallas de lobby, mesa, apuesta y tirada, **sin animaciones** | Se puede jugar una partida entera entre 4 pestañas |
| **6. Reconexión, temporizadores y piloto automático** | Decisiones DP-12 a DP-14 | Pruebas con desconexiones simuladas |
| **7. Persistencia** | Base de datos, historial, reconstrucción | Reiniciar y recuperar una sala |
| **8. Pulido de interfaz** | Animaciones, montones y fichas, resumen entre partidas, responsive | Sesión de prueba con jugadores reales |
| **9. Despliegue** | Alojamiento, dominio, cifrado, vigilancia de errores | Prueba con amigos |

🔵 Cada etapa termina con algo **demostrable**, así podemos revisarla antes de seguir.

---

## 6. Decisiones que necesito de vos

| ID | Tema | Mi recomendación | Alternativa |
|---|---|---|---|
| DT-01 | Lenguaje | **TypeScript** | JavaScript puro |
| DT-02 | Tiempo real | **Socket.IO** | Colyseus (más rápido de arrancar, más atado a su estilo) |
| DT-03 | Base de datos | **PostgreSQL** | Otra que ya conozcas (MySQL, por ejemplo, también sirve) |
| DT-04 | Organización | **Monorepo** con paquetes `reglas`, `servidor`, `cliente` | Repositorios separados |
| DT-05 | Reinicio del servidor en medio de un juego | **Aceptar abortar** las salas en la primera versión; recuperar desde eventos más adelante | Recuperar desde el inicio |
| DT-06 | Alojamiento | Proveedor de contenedores simple, con presupuesto bajo | Servidor propio (VPS) |
| DT-07 | Estilo visual | A definir en la etapa 8 | Definirlo ya |
| DT-08 | Dispositivos | **Primero navegador de escritorio y móvil con la misma interfaz adaptable** | Solo escritorio al principio |

🔵 Si no tenés preferencias, aprobá mis recomendaciones en bloque y avanzamos con la etapa 1 (motor de reglas).

---

## Resumen de riesgos principales

| Riesgo | Mitigación |
|---|---|
| Filtrar cartas ajenas por error | Vistas por jugador con pruebas obligatorias (3.4) |
| Reglas distintas en cliente y servidor | Un único paquete `reglas` compartido |
| Dos jugadores actuando a la vez | Cola de acciones por sala (3.2) |
| Mensajes duplicados o perdidos | `idPedido` idempotente, `seq` y fotos del estado (4.1, 4.7) |
| Jugador que traba la mesa | Temporizadores y piloto automático en el servidor (4.9) |
| Errores difíciles de reproducir | Semilla guardada y registro de eventos (3.6) |
