/**
 * Estrategia de los bots (fase 8).
 *
 * Regla de oro: un bot decide SOLO con lo que vería una persona sentada en
 * su asiento. `botView` arma esa vista a partir del estado (su mano, las
 * apuestas, las bazas ganadas, la baza en curso y, de las bazas cerradas,
 * solo la carta ganadora) y las estrategias reciben únicamente esa vista.
 * Nunca leen manos ajenas ni cartas no ganadoras de bazas cerradas.
 *
 * Niveles (lo que se promete es el orden de fuerza, medido con el simulador):
 *  - fácil:   apuesta contando cartas altas, con margen de error, y juega
 *             con poco criterio (alta si le faltan bazas, baja si no).
 *  - medio:   estima la probabilidad de ganar con cada carta, elige la
 *             apuesta que más puntos espera y juega para cumplirla.
 *  - difícil: además imagina muchas repartijas posibles de las cartas que
 *             no ve (solo las que no ve) y elige la apuesta o la carta que
 *             más veces cumple lo apostado.
 *
 * Los palos no importan: internamente se trabaja solo con valores (2..15).
 */
import { validBets } from './apuestas';
import { JOKER_VALUE } from './cartas';
import type { AutopilotChoice } from './piloto';
import { shuffle, type Rng } from './rng';
import { betsMade, isLastBettor } from './selectores';
import type { Card, GameState, Play } from './tipos';

export type BotLevel = 'facil' | 'medio' | 'dificil';
export const BOT_LEVELS: readonly BotLevel[] = ['facil', 'medio', 'dificil'];

/** Lo que el bot puede ver: lo mismo que una persona en su asiento. */
export interface BotView {
  seat: number;
  players: number;
  /** N: cartas por jugador de la partida. */
  cardsPerPlayer: number;
  dealerSeat: number;
  phase: 'BETTING' | 'PLAYING';
  /** Su propia mano (privada). */
  hand: readonly Card[];
  bets: readonly (number | null)[];
  tricksWon: readonly number[];
  /** Número de la baza en curso (1..N). */
  trickNumber: number;
  leadSeat: number;
  /** Cartas ya tiradas en la baza en curso, en orden. */
  currentPlays: readonly Play[];
  /** De las bazas cerradas: solo la carta ganadora y quién la ganó. */
  winningCards: readonly Card[];
}

/** Vista del bot sentado en `seat`, o null si no le toca decidir nada. */
export function botView(state: GameState, seat: number): BotView | null {
  if (state.phase !== 'BETTING' && state.phase !== 'PLAYING') return null;
  if (state.dealerSeat === null || state.leadSeat === null) return null;
  return {
    seat,
    players: state.players.length,
    cardsPerPlayer: state.cardsPerPlayer,
    dealerSeat: state.dealerSeat,
    phase: state.phase,
    hand: [...(state.hands[seat] ?? [])],
    bets: [...state.bets],
    tricksWon: [...state.tricksWon],
    trickNumber: state.currentTrick?.number ?? 1,
    leadSeat: state.currentTrick?.leadSeat ?? state.leadSeat,
    currentPlays: state.currentTrick ? state.currentTrick.plays.map((p) => ({ ...p })) : [],
    winningCards: state.wonTricks.map((t) => t.winningCard),
  };
}

/**
 * Qué hace el bot de nivel `level` sentado en `seat`. Devuelve null si no
 * es una fase de apuesta o de tirada. Siempre devuelve una acción legal.
 */
export function botChoice(state: GameState, seat: number, level: BotLevel, rng: Rng): AutopilotChoice | null {
  const view = botView(state, seat);
  if (!view) return null;
  if (view.phase === 'BETTING') {
    const valid = validBets(view.cardsPerPlayer, isLastBettor(state, seat), betsMade(state));
    return { type: 'APOSTAR', value: decideBet(view, valid, level, rng) };
  }
  if (view.hand.length === 0) return null;
  return { type: 'JUGAR_CARTA', cardId: decideCard(view, level, rng).id };
}

/** Apuesta de un bot a partir de su vista y las apuestas válidas. */
export function decideBet(view: BotView, valid: readonly number[], level: BotLevel, rng: Rng): number {
  const ranks = sortedRanks(view.hand);
  let bet: number;
  if (level === 'facil') bet = easyBet(ranks, view.players, rng);
  else if (level === 'medio') bet = mediumBet(ranks, unknownCounts(ranks, []), view.players, valid);
  else bet = hardBet(view, ranks, valid, rng);
  return nearestValid(bet, valid, rng);
}

