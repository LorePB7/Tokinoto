/**
 * Fuente de azar inyectable. El motor nunca llama a Math.random: el azar
 * entra siempre desde afuera, así las pruebas usan una semilla fija y el
 * servidor usa una fuente criptográficamente segura.
 */
export interface Rng {
  /** Entero uniforme en [0, maxExclusive). maxExclusive debe ser un entero >= 1. */
  nextInt(maxExclusive: number): number;
}

function assertValidMax(maxExclusive: number): void {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError(`maxExclusive inválido: ${maxExclusive}`);
  }
}

/** Generador determinista (mulberry32) para pruebas y reproducción de juegos. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nextInt(maxExclusive: number): number {
      assertValidMax(maxExclusive);
      return Math.floor(next() * maxExclusive);
    },
  };
}

/**
 * Generador criptográfico para producción. Usa muestreo por rechazo para
 * evitar sesgo de módulo. Requiere globalThis.crypto (Node 19+ y navegadores).
 */
export function createCryptoRng(): Rng {
  const buffer = new Uint32Array(1);
  const range = 0x100000000;
  return {
    nextInt(maxExclusive: number): number {
      assertValidMax(maxExclusive);
      const limit = range - (range % maxExclusive);
      for (;;) {
        globalThis.crypto.getRandomValues(buffer);
        const value = buffer[0] as number;
        if (value < limit) return value % maxExclusive;
      }
    },
  };
}

/** Mezcla Fisher-Yates. No modifica el arreglo recibido. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}
