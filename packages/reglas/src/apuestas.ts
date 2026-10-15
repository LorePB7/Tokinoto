import type { ErrorCode } from './tipos';

/**
 * Valor prohibido para el Pié: el que haría que la suma de todas las
 * apuestas sea igual a N (cantidad de cartas de la partida). Devuelve null
 * si no hay restricción efectiva (la suma previa ya supera N).
 */
export function forbiddenBet(cardsPerPlayer: number, previousBets: readonly number[]): number | null {
  const previousSum = previousBets.reduce((acc, bet) => acc + bet, 0);
  const forbidden = cardsPerPlayer - previousSum;
  return forbidden >= 0 && forbidden <= cardsPerPlayer ? forbidden : null;
}

/** Apuestas permitidas (0..N), excluyendo el valor prohibido si es el Pié. */
export function validBets(
  cardsPerPlayer: number,
  isLast: boolean,
  previousBets: readonly number[],
): number[] {
  const forbidden = isLast ? forbiddenBet(cardsPerPlayer, previousBets) : null;
  const values: number[] = [];
  for (let value = 0; value <= cardsPerPlayer; value++) {
    if (value !== forbidden) values.push(value);
  }
  return values;
}

/** Valida una apuesta. Devuelve el código de error, o null si es válida. */
export function validateBet(
  cardsPerPlayer: number,
  value: number,
  isLast: boolean,
  previousBets: readonly number[],
): ErrorCode | null {
  if (!Number.isInteger(value) || value < 0 || value > cardsPerPlayer) {
    return 'APUESTA_FUERA_DE_RANGO';
  }
  if (isLast && value === forbiddenBet(cardsPerPlayer, previousBets)) {
    return 'APUESTA_PROHIBIDA_PIE';
  }
  return null;
}
