import { describe, expect, it } from 'vitest';
import {
  bettingOrder,
  buildRanking,
  chipsRemaining,
  createSeededRng,
  determineTrickWinner,
  drawForDealer,
  forbiddenBet,
  getCardById,
  hasChip,
  highestDrawers,
  initialLead,
  lastBettor,
  nextDealer,
  playOrder,
  rightOf,
  roundPoints,
  validateBet,
  validBets,
  winnersOf,
  type Play,
} from '../src/index';

/** Arma tiradas en orden de turno a partir de ids de carta. */
function plays(...ids: string[]): Play[] {
  return ids.map((id, seat) => ({ seat, card: getCardById(id)! }));
}

describe('mesa: todo gira hacia la derecha', () => {
  it('la derecha de un asiento es el siguiente, de forma circular', () => {
    expect(rightOf(0, 5)).toBe(1);
    expect(rightOf(4, 5)).toBe(0);
  });

  it('el orden de apuesta empieza a la derecha del repartidor y termina en el Pié (el repartidor)', () => {
    expect(bettingOrder(2, 5)).toEqual([3, 4, 0, 1, 2]);
    expect(bettingOrder(4, 5)).toEqual([0, 1, 2, 3, 4]);
    for (let n = 4; n <= 7; n++) {
      for (let dealer = 0; dealer < n; dealer++) {
        expect(bettingOrder(dealer, n).at(-1)).toBe(lastBettor(dealer));
        expect(bettingOrder(dealer, n)[0]).toBe(initialLead(dealer, n));
      }
    }
  });

  it('el repartidor siguiente y el Mano inicial son el jugador a la derecha', () => {
    expect(nextDealer(3, 6)).toBe(4);
    expect(nextDealer(5, 6)).toBe(0);
    expect(initialLead(5, 6)).toBe(0);
  });

  it('el orden de tirada empieza en el Mano y gira a la derecha', () => {
    expect(playOrder(3, 5)).toEqual([3, 4, 0, 1, 2]);
    expect(playOrder(0, 4)).toEqual([0, 1, 2, 3]);
  });
});

describe('ganador de la baza', () => {
  it('Mano tira K y luego K, K, Q: gana el Mano', () => {
    const result = determineTrickWinner(plays('K-picas', 'K-corazones', 'K-treboles', 'Q-picas'));
    expect(result.seat).toBe(0);
  });

  it('Mano tira 5 y luego J, K, K: gana el primero que tiró K (no el Mano)', () => {
    const result = determineTrickWinner(plays('5-picas', 'J-picas', 'K-picas', 'K-corazones'));
    expect(result.seat).toBe(2);
  });

  it('el Comodín le gana al As', () => {
    expect(determineTrickWinner(plays('A-picas', 'COMODIN', '3-picas', 'A-corazones')).seat).toBe(1);
  });

  it('Mano tira 10 y le siguen 3, 7, 2: gana el Mano', () => {
    expect(determineTrickWinner(plays('10-picas', '3-picas', '7-picas', '2-picas')).seat).toBe(0);
  });

  it('el Mano puede abrir con el Comodín y gana', () => {
    expect(determineTrickWinner(plays('COMODIN', 'A-picas', 'A-corazones', 'K-picas')).seat).toBe(0);
  });

  it('con empate en el valor más alto gana quien lo tiró primero, sin importar el palo', () => {
    expect(determineTrickWinner(plays('2-picas', '9-treboles', '9-picas', '9-corazones')).seat).toBe(1);
  });

  it('una baza de una sola carta la gana quien la tiró; sin tiradas es un error', () => {
    expect(determineTrickWinner(plays('2-picas')).seat).toBe(0);
    expect(() => determineTrickWinner([])).toThrow();
  });

  it('un jugador posterior con una carta menor o igual no le quita la baza al anterior', () => {
    // Quien necesita perder puede descartar una J si alguien antes ya tiró J o más.
    expect(determineTrickWinner(plays('J-picas', 'J-corazones', '2-picas', '5-picas')).seat).toBe(0);
    expect(determineTrickWinner(plays('Q-picas', 'J-corazones', 'J-picas', '5-picas')).seat).toBe(0);
  });
});

describe('fichas de los montones', () => {
  it('hay ficha mientras las bazas ganadas (incluida la actual) no superen la apuesta', () => {
    expect(hasChip(1, 2)).toBe(true);
    expect(hasChip(2, 2)).toBe(true);
    expect(hasChip(3, 2)).toBe(false);
    expect(hasChip(1, 0)).toBe(false);
  });

  it('fichas restantes = apuesta - bazas ganadas, sin bajar de cero', () => {
    expect(chipsRemaining(3, 1)).toBe(2);
    expect(chipsRemaining(1, 4)).toBe(0);
  });
});

