import { describe, expect, it } from 'vitest';
import { getCardById } from '@tokinoto/reglas';
import { AYUDA, leerArgumentos } from '../src/argumentos';
import { ejecutarCorrida, jugadoresDelJuego, type ResultadoCorrida } from '../src/corrida';
import { estadisticasDe, estadisticasVacias, sumarEstadisticas } from '../src/estadisticas';
import { formatearPorcentaje, textoCarta } from '../src/formato';
import { comandoParaReproducir, formatearInforme } from '../src/informe';
import { simularJuego } from '../src/juego';
import { narrarJuego } from '../src/narracion';

describe('argumentos de la línea de comandos', () => {
  it('tiene valores por defecto razonables', () => {
    expect(leerArgumentos([])).toEqual({
      juegos: 1000,
      jugadores: 'todos',
      semilla: 1,
      detalle: false,
      verificar: true,
      ayuda: false,
    });
  });

  it('lee todas las opciones', () => {
    expect(
      leerArgumentos(['--juegos', '50', '--jugadores', '6', '--semilla', '9', '--detalle', '--sin-verificar']),
    ).toEqual({ juegos: 50, jugadores: 6, semilla: 9, detalle: true, verificar: false, ayuda: false });
    expect(leerArgumentos(['--jugadores', 'todos']).jugadores).toBe('todos');
    expect(leerArgumentos(['-h']).ayuda).toBe(true);
    expect(leerArgumentos(['--ayuda']).ayuda).toBe(true);
  });

  it('rechaza valores inválidos con mensajes en español', () => {
    expect(() => leerArgumentos(['--jugadores', '3'])).toThrow(/entre 4 y 7/);
    expect(() => leerArgumentos(['--jugadores', '8'])).toThrow(/entre 4 y 7/);
    expect(() => leerArgumentos(['--juegos', '0'])).toThrow(/entre 1/);
    expect(() => leerArgumentos(['--juegos', 'mucho'])).toThrow(/número entero/);
    expect(() => leerArgumentos(['--semilla=-4'])).toThrow(/número entero/);
    expect(() => leerArgumentos(['--semilla', '-4'])).toThrow(/falta el valor de una opción/);
    expect(() => leerArgumentos(['--semilla'])).toThrow(/falta el valor de una opción/);
    expect(() => leerArgumentos(['--semilla', '1.5'])).toThrow(/número entero/);
    expect(() => leerArgumentos(['--inventada'])).toThrow(/opción desconocida/);
    expect(() => leerArgumentos(['suelto'])).toThrow(/argumento suelto/);
  });

  it('la ayuda menciona todas las opciones', () => {
    for (const opcion of ['--juegos', '--jugadores', '--semilla', '--detalle', '--sin-verificar', '--ayuda']) {
      expect(AYUDA).toContain(opcion);
    }
  });
});

describe('formato', () => {
  it('muestra las cartas con su símbolo y el Comodín por nombre', () => {
    expect(textoCarta(getCardById('K-picas')!)).toBe('K♠');
    expect(textoCarta(getCardById('10-corazones')!)).toBe('10♥');
    expect(textoCarta(getCardById('2-diamantes')!)).toBe('2♦');
    expect(textoCarta(getCardById('A-treboles')!)).toBe('A♣');
    expect(textoCarta(getCardById('COMODIN')!)).toBe('Comodín');
  });

  it('el porcentaje sin base es "-"', () => {
    expect(formatearPorcentaje(1, 0)).toBe('-');
    expect(formatearPorcentaje(1, 4)).toBe('25,0 %');
  });
});

