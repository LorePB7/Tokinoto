import type { RankingEntry } from './tipos';

interface Strength {
  seat: number;
  total: number;
  /** Puntajes por partida, de mayor a menor. */
  sorted: number[];
}

/** > 0 si `a` es mejor que `b`, < 0 si es peor, 0 si empatan en todo. */
function compareStrength(a: Strength, b: Strength): number {
  if (a.total !== b.total) return a.total - b.total;
  const length = Math.max(a.sorted.length, b.sorted.length);
  for (let i = 0; i < length; i++) {
    const diff = (a.sorted[i] ?? 0) - (b.sorted[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Ranking final. Gana el mayor puntaje total acumulado. Desempate: el mayor
 * puntaje en una sola partida; si persiste, el segundo mejor, y así
 * sucesivamente. Si todo coincide, se comparte el puesto (podio compartido).
 *
 * @param roundScores puntos por partida: roundScores[asiento][indiceDePartida]
 */
export function buildRanking(roundScores: readonly (readonly number[])[]): RankingEntry[] {
  const strengths: Strength[] = roundScores.map((scores, seat) => ({
    seat,
    total: scores.reduce((acc, points) => acc + points, 0),
    sorted: [...scores].sort((a, b) => b - a),
  }));
  strengths.sort((a, b) => compareStrength(b, a) || a.seat - b.seat);

  const ranking: RankingEntry[] = [];
  strengths.forEach((entry, index) => {
    const previous = strengths[index - 1];
    const previousRank = ranking[index - 1];
    const position =
      previous && previousRank && compareStrength(entry, previous) === 0
        ? previousRank.position
        : index + 1;
    ranking.push({ seat: entry.seat, total: entry.total, position });
  });
  return ranking;
}

/** Ganadores: todos los que ocupan el primer puesto (puede ser más de uno). */
export function winnersOf(ranking: readonly RankingEntry[]): RankingEntry[] {
  return ranking.filter((entry) => entry.position === 1);
}
