import type { GameConfig } from './tipos';

/** Cartas por jugador en cada una de las 14 partidas (regla oficial). */
export const CARDS_PER_ROUND: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1];

/** Puntos base por acierto exacto: se suma la apuesta (regla oficial). */
export const BASE_POINTS = 5;

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 7;

export const DEFAULT_CONFIG: GameConfig = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  cardsPerRound: CARDS_PER_ROUND,
  basePoints: BASE_POINTS,
};
