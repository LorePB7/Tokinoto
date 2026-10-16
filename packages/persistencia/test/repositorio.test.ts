import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type GameEvent } from '@tokinoto/reglas';
import { simularJuego, type ResultadoJuego } from '../../simulador/src/juego';
import {
  abrirRepositorioPglite,
  abrirRepositorioPostgres,
  crearRepositorioEnMemoria,
  verificarJuego,
  verificarJuegoGuardado,
  type Repositorio,
} from '../src';

const AHORA = new Date('2026-10-16T12:00:00Z');
const URL_PRUEBA = process.env['TEST_DATABASE_URL'];

const variantes: [string, () => Promise<Repositorio>][] = [
  ['memoria', async () => crearRepositorioEnMemoria()],
  ['PGlite', () => abrirRepositorioPglite()],
];
if (URL_PRUEBA) {
  variantes.push([
    'PostgreSQL',
    async () => {
      const repo = await abrirRepositorioPostgres(URL_PRUEBA);
      // Base limpia para que los resultados no dependan de corridas anteriores.
      const cliente = new pg.Client({ connectionString: URL_PRUEBA });
      await cliente.connect();
      await cliente.query('TRUNCATE eventos, ranking_final, puntajes_de_partida, jugadores_de_juego, juegos, salas');
      await cliente.end();
      return repo;
    },
  ]);
}

const juegoSimulado = (jugadores: number, semilla: number): ResultadoJuego => {
  const juego = simularJuego({ jugadores, semilla });
  expect(juego.violaciones).toEqual([]);
  return juego;
};

async function guardar(repo: Repositorio, juego: ResultadoJuego, sala: string, hasta = juego.eventos.length, lote = 25) {
  const id = randomUUID();
  await repo.abrirJuego({
    id,
    sala,
    jugadores: juego.inicial!.players.map((p) => ({ idJugador: p.id, nombre: p.name })),
    config: DEFAULT_CONFIG,
    iniciadoEn: AHORA,
  });
  const eventos = juego.eventos.slice(0, hasta).map((evento, seq) => ({ seq, evento }));
  for (let i = 0; i < eventos.length; i += lote) await repo.agregarEventos(id, eventos.slice(i, i + lote), AHORA);
  return id;
}

