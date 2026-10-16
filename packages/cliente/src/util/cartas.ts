import { getCardById, type Suit } from '@tokinoto/reglas';

export const SIMBOLO_PALO: Record<Suit, string> = {
  picas: '♠',
  corazones: '♥',
  diamantes: '♦',
  treboles: '♣',
};

const ORDEN_PALO: Record<Suit, number> = { picas: 0, corazones: 1, treboles: 2, diamantes: 3 };

export interface InfoCarta {
  id: string;
  /** "2" a "10", "J", "Q", "K", "A"; "★" para el Comodín. */
  rango: string;
  palo: Suit | null;
  simbolo: string;
  esComodin: boolean;
  rojo: boolean;
  /** Valor para comparar (2 a 15). */
  valor: number;
  /** Texto corto, por ejemplo "K♠" o "Comodín". */
  texto: string;
  /** Texto para lectores de pantalla, por ejemplo "K de picas". */
  nombre: string;
}

export function infoCarta(id: string): InfoCarta {
  const carta = getCardById(id);
  if (!carta) throw new Error(`Carta desconocida: ${id}`);
  if (carta.isJoker || carta.suit === null) {
    return {
      id,
      rango: '★',
      palo: null,
      simbolo: '★',
      esComodin: true,
      rojo: false,
      valor: carta.rank,
      texto: 'Comodín',
      nombre: 'Comodín',
    };
  }
  const rango = id.slice(0, id.indexOf('-'));
  const simbolo = SIMBOLO_PALO[carta.suit];
  return {
    id,
    rango,
    palo: carta.suit,
    simbolo,
    esComodin: false,
    rojo: carta.suit === 'corazones' || carta.suit === 'diamantes',
    valor: carta.rank,
    texto: `${rango}${simbolo}`,
    nombre: `${rango} de ${carta.suit === 'treboles' ? 'tréboles' : carta.suit}`,
  };
}

/** Ordena para mostrar la mano: de menor a mayor valor, y por palo dentro del mismo valor. */
export function ordenarMano(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const x = infoCarta(a);
    const y = infoCarta(b);
    if (x.valor !== y.valor) return x.valor - y.valor;
    return (x.palo ? ORDEN_PALO[x.palo] : 9) - (y.palo ? ORDEN_PALO[y.palo] : 9);
  });
}
