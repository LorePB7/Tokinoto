/**
 * Etapa 7: historial de juegos (DP-21).
 *  - Cada juego terminado queda guardado con sus puntajes, su ranking y su registro de eventos.
 *  - Una revancha es otro juego de la misma sala.
 *  - Los abortos (sin jugadores, reinicio del servidor) quedan registrados.
 *  - Una falla de la base nunca frena ni rompe el juego.
 */
import { abrirRepositorioPglite, crearRepositorioEnMemoria, verificarJuego, type Repositorio } from '@tokinoto/persistencia';
import { describe, expect, it } from 'vitest';
import { armarMesa, cartasEn, indiceDeAsiento, jugarHastaElFinal } from './ayudas';
import { GuardadorHistorial, MOTIVO_ABORTO_REINICIO, crearServidor, MOTIVO_ABORTO_SIN_JUGADORES } from '../src';

const OK = { ok: true, datos: {} };
const sinEsperas = { esperas: [], dormir: async () => {} };

function conHistorial(cantidad: number, repo: Repositorio, opciones: Parameters<typeof armarMesa>[1] = {}) {
  const errores: unknown[] = [];
  const guardador = new GuardadorHistorial(repo, { ...sinEsperas, alError: (e) => errores.push(e) });
  const mesa = armarMesa(cantidad, { historial: guardador, ...opciones });
  return { mesa, guardador, errores };
}

