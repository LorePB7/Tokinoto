/**
 * Máquina de estados del juego, en dos funciones puras:
 *
 *   decide(estado, acción, azar) -> eventos | error     (valida y decide)
 *   evolve(estado, evento)       -> estado nuevo        (aplica un hecho)
 *   apply = decide + evolve de cada evento resultante
 *
 * El estado se puede reconstruir aplicando los eventos en orden (replay),
 * sin necesidad de azar: los eventos ya traen las cartas repartidas.
 *
 * Flujo de fases:
 *   READY_TO_START -> DEALER_DRAW -> BETTING -> PLAYING <-> TRICK_RESOLUTION
 *   -> ROUND_SUMMARY -> (BETTING de la partida siguiente | FINISHED)
 */
import { validateBet } from './apuestas';
import { determineTrickWinner, hasChip } from './bazas';
import { buildDeck, DECK_SIZE, getCardById } from './cartas';
import { DEFAULT_CONFIG } from './config';
import { initialLead, nextDealer } from './mesa';
import { autopilotChoice } from './piloto';
import { roundPoints } from './puntaje';
import { buildRanking } from './ranking';
import { shuffle, type Rng } from './rng';
import { betsMade, currentTurn, isLastBettor, seatOfPlayer } from './selectores';
import { drawForDealer } from './sorteo';
import type {
  Action,
  ApplyResult,
  ErrorCode,
  GameConfig,
  GameEvent,
  GameState,
  PlayerInfo,
  Result,
  RoundResult,
} from './tipos';

function fail(code: ErrorCode, message: string): { ok: false; error: { code: ErrorCode; message: string } } {
  return { ok: false, error: { code, message } };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

/** Crea un juego listo para iniciar (estado READY_TO_START). */
export function createGame(
  players: readonly PlayerInfo[],
  config: GameConfig = DEFAULT_CONFIG,
): Result<GameState> {
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    return fail(
      'CANTIDAD_JUGADORES_INVALIDA',
      `Se necesitan entre ${config.minPlayers} y ${config.maxPlayers} jugadores y hay ${players.length}`,
    );
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    return fail('JUGADORES_DUPLICADOS', 'Hay identificadores de jugador repetidos');
  }
  const rounds = config.cardsPerRound;
  const maxCards = Math.max(...rounds);
  if (
    rounds.length === 0 ||
    rounds.some((cards) => !Number.isInteger(cards) || cards < 1) ||
    config.basePoints < 0 ||
    players.length * maxCards > DECK_SIZE
  ) {
    return fail('CONFIGURACION_INVALIDA', 'La configuración del juego no es válida');
  }

  return ok({
    config: { ...config, cardsPerRound: [...config.cardsPerRound] },
    players: players.map((player) => ({ id: player.id, name: player.name })),
    phase: 'READY_TO_START',
    roundNumber: 0,
    cardsPerPlayer: 0,
    dealerSeat: null,
    leadSeat: null,
    hands: players.map(() => []),
    bets: players.map(() => null),
    tricksWon: players.map(() => 0),
    currentTrick: null,
    wonTricks: [],
    roundScores: players.map(() => []),
    dealerDraw: [],
    ranking: null,
    abortReason: null,
  });
}

// ---------------------------------------------------------------------------
// Evolve: aplica un evento (hecho ya decidido) y devuelve un estado nuevo
// ---------------------------------------------------------------------------

