import { describe, expect, it } from 'vitest';
import {
  apply,
  autopilotChoice,
  bettingOrder,
  chipsRemainingFor,
  createGame,
  createSeededRng,
  currentTurn,
  forbiddenBetFor,
  lowestCard,
  getCardById,
  nextDealer,
  initialLead,
  type GameState,
} from '../src/index';
import {
  makePlayers,
  must,
  newGame,
  playerAtPosition,
  playerIdAt,
  runRandomGame,
  startedGame,
  withHandsByPlayOrder,
} from './ayudas';

const rng = () => createSeededRng(123);

describe('creación del juego', () => {
  it('exige entre 4 y 7 jugadores', () => {
    for (const count of [0, 1, 3, 8, 10]) {
      const result = createGame(makePlayers(count));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CANTIDAD_JUGADORES_INVALIDA');
    }
    for (const count of [4, 5, 6, 7]) {
      expect(createGame(makePlayers(count)).ok).toBe(true);
    }
  });

  it('rechaza identificadores de jugador repetidos', () => {
    const players = [...makePlayers(4).slice(0, 3), { id: 'p0', name: 'Otro' }];
    const result = createGame(players);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('JUGADORES_DUPLICADOS');
  });

  it('rechaza configuraciones que no caben en el mazo', () => {
    const result = createGame(makePlayers(7), {
      minPlayers: 4,
      maxPlayers: 7,
      cardsPerRound: [8],
      basePoints: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFIGURACION_INVALIDA');
  });

  it('arranca en READY_TO_START sin partida en curso', () => {
    const state = newGame(5);
    expect(state.phase).toBe('READY_TO_START');
    expect(state.roundNumber).toBe(0);
    expect(state.roundScores).toEqual([[], [], [], [], []]);
  });
});

describe('inicio del juego y sorteo', () => {
  it('INICIAR_JUEGO lleva a DEALER_DRAW y solo se puede una vez', () => {
    const state = must(newGame(4), { type: 'INICIAR_JUEGO' }, rng()).state;
    expect(state.phase).toBe('DEALER_DRAW');
    const again = apply(state, { type: 'INICIAR_JUEGO' }, rng());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('ESTADO_INVALIDO');
  });

  it('no se puede sortear antes de iniciar', () => {
    const result = apply(newGame(4), { type: 'SORTEAR_REPARTIDOR' }, rng());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ESTADO_INVALIDO');
  });

  it('tras el sorteo empieza la partida 1 en BETTING con el repartidor como Pié', () => {
    for (const count of [4, 5, 6, 7]) {
      const { state } = startedGame(count, count);
      expect(state.phase).toBe('BETTING');
      expect(state.roundNumber).toBe(1);
      expect(state.cardsPerPlayer).toBe(1);
      expect(state.hands.every((hand) => hand.length === 1)).toBe(true);
      const dealer = state.dealerSeat as number;
      expect(state.leadSeat).toBe(initialLead(dealer, count));
      expect(bettingOrder(dealer, count).at(-1)).toBe(dealer);
      expect(currentTurn(state)).toEqual({ kind: 'bet', seat: state.leadSeat });
      expect(state.dealerDraw.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('las cartas repartidas son todas distintas', () => {
    const { state } = startedGame(7, 99);
    const ids = state.hands.flat().map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('apuestas', () => {
  it('rechaza apostar fuera de turno', () => {
    const { state } = startedGame(4, 1);
    const result = apply(state, { type: 'APOSTAR', playerId: playerAtPosition(state, 1), value: 0 }, rng());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_ES_TU_TURNO');
  });

  it('rechaza apostar dos veces', () => {
    const { state } = startedGame(4, 1);
    const first = must(state, { type: 'APOSTAR', playerId: playerAtPosition(state, 0), value: 1 }, rng()).state;
    const again = apply(first, { type: 'APOSTAR', playerId: playerAtPosition(state, 0), value: 0 }, rng());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('APUESTA_YA_REALIZADA');
  });

  it('rechaza apuestas fuera de 0..N, negativas o no enteras', () => {
    const { state } = startedGame(4, 1);
    for (const value of [-1, 2, 0.5, Number.NaN]) {
      const result = apply(state, { type: 'APOSTAR', playerId: playerAtPosition(state, 0), value }, rng());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('APUESTA_FUERA_DE_RANGO');
    }
  });

  it('rechaza jugadores desconocidos', () => {
    const { state } = startedGame(4, 1);
    const result = apply(state, { type: 'APOSTAR', playerId: 'intruso', value: 0 }, rng());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('JUGADOR_DESCONOCIDO');
  });

  it('rechaza jugar una carta durante las apuestas', () => {
    const { state } = startedGame(4, 1);
    const result = apply(
      state,
      { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, 0), cardId: state.hands[0]![0]!.id },
      rng(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ESTADO_INVALIDO');
  });

  it('el Pié no puede apostar el valor que iguala la suma (partida de 1 carta, apuestas 1, 0, 0)', () => {
    let { state } = startedGame(4, 5);
    const bets = [1, 0, 0];
    bets.forEach((value, position) => {
      state = must(state, { type: 'APOSTAR', playerId: playerAtPosition(state, position), value }, rng()).state;
    });
    const pie = playerAtPosition(state, 3);
    expect(forbiddenBetFor(state, state.dealerSeat as number)).toBe(0);
    const bad = apply(state, { type: 'APOSTAR', playerId: pie, value: 0 }, rng());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('APUESTA_PROHIBIDA_PIE');
    const good = apply(state, { type: 'APOSTAR', playerId: pie, value: 1 }, rng());
    expect(good.ok).toBe(true);
  });

  it('el Pié no puede apostar 1 si todos los demás apostaron 0 en una partida de 1 carta', () => {
    let { state } = startedGame(5, 8);
    for (let position = 0; position < 4; position++) {
      state = must(state, { type: 'APOSTAR', playerId: playerAtPosition(state, position), value: 0 }, rng()).state;
    }
    const bad = apply(state, { type: 'APOSTAR', playerId: playerAtPosition(state, 4), value: 1 }, rng());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('APUESTA_PROHIBIDA_PIE');
  });

  it('al completar las apuestas empieza la primera baza con el Mano inicial', () => {
    let { state } = startedGame(4, 3);
    const lead = state.leadSeat;
    for (const [position, value] of [1, 0, 0, 1].entries()) {
      state = must(state, { type: 'APOSTAR', playerId: playerAtPosition(state, position), value }, rng()).state;
    }
    expect(state.phase).toBe('PLAYING');
    expect(state.currentTrick).toMatchObject({ number: 1, leadSeat: lead, plays: [] });
  });
});

/** Partida 1 con manos y apuestas controladas. Posición 0 = Mano, posición 3 = Pié. */
function round1Playing(handsByPosition: string[][], seed = 11): { state: GameState; dealer: number } {
  let { state } = startedGame(4, seed);
  state = withHandsByPlayOrder(state, handsByPosition);
  for (const [position, value] of [1, 0, 0, 1].entries()) {
    state = must(state, { type: 'APOSTAR', playerId: playerAtPosition(state, position), value }, rng()).state;
  }
  return { state, dealer: state.dealerSeat as number };
}

describe('juego de cartas', () => {
  it('rechaza jugar fuera de turno', () => {
    const { state } = round1Playing([['A-picas'], ['K-picas'], ['K-corazones'], ['2-treboles']]);
    const result = apply(
      state,
      { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, 1), cardId: 'K-picas' },
      rng(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_ES_TU_TURNO');
  });

  it('rechaza cartas que el jugador no tiene o que no existen', () => {
    const { state } = round1Playing([['A-picas'], ['K-picas'], ['K-corazones'], ['2-treboles']]);
    for (const cardId of ['K-picas', 'COMODIN', 'inexistente', '']) {
      const result = apply(state, { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, 0), cardId }, rng());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CARTA_NO_EN_MANO');
    }
  });

  it('rechaza apostar durante el juego de cartas', () => {
    const { state } = round1Playing([['A-picas'], ['K-picas'], ['K-corazones'], ['2-treboles']]);
    const result = apply(state, { type: 'APOSTAR', playerId: playerAtPosition(state, 0), value: 0 }, rng());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ESTADO_INVALIDO');
  });

  it('no hay obligación de seguir palo: cualquier carta de la mano es jugable', () => {
    const { state } = round1Playing([['A-picas'], ['K-picas'], ['K-corazones'], ['2-treboles']]);
    let current = must(state, { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, 0), cardId: 'A-picas' }, rng()).state;
    current = must(current, { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, 1), cardId: 'K-picas' }, rng()).state;
    expect(current.currentTrick?.plays).toHaveLength(2);
  });

  it('ciclo completo con ficha: gana el Mano con A, pasa de baza a resumen y a la partida 2', () => {
    const { state, dealer } = round1Playing([['A-picas'], ['K-picas'], ['K-corazones'], ['2-treboles']]);
    const before = structuredClone(state);
    let current = state;
    const winnerSeat = state.leadSeat as number;
    let events;
    for (const [position, cardId] of ['A-picas', 'K-picas', 'K-corazones', '2-treboles'].entries()) {
      ({ state: current, events } = must(
        current,
        { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, position), cardId },
        rng(),
      ));
    }
    // El estado original no se modificó (el motor es puro).
    expect(state).toEqual(before);

    const resolved = events!.find((event) => event.type === 'BAZA_RESUELTA');
    expect(resolved).toMatchObject({ winnerSeat, hasChip: true });
    expect(current.phase).toBe('TRICK_RESOLUTION');
    expect(current.leadSeat).toBe(winnerSeat);
    expect(current.tricksWon[winnerSeat]).toBe(1);
    expect(current.wonTricks[0]).toMatchObject({ winnerSeat, hasChip: true });
    expect(current.wonTricks[0]!.winningCard.id).toBe('A-picas');
    expect(chipsRemainingFor(current, winnerSeat)).toBe(0);

    // AVANZAR: sin cartas en las manos -> puntaje de la partida.
    const scored = must(current, { type: 'AVANZAR' }, rng());
    expect(scored.state.phase).toBe('ROUND_SUMMARY');
    const results = (scored.events[0] as Extract<(typeof scored.events)[number], { type: 'PARTIDA_PUNTUADA' }>).results;
    const pointsBySeat = (position: number): number => {
      const playerId = playerAtPosition(state, position);
      const seat = state.players.findIndex((player) => player.id === playerId);
      return results.find((result) => result.seat === seat)!.points;
    };
    expect(pointsBySeat(0)).toBe(6); // apostó 1 y ganó 1
    expect(pointsBySeat(1)).toBe(5); // apostó 0 y ganó 0
    expect(pointsBySeat(2)).toBe(5);
    expect(pointsBySeat(3)).toBe(0); // apostó 1 y ganó 0

    // AVANZAR: arranca la partida 2. Reparte el jugador a la derecha del repartidor anterior;
    // el Mano es el que está a su derecha, sin importar quién ganó la última baza.
    const next = must(scored.state, { type: 'AVANZAR' }, createSeededRng(77)).state;
    expect(next.phase).toBe('BETTING');
    expect(next.roundNumber).toBe(2);
    expect(next.cardsPerPlayer).toBe(2);
    expect(next.dealerSeat).toBe(nextDealer(dealer, 4));
    expect(next.leadSeat).toBe(initialLead(next.dealerSeat as number, 4));
    expect(next.leadSeat).not.toBe(winnerSeat);
    expect(next.wonTricks).toEqual([]);
    expect(next.tricksWon).toEqual([0, 0, 0, 0]);
    expect(next.bets).toEqual([null, null, null, null]);
    expect(next.roundScores.map((scores) => scores.length)).toEqual([1, 1, 1, 1]);
  });

  it('un montón sin ficha cuando el ganador no había apostado esa baza; el primer K gana, no el Mano', () => {
    const { state } = round1Playing([['5-picas'], ['K-picas'], ['K-corazones'], ['2-treboles']]);
    let current = state;
    let events;
    for (const [position, cardId] of ['5-picas', 'K-picas', 'K-corazones', '2-treboles'].entries()) {
      ({ state: current, events } = must(
        current,
        { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, position), cardId },
        rng(),
      ));
    }
    const winnerSeat = state.players.findIndex((p) => p.id === playerAtPosition(state, 1));
    expect(events!.find((e) => e.type === 'BAZA_RESUELTA')).toMatchObject({
      winnerSeat,
      hasChip: false, // apostó 0 y ganó 1
    });
    expect(current.leadSeat).toBe(winnerSeat);
  });

  it('el Comodín gana la baza aunque haya Ases', () => {
    const { state } = round1Playing([['A-picas'], ['A-corazones'], ['COMODIN'], ['A-treboles']]);
    let current = state;
    for (const [position, cardId] of ['A-picas', 'A-corazones', 'COMODIN', 'A-treboles'].entries()) {
      current = must(current, { type: 'JUGAR_CARTA', playerId: playerAtPosition(state, position), cardId }, rng()).state;
    }
    const winnerSeat = state.players.findIndex((p) => p.id === playerAtPosition(state, 2));
    expect(current.wonTricks[0]!.winnerSeat).toBe(winnerSeat);
    expect(current.wonTricks[0]!.winningCard.id).toBe('COMODIN');
  });

  it('AVANZAR no tiene efecto válido mientras se apuesta o se juega', () => {
    const { state } = startedGame(4, 2);
    const result = apply(state, { type: 'AVANZAR' }, rng());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ESTADO_INVALIDO');
  });
});

describe('piloto automático', () => {
  it('apuesta el menor valor válido y lo marca como piloto', () => {
    let { state } = startedGame(4, 21);
    state = must(state, { type: 'APOSTAR', playerId: playerAtPosition(state, 0), value: 1 }, rng()).state;
    for (const position of [1, 2]) {
      const step = must(state, { type: 'PILOTO_AUTOMATICO', playerId: playerAtPosition(state, position) }, rng());
      expect(step.events[0]).toMatchObject({ type: 'APUESTA_REALIZADA', value: 0, porPiloto: true });
      state = step.state;
    }
    // El Pié tiene prohibido el 0 (1 + 0 + 0 = 1 = N): el piloto apuesta 1.
    const pie = must(state, { type: 'PILOTO_AUTOMATICO', playerId: playerAtPosition(state, 3) }, rng());
    expect(pie.events[0]).toMatchObject({ type: 'APUESTA_REALIZADA', value: 1, porPiloto: true });
    expect(pie.state.phase).toBe('PLAYING');
  });

  it('juega la carta de menor valor de la mano', () => {
    const { state } = round1Playing([['K-picas', '3-picas', '3-corazones', 'A-picas'], ['K-corazones'], ['2-picas'], ['2-treboles']]);
    const seat = state.leadSeat as number;
    expect(autopilotChoice(state, seat)).toEqual({ type: 'JUGAR_CARTA', cardId: '3-corazones' });
    const step = must(state, { type: 'PILOTO_AUTOMATICO', playerId: playerIdAt(state, seat) }, rng());
    expect(step.events[0]).toMatchObject({ type: 'CARTA_JUGADA', porPiloto: true });
    expect((step.events[0] as { card: { id: string } }).card.id).toBe('3-corazones');
  });

  it('lowestCard desempata por identificador y devuelve undefined con la mano vacía', () => {
    const hand = ['K-picas', '3-picas', '3-corazones'].map((id) => getCardById(id)!);
    expect(lowestCard(hand)?.id).toBe('3-corazones');
    expect(lowestCard([])).toBeUndefined();
  });

  it('rechaza actuar por un jugador que no tiene el turno o fuera de fase', () => {
    const { state } = startedGame(4, 21);
    const wrong = apply(state, { type: 'PILOTO_AUTOMATICO', playerId: playerAtPosition(state, 2) }, rng());
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('NO_ES_TU_TURNO');

    const ready = apply(newGame(4), { type: 'PILOTO_AUTOMATICO', playerId: 'p0' }, rng());
    expect(ready.ok).toBe(false);
    if (!ready.ok) expect(ready.error.code).toBe('ESTADO_INVALIDO');
  });
});

describe('fin y aborto del juego', () => {
  it('un juego terminado rechaza cualquier acción', () => {
    const { final } = runRandomGame(5, 7);
    expect(final.phase).toBe('FINISHED');
    for (const action of [
      { type: 'AVANZAR' as const },
      { type: 'INICIAR_JUEGO' as const },
      { type: 'APOSTAR' as const, playerId: 'p0', value: 0 },
      { type: 'ABORTAR_JUEGO' as const, reason: 'x' },
    ]) {
      const result = apply(final, action, rng());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('JUEGO_TERMINADO');
    }
  });

  it('abortar un juego en curso lo deja en ABORTED y no admite más acciones', () => {
    const { state } = startedGame(4, 9);
    const aborted = must(state, { type: 'ABORTAR_JUEGO', reason: 'sin humanos conectados' }, rng()).state;
    expect(aborted.phase).toBe('ABORTED');
    expect(aborted.abortReason).toBe('sin humanos conectados');
    const result = apply(aborted, { type: 'APOSTAR', playerId: 'p0', value: 0 }, rng());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('JUEGO_TERMINADO');
  });
});
