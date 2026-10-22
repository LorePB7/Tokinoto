/**
 * Esquema de la base de datos (docs/diseno-tecnico.md, 3.6 y DP-21).
 *
 * Solo se guardan juegos: el estado de las salas en curso vive en memoria.
 * Todo lo que sale de acá es histórico y de auditoría; no hay ranking global.
 *
 * 🔵 `eventos` guarda los eventos del motor de reglas (incluidas las manos
 * repartidas). Con ellos se reconstruye el juego completo sin necesidad de
 * guardar una semilla. Esa tabla es PRIVADA: nunca se envía a los clientes.
 */
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Cuentas de Google (fase 6, DP-16). Se identifica a la persona por el `sub`
 * de Google, nunca por el email, que no se guarda. Los invitados no tienen fila.
 */
export const cuentas = pgTable('cuentas', {
  /** UUID interno. */
  id: text('id').primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  /** Nombre visible, editable por la persona (hasta 20 caracteres). */
  nombre: text('nombre').notNull(),
  creadaEn: timestamp('creada_en', { withTimezone: true }).notNull(),
});

export const salas = pgTable('salas', {
  codigo: text('codigo').primaryKey(),
  creadaEn: timestamp('creada_en', { withTimezone: true }).notNull(),
});

export const juegos = pgTable(
  'juegos',
  {
    /** UUID generado por el servidor al empezar el juego. */
    id: text('id').primaryKey(),
    salaCodigo: text('sala_codigo')
      .notNull()
      .references(() => salas.codigo),
    /** 'EN_CURSO' | 'TERMINADO' | 'ABORTADO'. */
    estado: text('estado').notNull(),
    motivoAborto: text('motivo_aborto'),
    /** Configuración con la que se creó el juego (hace falta para reconstruirlo). */
    config: jsonb('config').notNull(),
    totalPartidas: integer('total_partidas').notNull(),
    iniciadoEn: timestamp('iniciado_en', { withTimezone: true }).notNull(),
    terminadoEn: timestamp('terminado_en', { withTimezone: true }),
  },
  (tabla) => [index('juegos_sala_idx').on(tabla.salaCodigo, tabla.iniciadoEn)],
);

export const jugadoresDeJuego = pgTable(
  'jugadores_de_juego',
  {
    juegoId: text('juego_id')
      .notNull()
      .references(() => juegos.id),
    asiento: integer('asiento').notNull(),
    idJugador: text('id_jugador').notNull(),
    nombre: text('nombre').notNull(),
    /** Cuenta de Google del jugador (DP-21). Vacía en juegos viejos y en invitados. */
    cuentaId: text('cuenta_id').references(() => cuentas.id),
    /** Jugó como invitado: sin cuenta y sin historial propio. */
    invitado: boolean('invitado').notNull().default(false),
  },
  (tabla) => [primaryKey({ columns: [tabla.juegoId, tabla.asiento] }), index('jugadores_cuenta_idx').on(tabla.cuentaId)],
);

export const puntajesDePartida = pgTable(
  'puntajes_de_partida',
  {
    juegoId: text('juego_id')
      .notNull()
      .references(() => juegos.id),
    partida: integer('partida').notNull(),
    asiento: integer('asiento').notNull(),
    apuesta: integer('apuesta').notNull(),
    bazasGanadas: integer('bazas_ganadas').notNull(),
    puntos: integer('puntos').notNull(),
  },
  (tabla) => [primaryKey({ columns: [tabla.juegoId, tabla.partida, tabla.asiento] })],
);

export const rankingFinal = pgTable(
  'ranking_final',
  {
    juegoId: text('juego_id')
      .notNull()
      .references(() => juegos.id),
    asiento: integer('asiento').notNull(),
    total: integer('total').notNull(),
    /** Puesto con empates: los empatados comparten puesto. */
    puesto: integer('puesto').notNull(),
  },
  (tabla) => [primaryKey({ columns: [tabla.juegoId, tabla.asiento] })],
);

export const eventos = pgTable(
  'eventos',
  {
    juegoId: text('juego_id')
      .notNull()
      .references(() => juegos.id),
    /** Orden del evento dentro del juego (0, 1, 2, ...). */
    seq: integer('seq').notNull(),
    tipo: text('tipo').notNull(),
    datos: jsonb('datos').notNull(),
  },
  (tabla) => [primaryKey({ columns: [tabla.juegoId, tabla.seq] })],
);
