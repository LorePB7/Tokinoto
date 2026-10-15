import { validBetsFor } from './selectores';
import type { Card, GameState } from './tipos';

export type AutopilotChoice =
  | { type: 'APOSTAR'; value: number }
  | { type: 'JUGAR_CARTA'; cardId: string };

/** La carta de menor valor; a igualdad de valor, la de menor identificador. */
export function lowestCard(hand: readonly Card[]): Card | undefined {
  return [...hand].sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/**
 * Qué hace el piloto automático cuando le toca a `seat`. Es una salida de
 * emergencia, no una regla del juego:
 *  - apuesta: el menor valor válido (0, o el siguiente si 0 está prohibido)
 *  - carta: la de menor valor de su mano
 * Devuelve null si no es una fase de apuesta o de tirada.
 */
export function autopilotChoice(state: GameState, seat: number): AutopilotChoice | null {
  if (state.phase === 'BETTING') {
    const value = validBetsFor(state, seat)[0];
    return value === undefined ? null : { type: 'APOSTAR', value };
  }
  if (state.phase === 'PLAYING') {
    const card = lowestCard(state.hands[seat] ?? []);
    return card ? { type: 'JUGAR_CARTA', cardId: card.id } : null;
  }
  return null;
}
