/**
 * Tipos del motor de reglas de Tokinoto.
 *
 * Vocabulario aprobado (ver docs/especificacion-tecnica.md, sección 1):
 *  - Game  = el juego completo (14 partidas)
 *  - Round = una partida con N cartas por jugador
 *  - Trick = baza ("mano" que se gana y que se apuesta)
 *  - Lead  = "Mano": el jugador que abre la baza
 *  - Last  = "Pié": el último en apostar (siempre es el repartidor)
 *  - Dealer = repartidor
 *
 * Convención de mesa: los jugadores se identifican por su número de asiento
 * (0..n-1). "A la derecha" de un asiento es SIEMPRE el asiento siguiente,
 * en orden circular. Apuestas, tiradas y reparto giran en ese sentido.
 */

export type Suit = 'picas' | 'corazones' | 'diamantes' | 'treboles';

export interface Card {
  /** Identificador único e inmutable. Ej: "K-picas", "10-corazones", "COMODIN". */
  readonly id: string;
  /** Valor para comparar: 2..10, J=11, Q=12, K=13, A=14, Comodín=15. */
  readonly rank: number;
  /** Los palos son indiferentes para el juego; el Comodín no tiene palo. */
  readonly suit: Suit | null;
  readonly isJoker: boolean;
}

export interface Play {
  seat: number;
  card: Card;
}

export interface DrawEntry {
  seat: number;
  card: Card;
}

/** Una vuelta del sorteo inicial del repartidor. */
export interface DrawRound {
  draws: DrawEntry[];
}

export interface PlayerInfo {
  id: string;
  name: string;
}

/** Resumen público de una baza ya ganada (carta ganadora y quién la ganó). */
export interface WonTrick {
  trickNumber: number;
  winnerSeat: number;
  winningCard: Card;
  /** Ficha sobre el montón: sí mientras el ganador no superó su apuesta. */
  hasChip: boolean;
}

export interface TrickState {
  number: number;
  leadSeat: number;
  plays: Play[];
  winnerSeat: number | null;
}

export interface RoundResult {
  seat: number;
  bet: number;
  tricksWon: number;
  points: number;
}

export interface RankingEntry {
  seat: number;
  total: number;
  /** Puesto con empates: los empatados comparten puesto (podio compartido). */
  position: number;
}

/**
 * Estados del juego. LOBBY y la sala viven en el servidor; el motor arranca
 * cuando ya hay entre 4 y 7 jugadores. ROUND_SETUP y ROUND_SCORING son
 * transitorios: ocurren dentro de una misma transición y no se observan.
 */
export type Phase =
  | 'READY_TO_START'
  | 'DEALER_DRAW'
  | 'BETTING'
  | 'PLAYING'
  | 'TRICK_RESOLUTION'
  | 'ROUND_SUMMARY'
  | 'FINISHED'
  | 'ABORTED';

export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  /** Cartas por jugador en cada partida (14 valores). */
  cardsPerRound: readonly number[];
  /** Puntos base por acierto exacto (se suma la apuesta). */
  basePoints: number;
}

export interface GameState {
  config: GameConfig;
  players: PlayerInfo[];
  phase: Phase;
  /** 0 antes de empezar; luego 1..14. */
  roundNumber: number;
  /** N: cartas por jugador (= cantidad de bazas) de la partida en curso. */
  cardsPerPlayer: number;
  dealerSeat: number | null;
  /** Mano actual: quien abre la baza en curso (o la próxima). */
  leadSeat: number | null;
  /** PRIVADO: manos por asiento. Nunca se envía completa a los clientes. */
  hands: Card[][];
  /** null = todavía no apostó; 0 = apostó cero. */
  bets: (number | null)[];
  tricksWon: number[];
  currentTrick: TrickState | null;
  /** Bazas ya ganadas en la partida en curso. */
  wonTricks: WonTrick[];
  /** Puntos por partida: roundScores[asiento][indiceDePartida]. */
  roundScores: number[][];
  dealerDraw: DrawRound[];
  ranking: RankingEntry[] | null;
  abortReason: string | null;
}

/**
 * Acciones. Solo APOSTAR y JUGAR_CARTA pueden venir de un jugador; el resto
 * las dispara el servidor. El motor no distingue quién las envía: esa
 * restricción es responsabilidad del servidor.
 */
export type Action =
  | { type: 'INICIAR_JUEGO' }
  | { type: 'SORTEAR_REPARTIDOR' }
  | { type: 'APOSTAR'; playerId: string; value: number }
  | { type: 'JUGAR_CARTA'; playerId: string; cardId: string }
  | { type: 'AVANZAR' }
  | { type: 'PILOTO_AUTOMATICO'; playerId: string }
  | { type: 'ABORTAR_JUEGO'; reason: string };

/** Los eventos son el resultado principal: el estado se reconstruye con ellos. */
export type GameEvent =
  | { type: 'JUEGO_INICIADO' }
  | { type: 'SORTEO_RONDA'; draws: DrawEntry[] }
  | { type: 'REPARTIDOR_DEFINIDO'; dealerSeat: number }
  | {
      type: 'PARTIDA_INICIADA';
      roundNumber: number;
      cardsPerPlayer: number;
      dealerSeat: number;
      leadSeat: number;
      /** PRIVADO por asiento. */
      hands: Card[][];
    }
  | { type: 'APUESTA_REALIZADA'; seat: number; value: number; porPiloto?: true }
  | { type: 'BAZA_INICIADA'; trickNumber: number; leadSeat: number }
  | { type: 'CARTA_JUGADA'; seat: number; card: Card; porPiloto?: true }
  | {
      type: 'BAZA_RESUELTA';
      trickNumber: number;
      winnerSeat: number;
      winningCard: Card;
      hasChip: boolean;
    }
  | { type: 'PARTIDA_PUNTUADA'; roundNumber: number; results: RoundResult[] }
  | { type: 'JUEGO_TERMINADO'; ranking: RankingEntry[] }
  | { type: 'JUEGO_ABORTADO'; reason: string };

export type ErrorCode =
  | 'NO_ES_TU_TURNO'
  | 'ESTADO_INVALIDO'
  | 'APUESTA_FUERA_DE_RANGO'
  | 'APUESTA_PROHIBIDA_PIE'
  | 'APUESTA_YA_REALIZADA'
  | 'CARTA_NO_EN_MANO'
  | 'JUEGO_TERMINADO'
  | 'JUGADOR_DESCONOCIDO'
  | 'JUGADORES_DUPLICADOS'
  | 'CANTIDAD_JUGADORES_INVALIDA'
  | 'CONFIGURACION_INVALIDA';

export interface GameError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: GameError };

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: GameError };
