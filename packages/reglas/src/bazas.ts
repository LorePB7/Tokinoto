import type { Play } from './tipos';

/**
 * Ganador de una baza. Reglas oficiales:
 *  1. Gana la carta más alta (2 baja, As alta).
 *  2. El Comodín (valor 15) le gana a todas, incluido el As.
 *  3. En empate de valor gana quien la tiró primero.
 *  4. Una carta baja no gana por ser del Mano.
 *
 * Las tiradas deben venir en orden de turno (la primera es la del Mano).
 * Una tirada solo reemplaza al ganador provisorio si es ESTRICTAMENTE mayor,
 * por eso el empate lo conserva quien tiró primero.
 */
export function determineTrickWinner(plays: readonly Play[]): Play {
  const first = plays[0];
  if (!first) throw new Error('No se puede determinar el ganador de una baza sin tiradas');
  let winner = first;
  for (const play of plays.slice(1)) {
    if (play.card.rank > winner.card.rank) winner = play;
  }
  return winner;
}

/**
 * Ficha sobre el montón: sí mientras la cantidad de bazas ganadas
 * (incluida la actual) no supere la apuesta.
 */
export function hasChip(tricksWonIncludingThis: number, bet: number): boolean {
  return tricksWonIncludingThis <= bet;
}

/** Fichas que le quedan a un jugador: apostadas y todavía no "gastadas". */
export function chipsRemaining(bet: number, tricksWon: number): number {
  return Math.max(0, bet - tricksWon);
}
