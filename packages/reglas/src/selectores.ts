import { forbiddenBet, validBets } from './apuestas';
import { chipsRemaining as chipsLeft } from './bazas';
import { bettingOrder, playOrder } from './mesa';
import type { Card, GameState } from './tipos';

/** A quién le toca actuar. Se deriva del estado, no se guarda por separado. */
export type Turn = { kind: 'bet'; seat: number } | { kind: 'card'; seat: number };

export function currentTurn(state: GameState): Turn | null {
  const n = state.players.length;
  if (state.phase === 'BETTING' && state.dealerSeat !== null) {
    const made = state.bets.filter((bet) => bet !== null).length;
    const seat = bettingOrder(state.dealerSeat, n)[made];
    return seat === undefined ? null : { kind: 'bet', seat };
  }
  if (state.phase === 'PLAYING' && state.currentTrick) {
    const seat = playOrder(state.currentTrick.leadSeat, n)[state.currentTrick.plays.length];
    return seat === undefined ? null : { kind: 'card', seat };
  }
  return null;
}

export function seatOfPlayer(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

export function isLastBettor(state: GameState, seat: number): boolean {
  return state.dealerSeat === seat;
}

/** Apuestas ya realizadas, en orden de asiento. */
export function betsMade(state: GameState): number[] {
  return state.bets.filter((bet): bet is number => bet !== null);
}

/** Valor que el Pié no puede apostar (null si no hay restricción efectiva). */
export function forbiddenBetFor(state: GameState, seat: number): number | null {
  if (!isLastBettor(state, seat)) return null;
  return forbiddenBet(state.cardsPerPlayer, betsMade(state));
}

/** Apuestas que el jugador puede hacer ahora (para habilitar botones). */
export function validBetsFor(state: GameState, seat: number): number[] {
  return validBets(state.cardsPerPlayer, isLastBettor(state, seat), betsMade(state));
}

/** Cartas jugables: cualquiera de la mano (no hay obligación de seguir palo). */
export function playableCards(state: GameState, seat: number): Card[] {
  return state.hands[seat] ?? [];
}

export function chipsRemainingFor(state: GameState, seat: number): number {
  const bet = state.bets[seat];
  if (bet === null || bet === undefined) return 0;
  return chipsLeft(bet, state.tricksWon[seat] ?? 0);
}

export function totalScores(state: GameState): number[] {
  return state.roundScores.map((scores) => scores.reduce((acc, points) => acc + points, 0));
}
