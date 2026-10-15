import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  cardValue,
  CARDS_PER_ROUND,
  createCryptoRng,
  createSeededRng,
  DECK_SIZE,
  getCardById,
  JOKER_ID,
  RANK_LABELS,
  shuffle,
  SUITS,
  validateDeck,
} from '../src/index';

describe('mazo', () => {
  it('tiene 53 cartas únicas: 13 valores x 4 palos + 1 Comodín', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map((card) => card.id)).size).toBe(53);
    expect(deck.filter((card) => card.isJoker)).toHaveLength(1);
    for (const suit of SUITS) {
      expect(deck.filter((card) => card.suit === suit)).toHaveLength(13);
    }
    for (const [index, label] of RANK_LABELS.entries()) {
      expect(deck.filter((card) => card.rank === index + 2 && !card.isJoker)).toHaveLength(4);
      expect(getCardById(`${label}-picas`)?.rank).toBe(index + 2);
    }
  });

  it('respeta el orden 2 < ... < 10 < J < Q < K < A < Comodín', () => {
    const value = (id: string): number => cardValue(getCardById(id)!);
    expect(value('2-picas')).toBe(2);
    expect(value('10-corazones')).toBe(10);
    expect(value('J-picas')).toBeLessThan(value('Q-picas'));
    expect(value('Q-picas')).toBeLessThan(value('K-picas'));
    expect(value('K-picas')).toBeLessThan(value('A-picas'));
    expect(value(JOKER_ID)).toBeGreaterThan(value('A-picas'));
  });

  it('los palos no influyen en el valor', () => {
    for (const label of RANK_LABELS) {
      const values = new Set(SUITS.map((suit) => cardValue(getCardById(`${label}-${suit}`)!)));
      expect(values.size).toBe(1);
    }
  });

  it('getCardById devuelve undefined para ids inexistentes', () => {
    expect(getCardById('1-picas')).toBeUndefined();
    expect(getCardById('X-oros')).toBeUndefined();
    expect(getCardById('')).toBeUndefined();
  });

  it('validateDeck acepta el mazo correcto y detecta problemas', () => {
    expect(validateDeck(buildDeck())).toEqual([]);

    const deck = buildDeck();
    expect(validateDeck(deck.slice(1)).join('|')).toContain('Falta la carta');
    expect(validateDeck([...deck, deck[0]!]).join('|')).toContain('Carta repetida');
    const sinComodin = deck.filter((card) => !card.isJoker);
    expect(validateDeck(sinComodin).join('|')).toContain('exactamente 1 Comodín');
    const falsa = { id: 'Z-picas', rank: 2, suit: 'picas' as const, isJoker: false };
    expect(validateDeck([...deck.slice(1), falsa]).join('|')).toContain('Carta inexistente');
  });
});

describe('configuración', () => {
  it('cartas por partida: 14 partidas con 56 bazas en total', () => {
    expect(CARDS_PER_ROUND).toEqual([1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1]);
    expect(CARDS_PER_ROUND.reduce((a, b) => a + b, 0)).toBe(56);
  });
});

describe('azar', () => {
  it('la mezcla conserva las cartas y no modifica el original', () => {
    const deck = buildDeck();
    const copy = [...deck];
    const mixed = shuffle(deck, createSeededRng(1));
    expect(deck).toEqual(copy);
    expect(validateDeck(mixed)).toEqual([]);
    expect(mixed.map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
  });

  it('la misma semilla produce la misma mezcla; otra semilla, otra', () => {
    const a = shuffle(buildDeck(), createSeededRng(42)).map((c) => c.id);
    const b = shuffle(buildDeck(), createSeededRng(42)).map((c) => c.id);
    const c = shuffle(buildDeck(), createSeededRng(43)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('nextInt respeta el rango y rechaza máximos inválidos', () => {
    for (const rng of [createSeededRng(7), createCryptoRng()]) {
      for (let i = 0; i < 500; i++) {
        const value = rng.nextInt(5);
        expect(Number.isInteger(value) && value >= 0 && value < 5).toBe(true);
      }
      expect(rng.nextInt(1)).toBe(0);
      expect(() => rng.nextInt(0)).toThrow(RangeError);
      expect(() => rng.nextInt(2.5)).toThrow(RangeError);
    }
  });

  it('la mezcla criptográfica también conserva las cartas', () => {
    expect(validateDeck(shuffle(buildDeck(), createCryptoRng()))).toEqual([]);
  });
});
