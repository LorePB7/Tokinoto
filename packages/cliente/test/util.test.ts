// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { infoCarta, ordenarMano } from '../src/util/cartas';
import { haciaElCentro, posicionAsiento } from '../src/util/geometria';
import { buildDeck } from '@tokinoto/reglas';

describe('infoCarta', () => {
  it('describe todas las cartas del mazo sin fallar', () => {
    const mazo = buildDeck();
    expect(mazo).toHaveLength(53);
    for (const c of mazo) expect(infoCarta(c.id).texto.length).toBeGreaterThan(0);
  });

  it('marca el Comodín y los palos rojos', () => {
    const mazo = buildDeck();
    const comodines = mazo.filter((c) => infoCarta(c.id).esComodin);
    expect(comodines).toHaveLength(1);
    const rojas = mazo.filter((c) => infoCarta(c.id).rojo);
    expect(rojas).toHaveLength(26);
  });

  it('el Comodín vale más que el As, y el As más que el K', () => {
    const mazo = buildDeck();
    const valor = (rango: string) => Math.max(...mazo.map((c) => infoCarta(c.id)).filter((i) => i.rango === rango).map((i) => i.valor));
    expect(valor('★')).toBeGreaterThan(valor('A'));
    expect(valor('A')).toBeGreaterThan(valor('K'));
  });

  it('falla con una carta desconocida', () => {
    expect(() => infoCarta('zzz')).toThrow();
  });
});

describe('ordenarMano', () => {
  it('ordena de menor a mayor y no modifica la lista original', () => {
    const ids = buildDeck().slice(0, 12).map((c) => c.id).reverse();
    const copia = [...ids];
    const orden = ordenarMano(ids);
    expect(ids).toEqual(copia);
    expect(orden).toHaveLength(ids.length);
    const valores = orden.map((id) => infoCarta(id).valor);
    expect(valores).toEqual([...valores].sort((a, b) => a - b));
  });
});

describe('posicionAsiento', () => {
  it('yo estoy abajo en el centro', () => {
    for (const n of [4, 5, 6, 7]) {
      const p = posicionAsiento(2, 2, n);
      expect(p.x).toBeCloseTo(50);
      expect(p.y).toBeGreaterThan(80);
    }
  });

  it('el asiento siguiente queda a mi derecha (derecha de la pantalla)', () => {
    for (const n of [4, 5, 6, 7]) {
      expect(posicionAsiento(1, 0, n).x).toBeGreaterThan(50);
      expect(posicionAsiento(n - 1, 0, n).x).toBeLessThan(50);
    }
  });

  it('con 4 jugadores los asientos quedan abajo, derecha, arriba e izquierda', () => {
    const [a, b, c, d] = [0, 1, 2, 3].map((i) => posicionAsiento(i, 0, 4));
    expect(a?.y).toBeGreaterThan(80);
    expect(b?.x).toBeGreaterThan(80);
    expect(c?.y).toBeLessThan(20);
    expect(d?.x).toBeLessThan(20);
  });

  it('con 7 jugadores la ronda es simétrica, sigue girando hacia la derecha y deja más aire a mis vecinos', () => {
    const p = [0, 1, 2, 3, 4, 5, 6].map((i) => posicionAsiento(i, 0, 7));
    for (let i = 1; i < 7; i++) {
      const espejo = p[7 - i]!;
      expect(p[i]!.x).toBeCloseTo(100 - espejo.x);
      expect(p[i]!.y).toBeCloseTo(espejo.y);
    }
    // Hacia la derecha y luego arriba: x crece y y baja, hasta el asiento de arriba a la derecha.
    expect(p[1]!.x).toBeGreaterThan(50);
    expect(p[2]!.y).toBeLessThan(p[1]!.y);
    expect(p[3]!.y).toBeLessThan(p[2]!.y);
    // Mis vecinos quedan más lejos que con el reparto en partes iguales (51°).
    const igual = 50 + 41 * Math.sin((2 * Math.PI) / 7);
    expect(p[1]!.x).toBeGreaterThan(igual);
  });

  it('haciaElCentro interpola entre el centro y el punto', () => {
    expect(haciaElCentro({ x: 90, y: 50 }, 0)).toEqual({ x: 50, y: 50 });
    expect(haciaElCentro({ x: 90, y: 50 }, 1)).toEqual({ x: 90, y: 50 });
    expect(haciaElCentro({ x: 90, y: 50 }, 0.5)).toEqual({ x: 70, y: 50 });
  });
});