describe('simulación de un juego', () => {
  it('juega un juego completo sin violaciones, para cualquier cantidad de jugadores', () => {
    for (const jugadores of [4, 5, 6, 7]) {
      const juego = simularJuego({ jugadores, semilla: jugadores * 11 });
      expect(juego.violaciones).toEqual([]);
      expect(juego.final?.phase).toBe('FINISHED');
      expect(juego.pasos).toBeGreaterThan(100);
      expect(juego.eventos.filter((e) => e.type === 'BAZA_RESUELTA')).toHaveLength(56);
    }
  });

  it('es determinista: misma semilla, mismo juego', () => {
    const a = simularJuego({ jugadores: 5, semilla: 77 });
    const b = simularJuego({ jugadores: 5, semilla: 77 });
    const c = simularJuego({ jugadores: 5, semilla: 78 });
    expect(JSON.stringify(b.eventos)).toBe(JSON.stringify(a.eventos));
    expect(JSON.stringify(c.eventos)).not.toBe(JSON.stringify(a.eventos));
  });

  it('sin verificación también termina y da el mismo resultado', () => {
    const verificado = simularJuego({ jugadores: 6, semilla: 5, verificar: true });
    const rapido = simularJuego({ jugadores: 6, semilla: 5, verificar: false });
    expect(rapido.violaciones).toEqual([]);
    expect(JSON.stringify(rapido.eventos)).toBe(JSON.stringify(verificado.eventos));
  });

  it('informa como violación una cantidad de jugadores inválida, sin lanzar excepción', () => {
    const juego = simularJuego({ jugadores: 3, semilla: 1 });
    expect(juego.final).toBeNull();
    expect(juego.violaciones[0]).toContain('CANTIDAD_JUGADORES_INVALIDA');
  });
});

