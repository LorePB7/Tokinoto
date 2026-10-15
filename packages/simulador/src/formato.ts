import { RANK_LABELS, type Card, type Suit } from '@tokinoto/reglas';

const SIMBOLOS: Record<Suit, string> = {
  picas: '♠',
  corazones: '♥',
  diamantes: '♦',
  treboles: '♣',
};

/** Texto corto de una carta para mostrar en consola. Ej: "K♠", "10♥", "Comodín". */
export function textoCarta(card: Card): string {
  if (card.isJoker || card.suit === null) return 'Comodín';
  return `${RANK_LABELS[card.rank - 2]}${SIMBOLOS[card.suit]}`;
}

const numero = new Intl.NumberFormat('es-AR');
const decimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatearEntero(value: number): string {
  return numero.format(value);
}

export function formatearDecimal(value: number): string {
  return decimal.format(value);
}

/** Porcentaje con un decimal. Devuelve "-" si no hay base para calcularlo. */
export function formatearPorcentaje(parte: number, total: number): string {
  return total === 0 ? '-' : `${formatearDecimal((parte / total) * 100)} %`;
}