/** Carta que tira un bot a partir de su vista. */
export function decideCard(view: BotView, level: BotLevel, rng: Rng): Card {
  const ranks = sortedRanks(view.hand);
  const bet = view.bets[view.seat] ?? 0;
  const won = view.tricksWon[view.seat] ?? 0;
  const plays = view.currentPlays.map((p) => p.card.rank);
  let rank: number;
  if (level === 'facil') {
    rank = easyPlay(ranks, bet - won, rng);
  } else {
    const seen = [...plays, ...view.winningCards.map((c) => c.rank)];
    const ctx: PlayContext = {
      hand: ranks,
      unknown: unknownCounts(ranks, seen),
      players: view.players,
      need: bet - won,
      plays,
    };
    rank = level === 'medio' ? mediumPlay(ctx) : hardPlay(view, ranks, ctx, rng);
  }
  return cardOfRank(view.hand, rank);
}

// ---------------------------------------------------------------------------
// Utilidades por valor
// ---------------------------------------------------------------------------

const MAX_RANK = JOKER_VALUE;

function deckCount(rank: number): number {
  if (rank === JOKER_VALUE) return 1;
  return rank >= 2 && rank <= 14 ? 4 : 0;
}

function sortedRanks(cards: readonly Card[]): number[] {
  return cards.map((c) => c.rank).sort((a, b) => a - b);
}

/** Entre las cartas de ese valor, la de menor identificador (determinista). */
function cardOfRank(hand: readonly Card[], rank: number): Card {
  const options = hand.filter((c) => c.rank === rank).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const card = options[0] ?? hand[0];
  if (!card) throw new Error('El bot no tiene cartas');
  return card;
}

/** Cartas que el jugador no ve, contadas por valor: mazo − su mano − lo visto. */
function unknownCounts(hand: readonly number[], seen: readonly number[]): number[] {
  const counts = Array.from({ length: MAX_RANK + 1 }, (_, r) => deckCount(r));
  for (const r of hand) counts[r] = (counts[r] ?? 0) - 1;
  for (const r of seen) counts[r] = (counts[r] ?? 0) - 1;
  return counts.map((c) => Math.max(0, c));
}

function total(counts: readonly number[]): number {
  return counts.reduce((a, b) => a + b, 0);
}

/** Cartas desconocidas de valor estrictamente mayor que `rank`. */
function higherThan(counts: readonly number[], rank: number): number {
  let h = 0;
  for (let r = rank + 1; r <= MAX_RANK; r++) h += counts[r] ?? 0;
  return h;
}

/** P(ninguna de `k` cartas tomadas al azar de `u` sea una de las `h` "malas"). */
function noneOf(u: number, h: number, k: number): number {
  if (k <= 0 || h <= 0) return 1;
  let p = 1;
  for (let i = 0; i < k; i++) {
    const den = u - i;
    if (den <= 0) break;
    p *= Math.max(0, u - h - i) / den;
  }
  return p;
}

function nearestValid(bet: number, valid: readonly number[], rng: Rng): number {
  if (valid.includes(bet)) return bet;
  let best: number[] = [];
  let bestDist = Infinity;
  for (const v of valid) {
    const d = Math.abs(v - bet);
    if (d < bestDist) {
      bestDist = d;
      best = [v];
    } else if (d === bestDist) best.push(v);
  }
  return best.length > 1 ? (best[rng.nextInt(best.length)] as number) : (best[0] ?? 0);
}

// ---------------------------------------------------------------------------
// Fácil
// ---------------------------------------------------------------------------

function easyBet(ranks: readonly number[], players: number, rng: Rng): number {
  const threshold = players <= 5 ? 13 : 14;
  let bet = ranks.filter((r) => r >= threshold).length;
  const roll = rng.nextInt(10);
  if (roll < 2) bet -= 1;
  else if (roll < 4) bet += 1;
  return Math.max(0, Math.min(ranks.length, bet));
}

function easyPlay(ranks: readonly number[], need: number, rng: Rng): number {
  if (rng.nextInt(10) < 3) return ranks[rng.nextInt(ranks.length)] as number;
  return need > 0 ? (ranks[ranks.length - 1] as number) : (ranks[0] as number);
}

// ---------------------------------------------------------------------------
// Medio
// ---------------------------------------------------------------------------

/** Probabilidad de que una carta gane una baza, vista al momento de apostar. */
function betWinProb(rank: number, unknown: readonly number[], players: number): number {
  // Los empates los gana quien tiró primero: sin saber el orden, cuentan a medias.
  const higher = higherThan(unknown, rank) + (unknown[rank] ?? 0) / 2;
  return noneOf(total(unknown), Math.round(higher), players - 1);
}

/** Distribución de la suma de bazas (Bernoulli independientes). */
function trickDistribution(ps: readonly number[]): number[] {
  let dist = [1];
  for (const p of ps) {
    const next = new Array<number>(dist.length + 1).fill(0);
    dist.forEach((q, k) => {
      next[k] = (next[k] ?? 0) + q * (1 - p);
      next[k + 1] = (next[k + 1] ?? 0) + q * p;
    });
    dist = next;
  }
  return dist;
}