export function evolve(state: GameState, event: GameEvent): GameState {
  const next = structuredClone(state);
  switch (event.type) {
    case 'JUEGO_INICIADO':
      next.phase = 'DEALER_DRAW';
      return next;

    case 'SORTEO_RONDA':
      next.dealerDraw.push({ draws: event.draws });
      return next;

    case 'REPARTIDOR_DEFINIDO':
      next.dealerSeat = event.dealerSeat;
      return next;

    case 'PARTIDA_INICIADA':
      next.phase = 'BETTING';
      next.roundNumber = event.roundNumber;
      next.cardsPerPlayer = event.cardsPerPlayer;
      next.dealerSeat = event.dealerSeat;
      next.leadSeat = event.leadSeat;
      next.hands = event.hands;
      next.bets = next.players.map(() => null);
      next.tricksWon = next.players.map(() => 0);
      next.currentTrick = null;
      next.wonTricks = [];
      return next;

    case 'APUESTA_REALIZADA':
      next.bets[event.seat] = event.value;
      return next;

    case 'BAZA_INICIADA':
      next.phase = 'PLAYING';
      next.currentTrick = {
        number: event.trickNumber,
        leadSeat: event.leadSeat,
        plays: [],
        winnerSeat: null,
      };
      return next;

    case 'CARTA_JUGADA': {
      const hand = next.hands[event.seat] ?? [];
      next.hands[event.seat] = hand.filter((card) => card.id !== event.card.id);
      next.currentTrick?.plays.push({ seat: event.seat, card: event.card });
      return next;
    }

    case 'BAZA_RESUELTA':
      next.phase = 'TRICK_RESOLUTION';
      if (next.currentTrick) next.currentTrick.winnerSeat = event.winnerSeat;
      next.tricksWon[event.winnerSeat] = (next.tricksWon[event.winnerSeat] ?? 0) + 1;
      next.wonTricks.push({
        trickNumber: event.trickNumber,
        winnerSeat: event.winnerSeat,
        winningCard: event.winningCard,
        hasChip: event.hasChip,
      });
      next.leadSeat = event.winnerSeat;
      return next;

    case 'PARTIDA_PUNTUADA':
      next.phase = 'ROUND_SUMMARY';
      for (const result of event.results) {
        const scores = next.roundScores[result.seat];
        if (scores) scores[event.roundNumber - 1] = result.points;
      }
      return next;

    case 'JUEGO_TERMINADO':
      next.phase = 'FINISHED';
      next.ranking = event.ranking;
      return next;

    case 'JUEGO_ABORTADO':
      next.phase = 'ABORTED';
      next.abortReason = event.reason;
      return next;

    default: {
      const unreachable: never = event;
      throw new Error(`Evento desconocido: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Reconstruye un estado aplicando los eventos en orden. */
export function replay(initial: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(evolve, initial);
}

// ---------------------------------------------------------------------------
// Decide: valida una acción y produce los eventos resultantes
// ---------------------------------------------------------------------------

function buildRoundStarted(
  state: GameState,
  roundNumber: number,
  dealerSeat: number,
  rng: Rng,
): GameEvent {
  const n = state.players.length;
  const cardsPerPlayer = state.config.cardsPerRound[roundNumber - 1] as number;
  const deck = shuffle(buildDeck(), rng);
  // Las cartas sobrantes no se usan ni son visibles para nadie.
  const hands = state.players.map((_, seat) => deck.slice(seat * cardsPerPlayer, (seat + 1) * cardsPerPlayer));
  return {
    type: 'PARTIDA_INICIADA',
    roundNumber,
    cardsPerPlayer,
    dealerSeat,
    leadSeat: initialLead(dealerSeat, n),
    hands,
  };
}

function decideBet(
  state: GameState,
  seat: number,
  value: number,
  porPiloto: boolean,
): Result<GameEvent[]> {
  if (state.phase !== 'BETTING') {
    return fail('ESTADO_INVALIDO', 'Solo se puede apostar durante la fase de apuestas');
  }
  if (state.bets[seat] !== null) {
    return fail('APUESTA_YA_REALIZADA', 'Este jugador ya apostó en esta partida');
  }
  const turn = currentTurn(state);
  if (!turn || turn.seat !== seat) {
    return fail('NO_ES_TU_TURNO', 'No es el turno de apostar de este jugador');
  }
  const error = validateBet(state.cardsPerPlayer, value, isLastBettor(state, seat), betsMade(state));
  if (error === 'APUESTA_FUERA_DE_RANGO') {
    return fail(error, `La apuesta debe ser un entero entre 0 y ${state.cardsPerPlayer}`);
  }
  if (error === 'APUESTA_PROHIBIDA_PIE') {
    return fail(error, 'El Pié no puede apostar el valor que iguala la suma de apuestas con las cartas de la partida');
  }

  const events: GameEvent[] = [
    { type: 'APUESTA_REALIZADA', seat, value, ...(porPiloto ? { porPiloto: true as const } : {}) },
  ];
  const allBetsIn = betsMade(state).length + 1 === state.players.length;
  if (allBetsIn) {
    events.push({ type: 'BAZA_INICIADA', trickNumber: 1, leadSeat: state.leadSeat as number });
  }
  return ok(events);
}

function decidePlay(
  state: GameState,
  seat: number,
  cardId: string,
  porPiloto: boolean,
): Result<GameEvent[]> {
  if (state.phase !== 'PLAYING' || !state.currentTrick) {
    return fail('ESTADO_INVALIDO', 'Solo se puede jugar una carta durante la fase de juego');
  }
  const turn = currentTurn(state);
  if (!turn || turn.seat !== seat) {
    return fail('NO_ES_TU_TURNO', 'No es el turno de jugar de este jugador');
  }
  const card = (state.hands[seat] ?? []).find((candidate) => candidate.id === cardId);
  if (!card || getCardById(cardId) === undefined) {
    return fail('CARTA_NO_EN_MANO', 'Ese jugador no tiene esa carta');
  }

  const events: GameEvent[] = [
    { type: 'CARTA_JUGADA', seat, card, ...(porPiloto ? { porPiloto: true as const } : {}) },
  ];
  const trick = state.currentTrick;
  const plays = [...trick.plays, { seat, card }];
  if (plays.length === state.players.length) {
    const winner = determineTrickWinner(plays);
    const wonAfter = (state.tricksWon[winner.seat] ?? 0) + 1;
    events.push({
      type: 'BAZA_RESUELTA',
      trickNumber: trick.number,
      winnerSeat: winner.seat,
      winningCard: winner.card,
      hasChip: hasChip(wonAfter, state.bets[winner.seat] as number),
    });
  }
  return ok(events);
}

function decideAdvance(state: GameState, rng: Rng): Result<GameEvent[]> {
  const n = state.players.length;

  if (state.phase === 'TRICK_RESOLUTION') {
    const handsEmpty = state.hands.every((hand) => hand.length === 0);
    if (!handsEmpty) {
      return ok([
        {
          type: 'BAZA_INICIADA',
          trickNumber: (state.currentTrick?.number ?? 0) + 1,
          leadSeat: state.leadSeat as number,
        },
      ]);
    }
    const results: RoundResult[] = state.players.map((_, seat) => {
      const bet = state.bets[seat] as number;
      const tricksWon = state.tricksWon[seat] ?? 0;
      return { seat, bet, tricksWon, points: roundPoints(bet, tricksWon, state.config.basePoints) };
    });
    return ok([{ type: 'PARTIDA_PUNTUADA', roundNumber: state.roundNumber, results }]);
  }

  if (state.phase === 'ROUND_SUMMARY') {
    if (state.roundNumber < state.config.cardsPerRound.length) {
      const dealer = nextDealer(state.dealerSeat as number, n);
      return ok([buildRoundStarted(state, state.roundNumber + 1, dealer, rng)]);
    }
    return ok([{ type: 'JUEGO_TERMINADO', ranking: buildRanking(state.roundScores) }]);
  }

  return fail('ESTADO_INVALIDO', 'No hay nada que avanzar en este estado');
}

/** Valida una acción contra el estado y devuelve los eventos, o un error. */
export function decide(state: GameState, action: Action, rng: Rng): Result<GameEvent[]> {
  if (state.phase === 'FINISHED' || state.phase === 'ABORTED') {
    return fail('JUEGO_TERMINADO', 'El juego ya terminó o fue abortado');
  }

  switch (action.type) {
    case 'INICIAR_JUEGO':
      if (state.phase !== 'READY_TO_START') {
        return fail('ESTADO_INVALIDO', 'El juego ya fue iniciado');
      }
      return ok([{ type: 'JUEGO_INICIADO' }]);

    case 'SORTEAR_REPARTIDOR': {
      if (state.phase !== 'DEALER_DRAW') {
        return fail('ESTADO_INVALIDO', 'El sorteo del repartidor solo se hace al comenzar el juego');
      }
      const { rounds, dealerSeat } = drawForDealer(state.players.length, rng);
      const events: GameEvent[] = rounds.map((round) => ({ type: 'SORTEO_RONDA', draws: round.draws }));
      events.push({ type: 'REPARTIDOR_DEFINIDO', dealerSeat });
      events.push(buildRoundStarted(state, 1, dealerSeat, rng));
      return ok(events);
    }

    case 'APOSTAR': {
      const seat = seatOfPlayer(state, action.playerId);
      if (seat < 0) return fail('JUGADOR_DESCONOCIDO', 'El jugador no participa de este juego');
      return decideBet(state, seat, action.value, false);
    }

    case 'JUGAR_CARTA': {
      const seat = seatOfPlayer(state, action.playerId);
      if (seat < 0) return fail('JUGADOR_DESCONOCIDO', 'El jugador no participa de este juego');
      return decidePlay(state, seat, action.cardId, false);
    }

    case 'AVANZAR':
      return decideAdvance(state, rng);

    case 'PILOTO_AUTOMATICO': {
      const seat = seatOfPlayer(state, action.playerId);
      if (seat < 0) return fail('JUGADOR_DESCONOCIDO', 'El jugador no participa de este juego');
      if (state.phase !== 'BETTING' && state.phase !== 'PLAYING') {
        return fail('ESTADO_INVALIDO', 'El piloto automático solo actúa al apostar o jugar una carta');
      }
      const turn = currentTurn(state);
      if (!turn || turn.seat !== seat) {
        return fail('NO_ES_TU_TURNO', 'No es el turno de este jugador');
      }
      const choice = autopilotChoice(state, seat);
      if (!choice) return fail('ESTADO_INVALIDO', 'El piloto automático no tiene una jugada posible');
      return choice.type === 'APOSTAR'
        ? decideBet(state, seat, choice.value, true)
        : decidePlay(state, seat, choice.cardId, true);
    }

    case 'ABORTAR_JUEGO':
      return ok([{ type: 'JUEGO_ABORTADO', reason: action.reason }]);

    default: {
      const unreachable: never = action;
      throw new Error(`Acción desconocida: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Decide y aplica. Devuelve el estado nuevo y los eventos, o un error. */
export function apply(state: GameState, action: Action, rng: Rng): ApplyResult {
  const decision = decide(state, action, rng);
  if (!decision.ok) return decision;
  return { ok: true, state: replay(state, decision.value), events: decision.value };
}