describe.each(variantes)('repositorio (%s)', (_nombre, abrir) => {
  let repo: Repositorio;
  beforeAll(async () => {
    repo = await abrir();
  }, 60_000);
  afterAll(async () => {
    await repo.cerrar();
  });

  it('guarda un juego terminado: jugadores, puntajes, ranking y eventos', async () => {
    const juego = juegoSimulado(5, 11);
    const id = await guardar(repo, juego, 'SALA0001');
    const guardado = await repo.obtenerJuego(id);
    expect(guardado).toMatchObject({ id, sala: 'SALA0001', estado: 'TERMINADO', motivoAborto: null, totalPartidas: 14 });
    expect(guardado!.terminadoEn).toEqual(AHORA);
    expect(guardado!.jugadores.map((j) => j.nombre)).toEqual(juego.final!.players.map((p) => p.name));
    expect(guardado!.puntajes).toHaveLength(14 * 5);
    expect(guardado!.ranking).toHaveLength(5);
    const final = juego.final!;
    for (const p of guardado!.puntajes) expect(final.roundScores[p.asiento]![p.partida - 1]).toBe(p.puntos);
    expect(guardado!.ranking.map((r) => ({ asiento: r.asiento, total: r.total, puesto: r.puesto }))).toEqual(
      [...final.ranking!].map((r) => ({ asiento: r.seat, total: r.total, puesto: r.position })).sort((a, b) => a.puesto - b.puesto || a.asiento - b.asiento),
    );
    const eventos = await repo.eventosDe(id);
    expect(eventos.map((e) => e.seq)).toEqual(juego.eventos.map((_, i) => i));
    expect(eventos.map((e) => e.evento)).toEqual(juego.eventos);
  }, 60_000);

  it('el juego guardado se reconstruye desde sus eventos y es consistente', async () => {
    const id = await guardar(repo, juegoSimulado(4, 5), 'SALA0002');
    expect(await verificarJuego(repo, id)).toEqual([]);
  }, 60_000);

  it('repetir lotes (reintentos) no duplica nada', async () => {
    const juego = juegoSimulado(4, 8);
    const id = await guardar(repo, juego, 'SALA0003');
    const todos = juego.eventos.map((evento, seq) => ({ seq, evento }));
    await repo.agregarEventos(id, todos, new Date('2030-01-01T00:00:00Z'));
    await repo.abrirJuego({
      id,
      sala: 'SALA0003',
      jugadores: juego.inicial!.players.map((p) => ({ idJugador: p.id, nombre: p.name })),
      config: DEFAULT_CONFIG,
      iniciadoEn: new Date('2031-01-01T00:00:00Z'),
    });
    const guardado = await repo.obtenerJuego(id);
    expect(guardado!.puntajes).toHaveLength(14 * 4);
    expect(guardado!.ranking).toHaveLength(4);
    expect(guardado!.jugadores).toHaveLength(4);
    expect(guardado!.terminadoEn).toEqual(AHORA); // el cierre original no se pisa
    expect(guardado!.iniciadoEn).toEqual(AHORA);
    expect(await repo.eventosDe(id)).toHaveLength(juego.eventos.length);
    expect(await verificarJuego(repo, id)).toEqual([]);
  }, 60_000);

  it('un juego abortado por evento queda ABORTADO con su motivo', async () => {
    const juego = juegoSimulado(4, 3);
    const id = await guardar(repo, juego, 'SALA0004', 60);
    const aborto: GameEvent = { type: 'JUEGO_ABORTADO', reason: 'No quedó ningún jugador conectado' };
    await repo.agregarEventos(id, [{ seq: 60, evento: aborto }], AHORA);
    const guardado = await repo.obtenerJuego(id);
    expect(guardado).toMatchObject({ estado: 'ABORTADO', motivoAborto: 'No quedó ningún jugador conectado' });
    expect(guardado!.ranking).toEqual([]);
    expect(await verificarJuego(repo, id)).toEqual([]);
  }, 60_000);

  it('abortarEnCurso cierra solo los juegos que seguían EN_CURSO', async () => {
    const enCurso = await guardar(repo, juegoSimulado(4, 21), 'SALA0005', 80);
    const terminado = await guardar(repo, juegoSimulado(4, 22), 'SALA0005');
    const cuando = new Date('2026-10-16T13:00:00Z');
    expect(await repo.abortarEnCurso('Reinicio del servidor', cuando)).toBeGreaterThanOrEqual(1);
    expect(await repo.obtenerJuego(enCurso)).toMatchObject({ estado: 'ABORTADO', motivoAborto: 'Reinicio del servidor', terminadoEn: cuando });
    expect(await repo.obtenerJuego(terminado)).toMatchObject({ estado: 'TERMINADO', terminadoEn: AHORA });
    const eventos = await repo.eventosDe(enCurso);
    expect(eventos.at(-1)).toEqual({ seq: 80, evento: { type: 'JUEGO_ABORTADO', reason: 'Reinicio del servidor' } });
    expect(await verificarJuego(repo, enCurso)).toEqual([]);
    expect(await repo.abortarEnCurso('otra vez', cuando)).toBe(0);
  }, 60_000);

  it('una revancha es otro juego de la misma sala; se listan del más nuevo al más viejo', async () => {
    const viejo = await guardar(repo, juegoSimulado(4, 31), 'SALA0006');
    const nuevo = randomUUID();
    const juego = juegoSimulado(4, 32);
    await repo.abrirJuego({
      id: nuevo,
      sala: 'SALA0006',
      jugadores: juego.inicial!.players.map((p) => ({ idJugador: p.id, nombre: p.name })),
      config: DEFAULT_CONFIG,
      iniciadoEn: new Date('2026-10-16T12:30:00Z'),
    });
    await guardar(repo, juegoSimulado(4, 33), 'SALA0007');
    const lista = await repo.listarJuegos({ sala: 'SALA0006' });
    expect(lista.map((j) => j.id)).toEqual([nuevo, viejo]);
    expect(lista[0]).toMatchObject({ estado: 'EN_CURSO', cantidadJugadores: 4, terminadoEn: null });
    expect(await repo.listarJuegos({ sala: 'SALA0006', limite: 1 })).toHaveLength(1);
    expect((await repo.listarJuegos()).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('rechaza eventos de un juego que no existe y no deja nada a medias', async () => {
    const huerfano = randomUUID();
    const evento: GameEvent = { type: 'JUEGO_INICIADO' };
    await expect(repo.agregarEventos(huerfano, [{ seq: 0, evento }], AHORA)).rejects.toThrow();
    expect(await repo.obtenerJuego(huerfano)).toBeNull();
    expect(await repo.eventosDe(huerfano)).toEqual([]);
  });

  it('obtenerJuego devuelve null si no existe', async () => {
    expect(await repo.obtenerJuego(randomUUID())).toBeNull();
  });
});

describe('verificación del historial', () => {
  async function juegoGuardadoEnMemoria(semilla = 4) {
    const repo = crearRepositorioEnMemoria();
    const id = await guardar(repo, juegoSimulado(4, semilla), 'SALA0010');
    return { guardado: (await repo.obtenerJuego(id))!, eventos: await repo.eventosDe(id) };
  }

  it('lo íntegro no tiene problemas', async () => {
    const { guardado, eventos } = await juegoGuardadoEnMemoria();
    expect(verificarJuegoGuardado(guardado, eventos)).toEqual([]);
  });

  it('detecta un puntaje alterado', async () => {
    const { guardado, eventos } = await juegoGuardadoEnMemoria();
    guardado.puntajes[3]!.puntos += 1;
    expect(verificarJuegoGuardado(guardado, eventos).join('\n')).toMatch(/guardado \d+ puntos y reconstruido \d+/);
  });

  it('detecta un puntaje faltante', async () => {
    const { guardado, eventos } = await juegoGuardadoEnMemoria();
    guardado.puntajes.pop();
    expect(verificarJuegoGuardado(guardado, eventos).join('\n')).toMatch(/puntajes guardados|Falta el puntaje/);
  });

  it('detecta un ranking alterado', async () => {
    const { guardado, eventos } = await juegoGuardadoEnMemoria();
    guardado.ranking[0]!.total += 5;
    expect(verificarJuegoGuardado(guardado, eventos).join('\n')).toMatch(/Ranking distinto/);
  });

  it('detecta un evento que falta en el registro', async () => {
    const { guardado, eventos } = await juegoGuardadoEnMemoria();
    eventos.splice(40, 1);
    expect(verificarJuegoGuardado(guardado, eventos).length).toBeGreaterThan(0);
    expect(verificarJuegoGuardado(guardado, eventos).join('\n')).toMatch(/saltos/);
  });

  it('detecta un estado que no coincide con la fase reconstruida', async () => {
    const { guardado, eventos } = await juegoGuardadoEnMemoria();
    guardado.estado = 'ABORTADO';
    expect(verificarJuegoGuardado(guardado, eventos).join('\n')).toMatch(/no coincide con la fase/);
    guardado.estado = 'EN_CURSO';
    expect(verificarJuegoGuardado(guardado, eventos).join('\n')).toMatch(/no coincide con la fase/);
  });

  it('informa si el juego no existe', async () => {
    expect(await verificarJuego(crearRepositorioEnMemoria(), 'nada')).toEqual(['No existe el juego nada']);
  });
});
