import { describe, expect, it } from 'vitest';
import { jugarTorneo } from '../src/torneo';

/**
 * Fuerza relativa de los bots: lo que se promete es el orden
 * difícil > medio > fácil. Las semillas son fijas, así el resultado es
 * reproducible. Para ajustar los niveles: `npm run torneo -w @tokinoto/simulador`.
 */
describe('fuerza de los bots', () => {
  const puntos = (r: ReturnType<typeof jugarTorneo>, nivel: string): number =>
    r.filas.find((f) => f.participante === nivel)?.puntosPorJuego ?? 0;

  it('medio suma claramente más que fácil, y fácil más que tirar al azar', () => {
    const r = jugarTorneo({ juegos: 120, jugadores: 'todos', semilla: 1, participantes: ['facil', 'medio', 'azar'] });
    expect(r.fallos).toEqual([]);
    expect(puntos(r, 'medio')).toBeGreaterThan(puntos(r, 'facil') + 10);
    expect(puntos(r, 'facil')).toBeGreaterThan(puntos(r, 'azar') + 10);
  }, 120_000);

  it('difícil suma más que medio', () => {
    const r = jugarTorneo({ juegos: 30, jugadores: 4, semilla: 1, participantes: ['medio', 'dificil'] });
    expect(r.fallos).toEqual([]);
    expect(puntos(r, 'dificil')).toBeGreaterThan(puntos(r, 'medio') + 3);
  }, 120_000);
});
