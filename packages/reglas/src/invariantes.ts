import { getCardById } from './cartas';
import { bettingOrder } from './mesa';
import type { GameState } from './tipos';

/**
 * Chequeo de integridad de un estado. Devuelve la lista de violaciones
 * encontradas (vacía si todo está bien). Pensado para pruebas y para
 * detectar errores del servidor; no es parte del flujo de juego.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const n = state.players.length;
  const cards = state.cardsPerPlayer;
  const started = state.roundNumber > 0;

  if (started) {
    if (state.dealerSeat === null || state.dealerSeat < 0 || state.dealerSeat >= n) {
      problems.push('Repartidor inválido');
    } else if (bettingOrder(state.dealerSeat, n).at(-1) !== state.dealerSeat) {
      problems.push('El Pié no es el repartidor');
    }

    // Cartas únicas y existentes entre manos, baza en curso y bazas ganadas.
    const ids: string[] = [];
    state.hands.forEach((hand) => hand.forEach((card) => ids.push(card.id)));
    const trick = state.currentTrick;
    trick?.plays.forEach((play) => ids.push(play.card.id));
    state.wonTricks.forEach((won) => {
      const isCurrentResolved = trick !== null && trick.winnerSeat !== null && won.trickNumber === trick.number;
      if (!isCurrentResolved) ids.push(won.winningCard.id);
    });
    if (new Set(ids).size !== ids.length) problems.push('Hay cartas repetidas en juego');
    for (const id of ids) {
      if (!getCardById(id)) problems.push(`Carta inexistente: ${id}`);
    }

    // Tamaño de las manos según el avance de la partida.
    if (state.phase === 'BETTING') {
      state.hands.forEach((hand, seat) => {
        if (hand.length !== cards) problems.push(`Mano del asiento ${seat} con ${hand.length} cartas, esperaba ${cards}`);
      });
    }
    if (state.phase === 'PLAYING' || state.phase === 'TRICK_RESOLUTION') {
      state.hands.forEach((hand, seat) => {
        const inFlight = trick && trick.winnerSeat === null && trick.plays.some((play) => play.seat === seat) ? 1 : 0;
        const expected = cards - state.wonTricks.length - inFlight;
        if (hand.length !== expected) problems.push(`Mano del asiento ${seat} con ${hand.length} cartas, esperaba ${expected}`);
      });
    }

    // Apuestas.
    const allBetsIn = state.bets.every((bet) => bet !== null);
    if (state.phase !== 'BETTING' && !allBetsIn && state.phase !== 'ABORTED') {
      problems.push('Falta alguna apuesta fuera de la fase de apuestas');
    }
    if (allBetsIn) {
      const sum = state.bets.reduce<number>((acc, bet) => acc + (bet ?? 0), 0);
      if (sum === cards) problems.push('La suma de apuestas es igual a la cantidad de cartas (restricción del Pié violada)');
      state.bets.forEach((bet, seat) => {
        if (bet !== null && (!Number.isInteger(bet) || bet < 0 || bet > cards)) {
          problems.push(`Apuesta fuera de rango en el asiento ${seat}`);
        }
      });
    }

    // Bazas ganadas.
    const wonSum = state.tricksWon.reduce((acc, won) => acc + won, 0);
    if (wonSum !== state.wonTricks.length) problems.push('Bazas ganadas no coinciden con los montones');
    if (wonSum > cards) problems.push('Más bazas ganadas que cartas por jugador');
    if (state.phase === 'ROUND_SUMMARY' && wonSum !== cards) {
      problems.push('Al cerrar la partida la suma de bazas ganadas no es N');
    }
  }

  // Puntajes.
  const lengths = new Set(state.roundScores.map((scores) => scores.length));
  if (lengths.size > 1) problems.push('Los puntajes por partida tienen largos distintos entre jugadores');
  const completedRounds = state.roundScores[0]?.length ?? 0;
  for (let round = 0; round < completedRounds; round++) {
    const roundCards = state.config.cardsPerRound[round] as number;
    const column = state.roundScores.map((scores) => scores[round] as number);
    column.forEach((points, seat) => {
      if (points < 0 || points > state.config.basePoints + roundCards) {
        problems.push(`Puntaje fuera de rango en el asiento ${seat}, partida ${round + 1}`);
      }
    });
    if (!column.some((points) => points === 0)) {
      problems.push(`En la partida ${round + 1} nadie falló: es imposible con la restricción del Pié`);
    }
  }

  if (state.phase === 'FINISHED') {
    if (!state.ranking) problems.push('Juego terminado sin ranking');
    if (completedRounds !== state.config.cardsPerRound.length) problems.push('Juego terminado sin las 14 partidas');
  }

  return problems;
}
