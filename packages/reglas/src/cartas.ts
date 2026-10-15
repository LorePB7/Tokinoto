import type { Card, Suit } from './tipos';

export const SUITS: readonly Suit[] = ['picas', 'corazones', 'diamantes', 'treboles'];
export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export const JOKER_ID = 'COMODIN';
/** El Comodín es la carta de mayor jerarquía: la única que le gana al As. */
export const JOKER_VALUE = 15;
/** 52 cartas (2 al As en 4 palos) + 1 Comodín. */
export const DECK_SIZE = 53;

/** Construye el mazo canónico de 53 cartas, en orden fijo (sin barajar). */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    RANK_LABELS.forEach((label, index) => {
      cards.push({ id: `${label}-${suit}`, rank: index + 2, suit, isJoker: false });
    });
  }
  cards.push({ id: JOKER_ID, rank: JOKER_VALUE, suit: null, isJoker: true });
  return cards;
}

const CANONICAL_DECK: readonly Card[] = buildDeck();
const CARD_BY_ID: ReadonlyMap<string, Card> = new Map(CANONICAL_DECK.map((card) => [card.id, card]));

/** Devuelve la carta canónica para un identificador, o undefined si no existe. */
export function getCardById(id: string): Card | undefined {
  return CARD_BY_ID.get(id);
}

/** Valor numérico de una carta. Los palos no influyen. */
export function cardValue(card: Card): number {
  return card.rank;
}

/**
 * Chequeo de integridad de un mazo. Devuelve la lista de problemas
 * encontrados (vacía si el mazo es correcto).
 */
export function validateDeck(cards: readonly Card[]): string[] {
  const problems: string[] = [];
  if (cards.length !== DECK_SIZE) {
    problems.push(`El mazo tiene ${cards.length} cartas y debería tener ${DECK_SIZE}`);
  }
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) problems.push(`Carta repetida: ${card.id}`);
    seen.add(card.id);
    if (!CARD_BY_ID.has(card.id)) problems.push(`Carta inexistente: ${card.id}`);
  }
  const jokers = cards.filter((card) => card.isJoker).length;
  if (jokers !== 1) problems.push(`Debe haber exactamente 1 Comodín y hay ${jokers}`);
  for (const id of CARD_BY_ID.keys()) {
    if (!seen.has(id)) problems.push(`Falta la carta: ${id}`);
  }
  return problems;
}
