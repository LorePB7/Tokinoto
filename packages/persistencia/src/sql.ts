/**
 * Repositorio sobre PostgreSQL (Drizzle). Sirve igual para el driver `pg`
 * (producción) y para PGlite (pruebas): solo cambia cómo se abre la conexión.
 */
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { GameConfig, GameEvent } from '@tokinoto/reglas';
import * as esquema from './esquema';
import {
  efectosDeEvento,
  type DatosJuego,
  type EstadoJuegoGuardado,
  type EventoGuardado,
  type JuegoGuardado,
  type Repositorio,
  type ResumenJuego,
} from './tipos';

export type BaseDeDatos = PgDatabase<PgQueryResultHKT, typeof esquema>;

const { salas, juegos, jugadoresDeJuego, puntajesDePartida, rankingFinal, eventos } = esquema;

export function crearRepositorioSql(bd: BaseDeDatos, cerrarConexion: () => Promise<void>): Repositorio {
  return {
    async abrirJuego(datos: DatosJuego) {
      await bd.transaction(async (tx) => {
        await tx.insert(salas).values({ codigo: datos.sala, creadaEn: datos.iniciadoEn }).onConflictDoNothing();
        await tx
          .insert(juegos)
          .values({
            id: datos.id,
            salaCodigo: datos.sala,
            estado: 'EN_CURSO',
            config: datos.config,
            totalPartidas: datos.config.cardsPerRound.length,
            iniciadoEn: datos.iniciadoEn,
          })
          .onConflictDoNothing();
        await tx
          .insert(jugadoresDeJuego)
          .values(datos.jugadores.map((j, asiento) => ({ juegoId: datos.id, asiento, idJugador: j.idJugador, nombre: j.nombre })))
          .onConflictDoNothing();
      });
    },

    async agregarEventos(juegoId, lote, cuando) {
      if (lote.length === 0) return;
      await bd.transaction(async (tx) => {
        await tx
          .insert(eventos)
          .values(lote.map(({ seq, evento }) => ({ juegoId, seq, tipo: evento.type, datos: evento })))
          .onConflictDoNothing();
        for (const { evento } of lote) {
          const efectos = efectosDeEvento(evento);
          if (efectos.puntajes.length > 0) {
            await tx
              .insert(puntajesDePartida)
              .values(efectos.puntajes.map((p) => ({ juegoId, ...p })))
              .onConflictDoNothing();
          }
          if (efectos.ranking.length > 0) {
            await tx
              .insert(rankingFinal)
              .values(efectos.ranking.map((r) => ({ juegoId, ...r })))
              .onConflictDoNothing();
          }
          if (efectos.cierre) {
            await tx
              .update(juegos)
              .set({ estado: efectos.cierre.estado, motivoAborto: efectos.cierre.motivo, terminadoEn: cuando })
              .where(and(eq(juegos.id, juegoId), eq(juegos.estado, 'EN_CURSO')));
          }
        }
      });
    },

    async abortarEnCurso(motivo, cuando) {
      return bd.transaction(async (tx) => {
        const abiertos = await tx.select({ id: juegos.id }).from(juegos).where(eq(juegos.estado, 'EN_CURSO'));
        for (const { id } of abiertos) {
          const [ultimo] = await tx
            .select({ maximo: sql<number | null>`max(${eventos.seq})` })
            .from(eventos)
            .where(eq(eventos.juegoId, id));
          const evento: GameEvent = { type: 'JUEGO_ABORTADO', reason: motivo };
          await tx.insert(eventos).values({ juegoId: id, seq: (ultimo?.maximo ?? -1) + 1, tipo: evento.type, datos: evento });
          await tx.update(juegos).set({ estado: 'ABORTADO', motivoAborto: motivo, terminadoEn: cuando }).where(eq(juegos.id, id));
        }
        return abiertos.length;
      });
    },

    async listarJuegos(opciones = {}) {
      const filas = await bd
        .select({
          id: juegos.id,
          sala: juegos.salaCodigo,
          estado: juegos.estado,
          motivoAborto: juegos.motivoAborto,
          totalPartidas: juegos.totalPartidas,
          iniciadoEn: juegos.iniciadoEn,
          terminadoEn: juegos.terminadoEn,
          cantidadJugadores: count(jugadoresDeJuego.asiento),
        })
        .from(juegos)
        .leftJoin(jugadoresDeJuego, eq(jugadoresDeJuego.juegoId, juegos.id))
        .where(opciones.sala === undefined ? undefined : eq(juegos.salaCodigo, opciones.sala))
        .groupBy(juegos.id)
        .orderBy(desc(juegos.iniciadoEn), desc(juegos.id))
        .limit(opciones.limite ?? 50);
      return filas.map((f): ResumenJuego => ({ ...f, estado: f.estado as EstadoJuegoGuardado }));
    },

    async obtenerJuego(id) {
      const [juego] = await bd.select().from(juegos).where(eq(juegos.id, id));
      if (!juego) return null;
      const jugadores = await bd.select().from(jugadoresDeJuego).where(eq(jugadoresDeJuego.juegoId, id)).orderBy(asc(jugadoresDeJuego.asiento));
      const puntajes = await bd
        .select()
        .from(puntajesDePartida)
        .where(eq(puntajesDePartida.juegoId, id))
        .orderBy(asc(puntajesDePartida.partida), asc(puntajesDePartida.asiento));
      const ranking = await bd.select().from(rankingFinal).where(eq(rankingFinal.juegoId, id)).orderBy(asc(rankingFinal.puesto), asc(rankingFinal.asiento));
      return {
        id: juego.id,
        sala: juego.salaCodigo,
        estado: juego.estado as EstadoJuegoGuardado,
        motivoAborto: juego.motivoAborto,
        config: juego.config as GameConfig,
        totalPartidas: juego.totalPartidas,
        cantidadJugadores: jugadores.length,
        iniciadoEn: juego.iniciadoEn,
        terminadoEn: juego.terminadoEn,
        jugadores: jugadores.map(({ asiento, idJugador, nombre }) => ({ asiento, idJugador, nombre })),
        puntajes: puntajes.map(({ partida, asiento, apuesta, bazasGanadas, puntos }) => ({ partida, asiento, apuesta, bazasGanadas, puntos })),
        ranking: ranking.map(({ asiento, total, puesto }) => ({ asiento, total, puesto })),
      } satisfies JuegoGuardado;
    },

    async eventosDe(juegoId) {
      const filas = await bd.select().from(eventos).where(eq(eventos.juegoId, juegoId)).orderBy(asc(eventos.seq));
      return filas.map((f): EventoGuardado => ({ seq: f.seq, evento: f.datos as GameEvent }));
    },

    cerrar: cerrarConexion,
  };
}
