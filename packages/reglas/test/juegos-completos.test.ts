import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_ROUND,
  initialLead,
  nextDealer,
  replay,
  totalScores,
  winnersOf,
  type GameEvent,
} from '../src/index';
import { assertNoProblems, runRandomGame } from './ayudas';

function eventsOfType<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
}

describe('juegos completos con jugadas al azar (siempre legales)', () => {
  it('cumple todos los invariantes en cada paso y termina con ranking', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 7 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (players, seed) => {
        const { final, events } = runRandomGame(players, seed, (state) => assertNoProblems(state));

        expect(final.phase).toBe('FINISHED');
        expect(final.roundScores.every((scores) => scores.length === 14)).toBe(true);
        expect(eventsOfType(events, 'PARTIDA_PUNTUADA')).toHaveLength(14);
        expect(eventsOfType(events, 'BAZA_RESUELTA')).toHaveLength(56);
        expect(eventsOfType(events, 'CARTA_JUGADA')).toHaveLength(56 * players);
        expect(eventsOfType(events, 'APUESTA_REALIZADA')).toHaveLength(14 * players);

        // Ranking consistente con los puntajes y con al menos un ganador.
        const ranking = final.ranking!;
        const totals = totalScores(final);
        expect(ranking).toHaveLength(players);
        for (const entry of ranking) expect(entry.total).toBe(totals[entry.seat]);
        expect(Math.max(...totals)).toBe(winnersOf(ranking)[0]!.total);
        expect(winnersOf(ranking).length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 60 },
    );
  });

  it('reparte, rota repartidor y Mano como indica el reglamento en las 14 partidas', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 7 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (players, seed) => {
        const { events } = runRandomGame(players, seed);
        const starts = eventsOfType(events, 'PARTIDA_INICIADA');
        expect(starts.map((start) => start.cardsPerPlayer)).toEqual([...CARDS_PER_ROUND]);
        starts.forEach((start, index) => {
          expect(start.roundNumber).toBe(index + 1);
          expect(start.leadSeat).toBe(initialLead(start.dealerSeat, players));
          if (index > 0) expect(start.dealerSeat).toBe(nextDealer(starts[index - 1]!.dealerSeat, players));
          // Cartas repartidas únicas.
          const ids = start.hands.flat().map((card) => card.id);
          expect(new Set(ids).size).toBe(ids.length);
          expect(start.hands.every((hand) => hand.length === start.cardsPerPlayer)).toBe(true);
        });
      }),
      { numRuns: 40 },
    );
  });

  it('la suma de apuestas nunca es igual a N y siempre hay al menos un jugador con 0 puntos', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 7 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (players, seed) => {
        const { events } = runRandomGame(players, seed);
        for (const scored of eventsOfType(events, 'PARTIDA_PUNTUADA')) {
          const cards = CARDS_PER_ROUND[scored.roundNumber - 1]!;
          const betSum = scored.results.reduce((acc, r) => acc + r.bet, 0);
          const wonSum = scored.results.reduce((acc, r) => acc + r.tricksWon, 0);
          expect(betSum).not.toBe(cards);
          expect(wonSum).toBe(cards);
          expect(scored.results.some((r) => r.points === 0)).toBe(true);
          for (const r of scored.results) {
            expect(r.points).toBeLessThanOrEqual(5 + cards);
            expect(r.points).toBe(r.bet === r.tricksWon ? 5 + r.bet : 0);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('el ganador de cada baza abre la siguiente; cada partida empieza con el Mano inicial', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 7 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (players, seed) => {
        const { events } = runRandomGame(players, seed);
        let previousWinner: number | null = null;
        let tricks = 0;
        for (const event of events) {
          if (event.type === 'PARTIDA_INICIADA') previousWinner = null;
          if (event.type === 'BAZA_RESUELTA') previousWinner = event.winnerSeat;
          if (event.type === 'BAZA_INICIADA' && event.trickNumber > 1) {
            expect(event.leadSeat).toBe(previousWinner);
            tricks++;
          }
        }
        // 56 bazas en total, 14 de ellas son la primera de su partida.
        expect(tricks).toBe(56 - 14);
      }),
      { numRuns: 40 },
    );
  });

  it('el estado se reconstruye exactamente aplicando los eventos en orden', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 7 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (players, seed) => {
        const { initial, final, events } = runRandomGame(players, seed);
        expect(replay(initial, events)).toEqual(final);
      }),
      { numRuns: 30 },
    );
  });

  it('con la misma semilla el juego es idéntico; con otra, distinto', () => {
    const a = runRandomGame(5, 2024);
    const b = runRandomGame(5, 2024);
    const c = runRandomGame(5, 2025);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(JSON.stringify(c.events)).not.toBe(JSON.stringify(a.events));
  });

  it('cada jugador termina con puntaje total no negativo', () => {
    for (let seed = 0; seed < 25; seed++) {
      const { final } = runRandomGame(4 + (seed % 4), seed);
      for (const total of totalScores(final)) expect(total).toBeGreaterThanOrEqual(0);
    }
  });
});
