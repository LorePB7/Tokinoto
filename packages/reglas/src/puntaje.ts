import { BASE_POINTS } from './config';

/**
 * Puntos de una partida para un jugador (evaluación estricta):
 *  - acierto exacto: puntos base + apuesta
 *  - cualquier otro caso: 0 (sin puntaje negativo ni parcial)
 */
export function roundPoints(bet: number, tricksWon: number, basePoints: number = BASE_POINTS): number {
  return bet === tricksWon ? basePoints + bet : 0;
}