describe('historial de los juegos', () => {
  it('guarda el juego terminado: jugadores, puntajes, ranking y eventos', async () => {
    const repo = await abrirRepositorioPglite();
    const { mesa, guardador, errores } = conHistorial(5, repo, { semilla: 2 });
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    jugarHastaElFinal(mesa);
    await guardador.vaciar();

    expect(errores).toEqual([]);
    expect(mesa.errores).toEqual([]);
    const [resumen] = await repo.listarJuegos({ sala: 'PRUEBA23' });
    const guardado = (await repo.obtenerJuego(resumen!.id))!;
    const final = mesa.sala.estadoDelJuego!;
    expect(guardado).toMatchObject({ estado: 'TERMINADO', sala: 'PRUEBA23', totalPartidas: 14 });
    expect(guardado.jugadores.map((j) => j.nombre)).toEqual(final.players.map((p) => p.name));
    expect(guardado.puntajes).toHaveLength(14 * 5);
    for (const p of guardado.puntajes) expect(final.roundScores[p.asiento]![p.partida - 1]).toBe(p.puntos);
    expect(guardado.ranking.map((r) => r.asiento).sort()).toEqual([0, 1, 2, 3, 4]);
    for (const r of final.ranking!) {
      expect(guardado.ranking.find((x) => x.asiento === r.seat)).toEqual({ asiento: r.seat, total: r.total, puesto: r.position });
    }
    expect(await verificarJuego(repo, guardado.id)).toEqual([]);
    await repo.cerrar();
  }, 60_000);

  it('el registro guarda las manos para auditar, pero ningún mensaje a los jugadores las expone', async () => {
    const repo = crearRepositorioEnMemoria();
    const { mesa, guardador } = conHistorial(4, repo, { semilla: 6 });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    await guardador.vaciar();
    const [resumen] = await repo.listarJuegos();
    const eventos = await repo.eventosDe(resumen!.id);
    const manos = eventos.find((e) => e.evento.type === 'PARTIDA_INICIADA')!.evento as { hands: { id: string }[][] };
    // El sorteo es público: sus cartas sí las ve todo el mundo.
    const sorteadas = new Set(cartasEn(eventos.filter((e) => e.evento.type === 'SORTEO_RONDA').map((e) => e.evento)));
    for (let asiento = 0; asiento < 4; asiento++) {
      const propias = manos.hands[asiento]!.map((c) => c.id).filter((c) => !sorteadas.has(c));
      expect(propias.length).toBeGreaterThan(0);
      const dueno = indiceDeAsiento(mesa, asiento);
      expect(cartasEn(mesa.jugadores[dueno]!.recibidos)).toEqual(expect.arrayContaining(propias));
      mesa.jugadores.forEach((otro, i) => {
        if (i !== dueno) for (const carta of propias) expect(cartasEn(otro.recibidos)).not.toContain(carta);
      });
    }
  });

  it('una revancha es otro juego de la misma sala', async () => {
    const repo = crearRepositorioEnMemoria();
    const { mesa, guardador } = conHistorial(4, repo, { semilla: 3 });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    jugarHastaElFinal(mesa);
    expect(mesa.comando(0, { tipo: 'juego.revancha' })).toEqual(OK);
    jugarHastaElFinal(mesa);
    await guardador.vaciar();

    const juegos = await repo.listarJuegos({ sala: 'PRUEBA23' });
    expect(juegos).toHaveLength(2);
    expect(juegos.map((j) => j.estado)).toEqual(['TERMINADO', 'TERMINADO']);
    expect(new Set(juegos.map((j) => j.id)).size).toBe(2);
    for (const j of juegos) expect(await verificarJuego(repo, j.id)).toEqual([]);
  }, 60_000);

  it('un juego abortado por falta de jugadores queda registrado con su motivo', async () => {
    const repo = crearRepositorioEnMemoria();
    const { mesa, guardador } = conHistorial(4, repo, { semilla: 4, esperaAbortoMs: 60_000 });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    for (const jugador of mesa.jugadores) mesa.sala.desconectar(jugador.id);
    mesa.reloj.avanzar(60_000);
    await guardador.vaciar();

    const [resumen] = await repo.listarJuegos();
    expect(resumen).toMatchObject({ estado: 'ABORTADO', motivoAborto: MOTIVO_ABORTO_SIN_JUGADORES });
    expect(await verificarJuego(repo, resumen!.id)).toEqual([]);
  });

  it('una sala que nunca inició un juego no deja nada en el historial', async () => {
    const repo = crearRepositorioEnMemoria();
    const { mesa, guardador } = conHistorial(3, repo);
    await guardador.vaciar();
    expect(mesa.sala.estado).toBe('ESPERANDO');
    expect(await repo.listarJuegos()).toEqual([]);
  });

  it('si la base falla siempre, el juego igual se juega completo y se avisa del error', async () => {
    const roto: Repositorio = {
      ...crearRepositorioEnMemoria(),
      abrirJuego: async () => {
        throw new Error('base caída');
      },
      agregarEventos: async () => {
        throw new Error('base caída');
      },
    };
    const { mesa, guardador, errores } = conHistorial(4, roto, { semilla: 5 });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    jugarHastaElFinal(mesa);
    await guardador.vaciar();
    expect(mesa.sala.estado).toBe('TERMINADO');
    expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
    expect(mesa.errores).toEqual([]);
    expect(errores.length).toBeGreaterThan(0);
    expect(String(errores[0])).toContain('base caída');
  }, 60_000);

  it('si la base falla un rato, los reintentos dejan el historial completo y en orden', async () => {
    const real = crearRepositorioEnMemoria();
    let fallos = 0;
    const intermitente: Repositorio = {
      ...real,
      abrirJuego: (d) => (fallos++ < 2 ? Promise.reject(new Error('corte')) : real.abrirJuego(d)),
      agregarEventos: (id, lote, cuando) => (Math.random() < 0.3 ? Promise.reject(new Error('corte')) : real.agregarEventos(id, lote, cuando)),
    };
    const errores: unknown[] = [];
    const guardador = new GuardadorHistorial(intermitente, { esperas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], dormir: async () => {}, alError: (e) => errores.push(e) });
    const mesa = armarMesa(4, { semilla: 7, historial: guardador });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    jugarHastaElFinal(mesa);
    await guardador.vaciar();
    expect(errores).toEqual([]);
    const [resumen] = await real.listarJuegos();
    expect(resumen!.estado).toBe('TERMINADO');
    expect(await verificarJuego(real, resumen!.id)).toEqual([]);
  }, 60_000);

  it('si la base no responde nunca, no se acumulan juegos perdidos ni se reintenta de más', async () => {
    let llamadas = 0;
    const roto: Repositorio = {
      ...crearRepositorioEnMemoria(),
      abrirJuego: async () => {
        llamadas++;
        throw new Error('sin base');
      },
      agregarEventos: async () => {
        llamadas++;
      },
    };
    const guardador = new GuardadorHistorial(roto, { esperas: [0, 0], dormir: async () => {}, alError: () => {} });
    const mesa = armarMesa(4, { semilla: 8, historial: guardador });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    await guardador.vaciar();
    // 1 intento + 2 reintentos para abrir; de ese juego no se intenta guardar nada más.
    expect(llamadas).toBe(3);
  });

  it('un historial que lanza excepciones tampoco afecta al juego', async () => {
    const historial = {
      juegoNuevo: () => {
        throw new Error('falla sincrónica');
      },
      evento: () => {
        throw new Error('falla sincrónica');
      },
    };
    const mesa = armarMesa(4, { semilla: 9, historial });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    jugarHastaElFinal(mesa);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
    expect(mesa.errores.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('servidor con historial', () => {
  it('al apagarse guarda lo pendiente y cierra como abortados los juegos en curso', async () => {
    const repo = crearRepositorioEnMemoria();
    const servidor = crearServidor({ repositorio: repo, sala: { pausaPilotoMs: 0 } });
    const destino = { enviar: () => {} };
    let sala: ReturnType<typeof servidor.gestor.buscar>;
    const ids: string[] = [];
    servidor.gestor.crear('Ana', destino, (r, s) => {
      sala = s ?? undefined;
      if (r.ok) ids.push(r.datos['idJugador'] as string);
    });
    for (const nombre of ['Beto', 'Cata', 'Dani']) {
      servidor.gestor.unirse(sala!.codigo, nombre, destino, (r) => {
        if (r.ok) ids.push(r.datos['idJugador'] as string);
      });
    }
    let respuesta: unknown;
    sala!.comando(ids[0]!, 'p1', { tipo: 'sala.iniciar' }, (r) => (respuesta = r));
    expect(respuesta).toEqual(OK);

    await servidor.cerrar();
    const [juego] = await repo.listarJuegos();
    expect(juego).toMatchObject({ estado: 'ABORTADO', motivoAborto: MOTIVO_ABORTO_REINICIO, sala: sala!.codigo });
    expect((await repo.eventosDe(juego!.id)).length).toBeGreaterThan(3);
    expect(await verificarJuego(repo, juego!.id)).toEqual([]);
  });

  it('sin repositorio funciona igual, sin guardar nada', async () => {
    const servidor = crearServidor();
    await servidor.cerrar();
  });
});
