/**
 * Orden de mesa. Todo gira hacia la DERECHA: el asiento a la derecha del
 * asiento i es el siguiente (i + 1), de forma circular.
 */

export function rightOf(seat: number, playerCount: number): number {
  return (seat + 1) % playerCount;
}

/** Repartidor de la partida siguiente: el jugador a la derecha del repartidor. */
export function nextDealer(dealerSeat: number, playerCount: number): number {
  return rightOf(dealerSeat, playerCount);
}

/** El Mano inicial de cada partida es el jugador a la derecha del repartidor. */
export function initialLead(dealerSeat: number, playerCount: number): number {
  return rightOf(dealerSeat, playerCount);
}

/** El Pié (último en apostar) es siempre el repartidor. */
export function lastBettor(dealerSeat: number): number {
  return dealerSeat;
}

/** Orden de apuesta: desde el Mano inicial hasta el Pié (el repartidor). */
export function bettingOrder(dealerSeat: number, playerCount: number): number[] {
  const order: number[] = [];
  for (let i = 1; i <= playerCount; i++) order.push((dealerSeat + i) % playerCount);
  return order;
}

/** Orden de tirada de una baza: desde el Mano hacia la derecha. */
export function playOrder(leadSeat: number, playerCount: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < playerCount; i++) order.push((leadSeat + i) % playerCount);
  return order;
}