describe('apuestas y restricción del Pié', () => {
  it('ejemplo oficial: en una partida de 6 cartas, si los anteriores suman 5, el Pié no puede apostar 1', () => {
    expect(forbiddenBet(6, [2, 1, 0, 2])).toBe(1);
    expect(validateBet(6, 1, true, [2, 1, 0, 2])).toBe('APUESTA_PROHIBIDA_PIE');
    expect(validateBet(6, 0, true, [2, 1, 0, 2])).toBeNull();
    expect(validBets(6, true, [2, 1, 0, 2])).toEqual([0, 2, 3, 4, 5, 6]);
  });

  it('partida de 1 carta: si todos apostaron 0, el Pié no puede apostar 1', () => {
    expect(validBets(1, true, [0, 0, 0])).toEqual([0]);
    expect(validateBet(1, 1, true, [0, 0, 0])).toBe('APUESTA_PROHIBIDA_PIE');
  });

  it('si la suma previa ya supera N no hay restricción efectiva', () => {
    expect(forbiddenBet(3, [2, 2])).toBeNull();
    expect(validBets(3, true, [2, 2])).toEqual([0, 1, 2, 3]);
  });

  it('solo el Pié tiene restricción; los demás pueden apostar de 0 a N', () => {
    expect(validBets(4, false, [1, 1, 1])).toEqual([0, 1, 2, 3, 4]);
    expect(validateBet(4, 1, false, [1, 1, 1])).toBeNull();
  });

  it('rechaza apuestas fuera de 0..N, negativas o no enteras', () => {
    expect(validateBet(5, 6, false, [])).toBe('APUESTA_FUERA_DE_RANGO');
    expect(validateBet(5, -1, false, [])).toBe('APUESTA_FUERA_DE_RANGO');
    expect(validateBet(5, 2.5, false, [])).toBe('APUESTA_FUERA_DE_RANGO');
    expect(validateBet(5, Number.NaN, false, [])).toBe('APUESTA_FUERA_DE_RANGO');
    expect(validateBet(5, 0, false, [])).toBeNull();
    expect(validateBet(5, 5, false, [])).toBeNull();
  });

  it('el Pié siempre tiene al menos una apuesta válida (cualquier N, cualquier suma previa)', () => {
    for (let cards = 1; cards <= 7; cards++) {
      for (let previous = 0; previous <= 7 * cards; previous++) {
        expect(validBets(cards, true, [previous]).length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('puntuación', () => {
  it('ejemplos oficiales: apostar 2 y ganar 2 = 7; apostar 0 y ganar 0 = 5', () => {
    expect(roundPoints(2, 2)).toBe(7);
    expect(roundPoints(0, 0)).toBe(5);
  });

  it('cualquier fallo, por más o por menos, da 0 puntos', () => {
    expect(roundPoints(2, 1)).toBe(0);
    expect(roundPoints(2, 3)).toBe(0);
    expect(roundPoints(0, 1)).toBe(0);
    expect(roundPoints(4, 0)).toBe(0);
  });

  it('el máximo por partida es 5 + N', () => {
    expect(roundPoints(7, 7)).toBe(12);
  });

  it('los puntos base son configurables', () => {
    expect(roundPoints(2, 2, 10)).toBe(12);
  });
});

describe('ranking y desempate', () => {
  it('gana el mayor total acumulado', () => {
    const ranking = buildRanking([[5, 6], [7, 7], [0, 5]]);
    expect(ranking.map((r) => [r.seat, r.total, r.position])).toEqual([
      [1, 14, 1],
      [0, 11, 2],
      [2, 5, 3],
    ]);
  });

  it('desempata por el mejor puntaje en una sola partida', () => {
    // Ambos suman 15; el asiento 1 tuvo un 8, el asiento 0 solo un 7.
    const ranking = buildRanking([[7, 5, 3], [8, 7, 0]]);
    expect(ranking[0]).toMatchObject({ seat: 1, position: 1 });
    expect(ranking[1]).toMatchObject({ seat: 0, position: 2 });
  });

  it('si el mejor puntaje empata se compara el segundo mejor, y así sucesivamente', () => {
    const ranking = buildRanking([
      [8, 6, 1],
      [8, 5, 2],
    ]);
    expect(ranking[0]).toMatchObject({ seat: 0, position: 1 });
    const tercero = buildRanking([
      [8, 5, 2, 0],
      [8, 5, 1, 1],
    ]);
    expect(tercero[0]).toMatchObject({ seat: 0, position: 1 });
  });

  it('un mismo valor repetido en dos partidas cuenta como dos elementos', () => {
    const ranking = buildRanking([
      [6, 6, 0],
      [6, 5, 1],
    ]);
    expect(ranking[0]).toMatchObject({ seat: 0, position: 1 });
  });

  it('si todo coincide se comparte el podio', () => {
    const ranking = buildRanking([[7, 5], [5, 7], [0, 5]]);
    expect(ranking.map((r) => r.position)).toEqual([1, 1, 3]);
    expect(winnersOf(ranking).map((r) => r.seat).sort()).toEqual([0, 1]);
  });
});

describe('sorteo inicial del repartidor', () => {
  it('quien saca el valor más alto empieza repartiendo', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { rounds, dealerSeat } = drawForDealer(5, createSeededRng(seed));
      const last = rounds.at(-1)!;
      expect(highestDrawers(last.draws)).toEqual([dealerSeat]);
    }
  });

  it('con empate vuelven a sacar solo los empatados, las veces que haga falta', () => {
    let found = 0;
    for (let seed = 0; seed < 400; seed++) {
      const { rounds } = drawForDealer(6, createSeededRng(seed));
      for (let i = 1; i < rounds.length; i++) {
        const previousTop = highestDrawers(rounds[i - 1]!.draws);
        expect(rounds[i]!.draws.map((d) => d.seat)).toEqual(previousTop);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('en cada vuelta nadie saca la misma carta dos veces', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { rounds } = drawForDealer(7, createSeededRng(seed));
      for (const round of rounds) {
        const ids = round.draws.map((d) => d.card.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('el Comodín es el valor más alto del sorteo', () => {
    const draws = [
      { seat: 0, card: getCardById('A-picas')! },
      { seat: 1, card: getCardById('COMODIN')! },
      { seat: 2, card: getCardById('A-corazones')! },
    ];
    expect(highestDrawers(draws)).toEqual([1]);
    expect(highestDrawers(draws.slice(0, 1).concat(draws.slice(2)))).toEqual([0, 2]);
  });
});
