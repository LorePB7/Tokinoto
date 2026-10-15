import {
  apply,
  checkInvariants,
  createGame,
  createSeededRng,
  getCardById,
  playOrder,
  replay,
  validBetsFor,
  currentTurn,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerInfo,
  type Rng,
} from '../src/index';

export function makePlayers(count: number): PlayerInfo[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Jugador ${i}` }));
}

export function newGame(count: number): GameState {
  const result = createGame(makePlayers(count));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Aplica una acción y falla el test si el motor la rechaza. */
export function must(state: GameState, action: Action, rng: Rng): { state: GameState; events: GameEvent[] } {
  const result = apply(state, action, rng);
  if (!result.ok) throw new Error(`${action.type} rechazada: ${result.error.code} - ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Juego iniciado y sorteado: queda en BETTING de la partida 1. */
export function startedGame(count: number, seed: number): { state: GameState; rng: Rng } {
  const rng = createSeededRng(seed);
  let state = newGame(count);
  state = must(state, { type: 'INICIAR_JUEGO' }, rng).state;
  state = must(state, { type: 'SORTEAR_REPARTIDOR' }, rng).state;
  return { state, rng };
}

/** Reemplaza las manos. Índice del arreglo = posición en el orden de tirada. */
export function withHandsByPlayOrder(state: GameState, handsByPosition: string[][]): GameState {
  const order = playOrder(state.leadSeat as number, state.players.length);
  const hands = state.hands.map((hand) => [...hand]);
  handsByPosition.forEach((ids, position) => {
    hands[order[position] as number] = ids.map((id) => {
      const card = getCardById(id);
      if (!card) throw new Error(`Carta inexistente en la prueba: ${id}`);
      return card;
    });
  });
  return { ...state, hands };
}

export function playerIdAt(state: GameState, seat: number): string {
  return (state.players[seat] as PlayerInfo).id;
}

/** Id del jugador que está en la posición `position` del orden de tirada. */
export function playerAtPosition(state: GameState, position: number): string {
  const order = playOrder(state.leadSeat as number, state.players.length);
  return playerIdAt(state, order[position] as number);
}

export interface RandomGameResult {
  initial: GameState;
  final: GameState;
  events: GameEvent[];
  steps: number;
}

/**
 * Juega un juego completo con apuestas y cartas al azar (siempre legales).
 * `onStep` se ejecuta después de cada acción para chequear invariantes.
 */
export function runRandomGame(
  playerCount: number,
  seed: number,
  onStep?: (state: GameState, events: GameEvent[]) => void,
): RandomGameResult {
  const engineRng = createSeededRng(seed);
  const picker = createSeededRng(seed ^ 0x9e3779b9);
  const initial = newGame(playerCount);
  let state = initial;
  const events: GameEvent[] = [];
  let steps = 0;

  const run = (action: Action): void => {
    const step = must(state, action, engineRng);
    state = step.state;
    events.push(...step.events);
    steps++;
    onStep?.(state, step.events);
  };

  run({ type: 'INICIAR_JUEGO' });
  while (state.phase !== 'FINISHED') {
    if (steps > 10000) throw new Error('El juego no termina: posible bucle');
    switch (state.phase) {
      case 'DEALER_DRAW':
        run({ type: 'SORTEAR_REPARTIDOR' });
        break;
      case 'BETTING': {
        const turn = currentTurn(state);
        if (!turn) throw new Error('Sin turno de apuesta');
        const valid = validBetsFor(state, turn.seat);
        const value = valid[picker.nextInt(valid.length)] as number;
        run({ type: 'APOSTAR', playerId: playerIdAt(state, turn.seat), value });
        break;
      }
      case 'PLAYING': {
        const turn = currentTurn(state);
        if (!turn) throw new Error('Sin turno de carta');
        const hand = state.hands[turn.seat] ?? [];
        const card = hand[picker.nextInt(hand.length)];
        if (!card) throw new Error('Mano vacía en el turno');
        run({ type: 'JUGAR_CARTA', playerId: playerIdAt(state, turn.seat), cardId: card.id });
        break;
      }
      case 'TRICK_RESOLUTION':
      case 'ROUND_SUMMARY':
        run({ type: 'AVANZAR' });
        break;
      default:
        throw new Error(`Fase inesperada: ${state.phase}`);
    }
  }
  return { initial, final: state, events, steps };
}

export function assertNoProblems(state: GameState): void {
  const problems = checkInvariants(state);
  if (problems.length > 0) throw new Error(`Invariantes violados:\n- ${problems.join('\n- ')}`);
}

export { replay };
