import { buildDeck, cardValue } from './cartas';
import { shuffle, type Rng } from './rng';
import type { DrawEntry, DrawRound } from './tipos';

const MAX_DRAW_ROUNDS = 1000;

/** Asientos que sacaron el valor más alto en una vuelta del sorteo. */
export function highestDrawers(draws: readonly DrawEntry[]): number[] {
  let max = -Infinity;
  for (const draw of draws) max = Math.max(max, cardValue(draw.card));
  return draws.filter((draw) => cardValue(draw.card) === max).map((draw) => draw.seat);
}

/**
 * Sorteo inicial del primer repartidor: cada jugador saca una carta al azar
 * y empieza repartiendo quien tenga el valor más alto (el Comodín es el más
 * alto). Si hay empate, solo los empatados vuelven a sacar, las veces que
 * haga falta. Las cartas vuelven al mazo entre vueltas.
 */
export function drawForDealer(
  playerCount: number,
  rng: Rng,
): { rounds: DrawRound[]; dealerSeat: number } {
  const rounds: DrawRound[] = [];
  let contenders = Array.from({ length: playerCount }, (_, seat) => seat);

  for (let attempt = 0; attempt < MAX_DRAW_ROUNDS; attempt++) {
    const deck = shuffle(buildDeck(), rng);
    const draws: DrawEntry[] = contenders.map((seat, index) => ({
      seat,
      card: deck[index] as DrawEntry['card'],
    }));
    rounds.push({ draws });
    const top = highestDrawers(draws);
    if (top.length === 1) return { rounds, dealerSeat: top[0] as number };
    contenders = top;
  }
  throw new Error('El sorteo del repartidor no se resolvió (fuente de azar defectuosa)');
}
