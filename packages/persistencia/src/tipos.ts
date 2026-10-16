/**
 * Tipos y contrato del repositorio de historial (DP-21).
 *
 * Lo que se guarda: cada juego (con sus jugadores), el puntaje de cada
 * partida, el ranking final y el registro de eventos del motor para
 * auditoría. No hay ranking global ni datos de salas en curso.
 */
import type { GameConfig, GameEvent, RankingEntry, RoundResult } from '@tokinoto/reglas';

export type EstadoJuegoGuardado = 'EN_CURSO' | 'TERMINADO' | 'ABORTADO';

export interface JugadorGuardado {
  asiento: number;
  idJugador: string;
  nombre: string;
}

export interface DatosJuego {
  /** Identificador único del juego (lo genera el servidor al empezarlo). */
  id: string;
  sala: string;
  jugadores: readonly { idJugador: string; nombre: string }[];
  config: GameConfig;
  iniciadoEn: Date;
}

export interface EventoGuardado {
  /** Orden del evento dentro del juego, desde 0 y sin saltos. */
  seq: number;
  evento: GameEvent;
}

export interface PuntajeGuardado {
  partida: number;
  asiento: number;
  apuesta: number;
  bazasGanadas: number;
  puntos: number;
}

export interface PuestoGuardado {
  asiento: number;
  total: number;
  puesto: number;
}

export interface ResumenJuego {
  id: string;
  sala: string;
  estado: EstadoJuegoGuardado;
  motivoAborto: string | null;
  totalPartidas: number;
  cantidadJugadores: number;
  iniciadoEn: Date;
  terminadoEn: Date | null;
}

export interface JuegoGuardado extends ResumenJuego {
  config: GameConfig;
  jugadores: JugadorGuardado[];
  /** Ordenados por partida y asiento. */
  puntajes: PuntajeGuardado[];
  /** Ordenado por puesto y asiento; vacío si el juego no terminó. */
  ranking: PuestoGuardado[];
}

export interface Repositorio {
  /** Registra la sala (si no existía) y el juego nuevo. Es idempotente. */
  abrirJuego(datos: DatosJuego): Promise<void>;
  /**
   * Agrega eventos al registro del juego. También guarda, a partir de ellos,
   * los puntajes de cada partida, el ranking y el cierre del juego. Es
   * idempotente: repetir el mismo lote (un reintento) no duplica nada.
   */
  agregarEventos(juegoId: string, eventos: readonly EventoGuardado[], cuando: Date): Promise<void>;
  /**
   * Cierra como abortados los juegos que quedaron EN_CURSO (por un reinicio
   * del servidor). Devuelve cuántos eran.
   */
  abortarEnCurso(motivo: string, cuando: Date): Promise<number>;
  /** Juegos más recientes primero. */
  listarJuegos(opciones?: { sala?: string; limite?: number }): Promise<ResumenJuego[]>;
  obtenerJuego(id: string): Promise<JuegoGuardado | null>;
  /** Registro completo del juego, ordenado por `seq`. */
  eventosDe(juegoId: string): Promise<EventoGuardado[]>;
  cerrar(): Promise<void>;
}

/** Lo que dejan guardado los eventos de un juego, además del registro mismo. */
export interface EfectosDeEvento {
  puntajes: PuntajeGuardado[];
  ranking: PuestoGuardado[];
  cierre: { estado: 'TERMINADO' | 'ABORTADO'; motivo: string | null } | null;
}

export function efectosDeEvento(evento: GameEvent): EfectosDeEvento {
  const vacio: EfectosDeEvento = { puntajes: [], ranking: [], cierre: null };
  switch (evento.type) {
    case 'PARTIDA_PUNTUADA':
      return { ...vacio, puntajes: evento.results.map((r) => puntajeDe(evento.roundNumber, r)) };
    case 'JUEGO_TERMINADO':
      return { ...vacio, ranking: evento.ranking.map(puestoDe), cierre: { estado: 'TERMINADO', motivo: null } };
    case 'JUEGO_ABORTADO':
      return { ...vacio, cierre: { estado: 'ABORTADO', motivo: evento.reason } };
    default:
      return vacio;
  }
}

function puntajeDe(partida: number, r: RoundResult): PuntajeGuardado {
  return { partida, asiento: r.seat, apuesta: r.bet, bazasGanadas: r.tricksWon, puntos: r.points };
}

function puestoDe(r: RankingEntry): PuestoGuardado {
  return { asiento: r.seat, total: r.total, puesto: r.position };
}