/** La apuesta válida que más puntos espera: (5 + b) · P(ganar exactamente b). */
function mediumBet(ranks: readonly number[], unknown: readonly number[], players: number, valid: readonly number[]): number {
  const ps = ranks.map((r) => betWinProb(r, unknown, players));
  const dist = trickDistribution(ps);
  const expected = ps.reduce((a, b) => a + b, 0);
  let best = valid[0] ?? 0;
  let bestScore = -1;
  for (const b of valid) {
    const score = (5 + b) * (dist[b] ?? 0);
    const better =
      score > bestScore + 1e-12 ||
      (Math.abs(score - bestScore) <= 1e-12 && Math.abs(b - expected) < Math.abs(best - expected));
    if (better) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}

interface PlayContext {
  /** Mano propia, valores ordenados de menor a mayor. */
  hand: readonly number[];
  /** Cartas que no ve, por valor. */
  unknown: readonly number[];
  players: number;
  /** Bazas que le faltan para cumplir (≤ 0: no quiere ganar más). */
  need: number;
  /** Valores ya tirados en la baza en curso, en orden. */
  plays: readonly number[];
}

/** Probabilidad de que `rank` gane la baza en curso si la tira ahora. */
function playWinProb(rank: number, ctx: PlayContext): number {
  const current = ctx.plays.length > 0 ? Math.max(...ctx.plays) : 0;
  if (rank <= current) return 0; // a igual valor gana quien tiró primero
  const later = ctx.players - ctx.plays.length - 1;
  return noneOf(total(ctx.unknown), higherThan(ctx.unknown, rank), later);
}

function mediumPlay(ctx: PlayContext): number {
  const { hand, need, plays } = ctx;
  const lowest = hand[0] as number;
  const highest = hand[hand.length - 1] as number;
  const following = plays.length > 0;
  const current = following ? Math.max(...plays) : 0;
  const remaining = hand.length;

  if (need <= 0) {
    // Quiere perder: si va detrás, descarta la carta más alta que no gana.
    if (following) {
      const losing = hand.filter((r) => r <= current);
      if (losing.length > 0) return losing[losing.length - 1] as number;
    }
    return lowest;
  }

  const winning = hand.filter((r) => r > current);
  const last = ctx.players - plays.length - 1 === 0;

  if (need >= remaining) {
    // Tiene que ganar todas: va con lo más fuerte (o lo justo si es el último).
    if (following && last && winning.length > 0) return winning[0] as number;
    return highest;
  }

  if (following) {
    if (winning.length === 0) return lowest;
    if (last) return winning[0] as number;
    const threshold = need / remaining >= 0.5 ? 0.35 : 0.55;
    const good = winning.find((r) => playWinProb(r, ctx) >= threshold);
    return good ?? lowest;
  }

  // Abre la baza.
  if (playWinProb(highest, ctx) >= 0.6) return highest;
  return lowest;
}

// ---------------------------------------------------------------------------
// Difícil: imagina repartijas de las cartas que no ve y juega cada una
// hasta el final con la estrategia media para todos.
// ---------------------------------------------------------------------------

const HARD_SAMPLES_BET = 48;
const HARD_SAMPLES_PLAY = 40;

interface World {
  players: number;
  hands: number[][];
  bets: number[];
  won: number[];
  lead: number;
  plays: { seat: number; rank: number }[];
  /** Cartas ganadoras de bazas cerradas (públicas). */
  winners: number[];
}

/** Mazo por valores menos lo que el bot conoce, como lista ordenada. */
function unknownPool(counts: readonly number[]): number[] {
  const pool: number[] = [];
  counts.forEach((c, r) => {
    for (let i = 0; i < c; i++) pool.push(r);
  });
  return pool;
}

/** Reparte el pool (barajado) entre los rivales según cuántas cartas tienen. */
function dealOpponents(pool: readonly number[], sizes: readonly number[], seat: number, own: readonly number[], rng: Rng): number[][] {
  const deck = shuffle(pool, rng);
  let index = 0;
  return sizes.map((size, s) => {
    if (s === seat) return [...own];
    const hand = deck.slice(index, index + size).sort((a, b) => a - b);
    index += size;
    return hand;
  });
}

function removeOne(hand: number[], rank: number): void {
  const i = hand.indexOf(rank);
  if (i >= 0) hand.splice(i, 1);
}

/** Juega el resto de la partida con la estrategia media para todos. */
function playOut(world: World, forced: { seat: number; rank: number } | null): void {
  const n = world.players;
  let pending = forced;
  for (;;) {
    if (world.plays.length === n) {
      let winner = world.plays[0] as { seat: number; rank: number };
      for (const p of world.plays) if (p.rank > winner.rank) winner = p;
      world.won[winner.seat] = (world.won[winner.seat] ?? 0) + 1;
      world.winners.push(winner.rank);
      world.lead = winner.seat;
      world.plays = [];
    }
    const seat = (world.lead + world.plays.length) % n;
    const hand = world.hands[seat] as number[];
    if (hand.length === 0) return;
    let rank: number;
    if (pending && pending.seat === seat) {
      rank = pending.rank;
      pending = null;
    } else {
      const plays = world.plays.map((p) => p.rank);
      rank = mediumPlay({
        hand,
        unknown: unknownCounts(hand, [...plays, ...world.winners]),
        players: n,
        need: (world.bets[seat] ?? 0) - (world.won[seat] ?? 0),
        plays,
      });
    }
    removeOne(hand, rank);
    world.plays.push({ seat, rank });
  }
}

function cloneWorld(w: World): World {
  return {
    players: w.players,
    hands: w.hands.map((h) => [...h]),
    bets: [...w.bets],
    won: [...w.won],
    lead: w.lead,
    plays: w.plays.map((p) => ({ ...p })),
    winners: [...w.winners],
  };
}

function hardBet(view: BotView, ranks: readonly number[], valid: readonly number[], rng: Rng): number {
  const n = view.players;
  const N = view.cardsPerPlayer;
  const order = Array.from({ length: n }, (_, i) => (view.dealerSeat + 1 + i) % n);
  const myIndex = order.indexOf(view.seat);
  const pool = unknownPool(unknownCounts(ranks, []));
  const sizes = Array.from({ length: n }, () => N);
  const hits = new Map<number, number>(valid.map((b) => [b, 0]));

  for (let s = 0; s < HARD_SAMPLES_BET; s++) {
    const hands = dealOpponents(pool, sizes, view.seat, ranks, rng);
    for (const b of valid) {
      const bets = view.bets.map((x) => x ?? 0);
      bets[view.seat] = b;
      // Los que apuestan después: apuesta media sobre su mano imaginada.
      for (let i = myIndex + 1; i < n; i++) {
        const seat = order[i] as number;
        const prev = order.slice(0, i).map((o) => bets[o] ?? 0);
        const theirValid = validBets(N, seat === view.dealerSeat, prev);
        const hand = hands[seat] as number[];
        bets[seat] = mediumBet(hand, unknownCounts(hand, []), n, theirValid);
      }
      const world: World = {
        players: n,
        hands: hands.map((h) => [...h]),
        bets,
        won: new Array<number>(n).fill(0),
        lead: (view.dealerSeat + 1) % n,
        plays: [],
        winners: [],
      };
      playOut(world, null);
      if (world.won[view.seat] === b) hits.set(b, (hits.get(b) ?? 0) + 1);
    }
  }

  const fallback = mediumBet(ranks, unknownCounts(ranks, []), n, valid);
  let best = fallback;
  let bestScore = (5 + fallback) * (hits.get(fallback) ?? 0);
  for (const b of valid) {
    const score = (5 + b) * (hits.get(b) ?? 0);
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}

function hardPlay(view: BotView, ranks: readonly number[], ctx: PlayContext, rng: Rng): number {
  const candidates = [...new Set(ranks)];
  const fallback = mediumPlay(ctx);
  if (candidates.length === 1) return candidates[0] as number;

  const n = view.players;
  const done = view.trickNumber - 1;
  const playedNow = new Set(view.currentPlays.map((p) => p.seat));
  const sizes = Array.from({ length: n }, (_, s) => view.cardsPerPlayer - done - (playedNow.has(s) ? 1 : 0));
  const pool = unknownPool(ctx.unknown);
  const bet = view.bets[view.seat] ?? 0;
  const hits = new Map<number, number>(candidates.map((r) => [r, 0]));

  for (let s = 0; s < HARD_SAMPLES_PLAY; s++) {
    const base: World = {
      players: n,
      hands: dealOpponents(pool, sizes, view.seat, ranks, rng),
      bets: view.bets.map((b) => b ?? 0),
      won: [...view.tricksWon],
      lead: view.leadSeat,
      plays: view.currentPlays.map((p) => ({ seat: p.seat, rank: p.card.rank })),
      winners: view.winningCards.map((c) => c.rank),
    };
    for (const rank of candidates) {
      const world = cloneWorld(base);
      playOut(world, { seat: view.seat, rank });
      if (world.won[view.seat] === bet) hits.set(rank, (hits.get(rank) ?? 0) + 1);
    }
  }

  let best = fallback;
  let bestHits = hits.get(fallback) ?? 0;
  for (const rank of candidates) {
    const h = hits.get(rank) ?? 0;
    if (h > bestHits) {
      best = rank;
      bestHits = h;
    }
  }
  return best;
}
