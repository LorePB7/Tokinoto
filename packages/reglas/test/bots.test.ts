import { describe, expect, it } from 'vitest';
import {
  apply,
  botChoice,
  buildDeck,
  BOT_LEVELS,
  checkInvariants,
  createSeededRng,
  currentTurn,
  forbiddenBetFor,
  getCardById,
  shuffle,
  validBetsFor,
  type BotLevel,
  type Card,
  type GameState,
} from '../src/index';
import { newGame } from './ayudas';

/** Juega un juego completo con bots en todos los asientos. */
function botGame(
  levels: readonly BotLevel[],
  seed: number,
  onDecision?: (state: GameState, seat: number, level: BotLevel) => void,
): GameState {
  const engine = createSeededRng(seed);
  const bots = createSeededRng(seed ^ 0x5bd1e995);
  let state = newGame(levels.length);
  const run = (action: Parameters<typeof apply>[1]): void => {
    const result = apply(state, action, engine);
    if (!result.ok) throw new Error(`${action.type} rechazada: ${result.error.code} - ${result.error.message}`);
    state = result.state;
    const problems = checkInvariants(state);
    if (problems.length > 0) throw new Error(problems.join('; '));
  };
  run({ type: 'INICIAR_JUEGO' });
  for (let steps = 0; state.phase !== 'FINISHED'; steps++) {
    if (steps > 5000) throw new Error('El juego no termina');
    if (state.phase === 'DEALER_DRAW') run({ type: 'SORTEAR_REPARTIDOR' });
    else if (state.phase === 'TRICK_RESOLUTION' || state.phase === 'ROUND_SUMMARY') run({ type: 'AVANZAR' });
    else {
      const turn = currentTurn(state);
      if (!turn) throw new Error(`Sin turno en ${state.phase}`);
      const level = levels[turn.seat] as BotLevel;
      onDecision?.(state, turn.seat, level);
      const choice = botChoice(state, turn.seat, level, bots);
      const playerId = state.players[turn.seat]?.id ?? '';
      if (choice?.type === 'APOSTAR') {
        expect(validBetsFor(state, turn.seat)).toContain(choice.value);
        expect(choice.value).not.toBe(forbiddenBetFor(state, turn.seat));
        run({ type: 'APOSTAR', playerId, value: choice.value });
      } else if (choice?.type === 'JUGAR_CARTA') {
        expect(state.hands[turn.seat]?.some((c) => c.id === choice.cardId)).toBe(true);
        run({ type: 'JUGAR_CARTA', playerId, cardId: choice.cardId });
      } else throw new Error(`El bot no decidió en ${state.phase}`);
    }
  }
  return state;
}

/**
 * Mismo estado, pero con las cartas que el bot NO ve repartidas de otra
 * forma entre los rivales (manos ajenas, mazo sobrante y cartas no
 * ganadoras de bazas cerradas).
 */
function reshuffleHidden(state: GameState, seat: number, seed: number): GameState {
  const visible = new Set<string>([
    ...(state.hands[seat] ?? []).map((c) => c.id),
    ...(state.currentTrick?.plays ?? []).map((p) => p.card.id),
    ...state.wonTricks.map((t) => t.winningCard.id),
  ]);
  const pool = shuffle(
    buildDeck().filter((c) => !visible.has(c.id)),
    createSeededRng(seed),
  );
  let index = 0;
  const hands = state.hands.map((hand, s) => {
    if (s === seat) return hand;
    const next = pool.slice(index, index + hand.length);
    index += hand.length;
    return next;
  });
  return { ...state, hands };
}

const mixes: BotLevel[][] = [
  ['facil', 'medio', 'dificil', 'medio'],
  ['dificil', 'facil', 'medio', 'facil', 'dificil'],
  ['medio', 'medio', 'facil', 'dificil', 'facil', 'medio'],
  ['facil', 'dificil', 'medio', 'facil', 'medio', 'dificil', 'facil'],
];

describe('bots', () => {
  it('siempre juegan legal: nunca una carta ajena ni la apuesta prohibida del Pié', () => {
    // 4 a 7 jugadores fáciles y medios: 250 juegos (3500 partidas).
    for (let i = 0; i < 250; i++) {
      const players = 4 + (i % 4);
      const levels = Array.from({ length: players }, (_, s) => (s + i) % 2 === 0 ? 'facil' : 'medio') as BotLevel[];
      const final = botGame(levels, 1000 + i);
      expect(final.phase).toBe('FINISHED');
    }
  }, 60_000);

  it('el difícil también juega legal, con 4 a 7 jugadores', () => {
    mixes.forEach((levels, i) => {
      for (let g = 0; g < 2; g++) expect(botGame(levels, 50 + 10 * i + g).phase).toBe('FINISHED');
    });
  }, 60_000);

  it('no mira: su decisión no cambia si se reparten distinto las cartas que no ve', () => {
    let checked = 0;
    mixes.forEach((levels, i) => {
      botGame(levels, 900 + i, (state, seat, level) => {
        for (let k = 0; k < 2; k++) {
          const other = reshuffleHidden(state, seat, 31 * checked + k);
          const a = botChoice(state, seat, level, createSeededRng(checked));
          const b = botChoice(other, seat, level, createSeededRng(checked));
          expect(b).toEqual(a);
        }
        checked++;
      });
    });
    expect(checked).toBeGreaterThan(1000);
  }, 60_000);

  it('expone los tres niveles', () => {
    expect(BOT_LEVELS).toEqual(['facil', 'medio', 'dificil']);
  });

  describe('medio', () => {
    /** Estado de PLAYING armado a mano: el bot en el asiento 0. */
    function playing(hand: string[], plays: string[], bet: number, won: number): GameState {
      const base = newGame(4);
      const cards = (ids: string[]): Card[] => ids.map((id) => getCardById(id) as Card);
      const lead = (4 - plays.length) % 4;
      return {
        ...base,
        phase: 'PLAYING',
        roundNumber: 5,
        cardsPerPlayer: 5,
        dealerSeat: (lead + 3) % 4,
        leadSeat: lead,
        hands: [cards(hand), [], [], []],
        bets: [bet, 1, 1, 1],
        tricksWon: [won, 0, 0, 0],
        currentTrick: {
          number: 6 - hand.length,
          leadSeat: lead,
          plays: plays.map((id, i) => ({ seat: (lead + i) % 4, card: getCardById(id) as Card })),
          winnerSeat: null,
        },
      };
    }
    const rng = createSeededRng(1);
    const card = (s: GameState): string => {
      const c = botChoice(s, 0, 'medio', rng);
      return c?.type === 'JUGAR_CARTA' ? c.cardId : '';
    };

    it('si ya cumplió, descarta la carta más alta que no gana', () => {
      expect(card(playing(['J-picas', 'Q-picas', '3-picas'], ['K-corazones'], 1, 1))).toBe('Q-picas');
    });

    it('un empate de valor no le gana al que tiró primero: lo usa para descartar', () => {
      expect(card(playing(['J-picas', '4-picas'], ['J-corazones', '2-picas'], 0, 0))).toBe('J-picas');
    });

    it('si es el último y le falta una baza, gana con la carta justa', () => {
      expect(card(playing(['A-picas', '9-picas', '3-picas'], ['8-picas', '5-picas', '2-picas'], 2, 0))).toBe(
        '9-picas',
      );
    });

    it('si le faltan todas, abre con la más alta', () => {
      expect(card(playing(['COMODIN', '9-picas'], [], 2, 0))).toBe('COMODIN');
    });
  });
});