describe('estadísticas', () => {
  it('cuentan bien un juego completo', () => {
    const juego = simularJuego({ jugadores: 5, semilla: 3 });
    const e = estadisticasDe(juego);
    expect(e.juegos).toBe(1);
    expect(e.partidas).toBe(14);
    expect(e.bazas).toBe(56);
    expect(e.puntajes).toBe(14 * 5);
    expect(e.aciertosExactos).toBeLessThan(e.puntajes); // siempre falla al menos uno por partida
    expect(e.aciertosExactos).toBeLessThanOrEqual(e.puntajes - 14);
    expect(Object.keys(e.porTamano).map(Number).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Las partidas de 1 a 6 cartas ocurren dos veces, la de 7 cartas también (partidas 7 y 8).
    expect(e.porTamano[7]?.total).toBe(2 * 5);
    expect(e.porTamano[1]?.total).toBe(2 * 5);
    expect(e.bazasGanadasPorElMano).toBeLessThanOrEqual(56);
    expect(e.bazasGanadasPorElComodin).toBeLessThanOrEqual(56);
    expect(e.puntajeGanador.max).toBeGreaterThan(0);
  });

  it('sumar es consistente y no modifica los originales', () => {
    const a = estadisticasDe(simularJuego({ jugadores: 4, semilla: 1 }));
    const b = estadisticasDe(simularJuego({ jugadores: 7, semilla: 2 }));
    const copiaA = structuredClone(a);
    const suma = sumarEstadisticas(a, b);
    expect(a).toEqual(copiaA);
    expect(suma.juegos).toBe(2);
    expect(suma.bazas).toBe(112);
    expect(suma.puntajes).toBe(a.puntajes + b.puntajes);
    expect(suma.puntajeGanador.min).toBe(Math.min(a.puntajeGanador.min, b.puntajeGanador.min));
    expect(suma.puntajeGanador.max).toBe(Math.max(a.puntajeGanador.max, b.puntajeGanador.max));
    expect(sumarEstadisticas(estadisticasVacias(), a)).toEqual({ ...a });
  });
});

describe('narración', () => {
  const juego = simularJuego({ jugadores: 5, semilla: 8 });
  const lineas = narrarJuego(juego);
  const texto = lineas.join('\n');

  it('cuenta las 14 partidas, las 56 bazas y el ranking final', () => {
    expect(lineas.filter((l) => l.startsWith('── Partida'))).toHaveLength(14);
    expect(lineas.filter((l) => l.trimStart().startsWith('Baza '))).toHaveLength(56);
    expect(lineas.filter((l) => l.trimStart().startsWith('Puntos:'))).toHaveLength(14);
    expect(texto).toContain('══ Ranking final');
    expect(texto).toContain('1.º');
  });

  it('nombra a todos los jugadores y muestra el sorteo y las apuestas', () => {
    for (let i = 1; i <= 5; i++) expect(texto).toContain(`Jugador ${i}`);
    expect(texto).toContain('Sorteo del repartidor');
    expect(texto).toContain('Empieza repartiendo');
    expect(texto).toContain('(Pié)');
    expect(texto).toContain('Apuestas:');
  });

  it('el total acumulado de la última partida coincide con el ranking', () => {
    const ranking = juego.final!.ranking!;
    const acumulados = lineas.filter((l) => l.trimStart().startsWith('Acumulado:')).at(-1)!;
    for (const entrada of ranking) {
      expect(acumulados).toContain(`Jugador ${entrada.seat + 1} ${entrada.total}`);
    }
  });

  it('incluye las violaciones si las hubo', () => {
    const roto = { ...juego, violaciones: ['algo se rompió'] };
    expect(narrarJuego(roto).join('\n')).toContain('Violaciones detectadas');
  });
});

describe('corrida de muchos juegos', () => {
  it('alterna de 4 a 7 jugadores con "todos"', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => jugadoresDelJuego('todos', i))).toEqual([4, 5, 6, 7, 4, 5]);
    expect(jugadoresDelJuego(6, 17)).toBe(6);
  });

  it('simula 40 juegos sin fallos y acumula estadísticas', () => {
    let avances = 0;
    const corrida = ejecutarCorrida({
      juegos: 40,
      jugadores: 'todos',
      semilla: 100,
      verificar: true,
      alAvanzar: () => avances++,
    });
    expect(corrida.fallos).toEqual([]);
    expect(corrida.estadisticas.juegos).toBe(40);
    expect(corrida.estadisticas.bazas).toBe(40 * 56);
    expect(corrida.primerJuego?.jugadores).toBe(4);
    expect(corrida.duracionMs).toBeGreaterThan(0);
    expect(avances).toBeGreaterThan(0);
  });

  it('es reproducible', () => {
    const base = { juegos: 12, jugadores: 5, semilla: 31, verificar: false } as const;
    const a = ejecutarCorrida(base);
    const b = ejecutarCorrida(base);
    expect(b.estadisticas).toEqual(a.estadisticas);
  });
});

describe('informe', () => {
  it('resume una corrida sana', () => {
    const corrida = ejecutarCorrida({ juegos: 10, jugadores: 'todos', semilla: 1, verificar: true });
    const texto = formatearInforme(corrida).join('\n');
    expect(texto).toContain('Simulación de 10 juegos');
    expect(texto).toContain('✔ 10 juegos completos sin ninguna violación');
    expect(texto).toContain('Aciertos exactos');
    expect(texto).toContain('El Pié tuvo un valor prohibido');
    expect(texto).not.toContain('✘');
  });

  it('muestra cómo reproducir cada juego con violaciones', () => {
    const corrida: ResultadoCorrida = {
      opciones: { juegos: 3, jugadores: 'todos', semilla: 1, verificar: true },
      estadisticas: estadisticasVacias(),
      fallos: [{ indice: 1, jugadores: 5, semilla: 2, violaciones: ['a', 'b', 'c', 'd'] }],
      duracionMs: 1000,
      primerJuego: null,
    };
    const texto = formatearInforme(corrida).join('\n');
    expect(texto).toContain('✘ 1 de 3 juegos violaron las reglas');
    expect(texto).toContain(comandoParaReproducir(5, 2));
    expect(texto).toContain('- a');
    expect(texto).not.toContain('- d'); // solo las primeras tres
  });
});
