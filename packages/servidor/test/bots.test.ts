/**
 * Fase 8: bots del servidor.
 *
 * - El anfitrión agrega y quita bots en la sala de espera; cuentan para el
 *   mínimo de 4 y el tope de 7. "Expulsar" a un bot es quitarlo.
 * - Un bot juega solo, con una pausa corta, sin tiempo límite ni piloto.
 * - Sin personas conectadas la mesa se detiene y, si nadie vuelve, se aborta.
 * - Un juego con bots se guarda solo si alguna persona tiene cuenta.
 */
import { createSeededRng, currentTurn, playableCards, validBetsFor } from '@tokinoto/reglas';
import {
  ESTADO_CLIENTE_INICIAL,
  aplicarMensaje,
  leerPedido,
  type MensajeServidor,
  type NivelBot,
  type Respuesta,
} from '@tokinoto/protocolo';
import { describe, expect, it } from 'vitest';
import type { Historial } from '../src/guardador';
import { GestorSalas } from '../src/gestor';
import { MOTIVO_ABORTO_SIN_JUGADORES, MOTIVO_ABORTO_TODOS_SALIERON, type Destino, type PerfilJugador } from '../src/sala';
import { armarMesa, RelojManual, type Mesa } from './ayudas';

const OK = { ok: true, datos: {} };
const agregar = (nivel: NivelBot = 'medio') => ({ tipo: 'sala.agregarBot' as const, datos: { nivel } });
const quitar = (idJugador: string) => ({ tipo: 'sala.quitarBot' as const, datos: { idJugador } });

function bots(mesa: Mesa) {
  return (mesa.sala.vistaPara(mesa.jugadores[0]!.id)?.jugadores ?? []).filter((j) => j.bot !== null);
}

/**
 * Juega hasta el final: las personas (en mesa.jugadores) eligen jugadas
 * legales al azar; los bots juegan solos cuando avanza el reloj.
 */
function jugarConBots(mesa: Mesa, semilla = 3): void {
  const azar = createSeededRng(semilla);
  for (let pasos = 0; pasos < 20_000; pasos++) {
    const juego = mesa.sala.estadoDelJuego;
    if (!juego || juego.phase === 'FINISHED' || juego.phase === 'ABORTED') return;
    const turno = currentTurn(juego);
    const indice = turno ? mesa.jugadores.findIndex((j) => j.id === juego.players[turno.seat]?.id) : -1;
    if (turno && indice >= 0) {
      if (turno.kind === 'bet') {
        const validas = validBetsFor(juego, turno.seat);
        mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor: validas[azar.nextInt(validas.length)]! } });
      } else {
        const cartas = playableCards(juego, turno.seat);
        mesa.comando(indice, { tipo: 'juego.jugarCarta', datos: { idCarta: cartas[azar.nextInt(cartas.length)]!.id } });
      }
    } else if (!mesa.reloj.avanzarAlProximo()) {
      throw new Error(`La mesa quedó parada en ${juego.phase}`);
    }
  }
  throw new Error('El juego no terminó');
}

describe('bots en la sala de espera (fase 8)', () => {
  it('el anfitrión agrega y quita bots; cuentan para el mínimo y el tope', () => {
    const mesa = armarMesa(1);
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toMatchObject({ ok: false });
    for (let i = 0; i < 3; i++) expect(mesa.comando(0, agregar('facil')).ok).toBe(true);
    expect(bots(mesa).map((b) => [b.nombre, b.bot, b.conectado])).toEqual([
      ['Bot 1', 'facil', true],
      ['Bot 2', 'facil', true],
      ['Bot 3', 'facil', true],
    ]);
    for (let i = 0; i < 3; i++) expect(mesa.comando(0, agregar('dificil')).ok).toBe(true);
    expect(mesa.sala.cantidadJugadores).toBe(7);
    expect(mesa.comando(0, agregar())).toMatchObject({ ok: false, error: { codigo: 'SALA_LLENA' } });

    const [b1, b2] = bots(mesa);
    expect(mesa.comando(0, quitar(b1!.idJugador))).toEqual(OK);
    // "Expulsar" a un bot es quitarlo.
    expect(mesa.comando(0, { tipo: 'sala.expulsar', datos: { idJugador: b2!.idJugador } })).toEqual(OK);
    expect(mesa.sala.cantidadJugadores).toBe(5);
    // El nombre libre se reutiliza.
    expect(mesa.comando(0, agregar())).toMatchObject({ ok: true });
    expect(bots(mesa).map((b) => b.nombre)).toContain('Bot 1');
    expect(mesa.errores).toEqual([]);
  });

  it('solo el anfitrión, solo antes de empezar, y quitarBot no saca personas', () => {
    const mesa = armarMesa(2);
    expect(mesa.comando(1, agregar())).toMatchObject({ ok: false, error: { codigo: 'NO_ES_ANFITRION' } });
    expect(mesa.comando(0, agregar()).ok).toBe(true);
    const [bot] = bots(mesa);
    expect(mesa.comando(1, quitar(bot!.idJugador))).toMatchObject({ ok: false, error: { codigo: 'NO_ES_ANFITRION' } });
    expect(mesa.comando(0, quitar(mesa.jugadores[1]!.id))).toMatchObject({ ok: false, error: { codigo: 'ESTADO_INVALIDO' } });
    expect(mesa.comando(0, quitar('nadie'))).toMatchObject({ ok: false, error: { codigo: 'NO_PERTENECE_A_SALA' } });
    expect(mesa.comando(0, agregar()).ok).toBe(true);
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    expect(mesa.comando(0, agregar())).toMatchObject({ ok: false, error: { codigo: 'JUEGO_YA_INICIADO' } });
    expect(mesa.comando(0, quitar(bot!.idJugador))).toMatchObject({ ok: false, error: { codigo: 'JUEGO_YA_INICIADO' } });
  });

  it('si la única persona se va de la sala de espera, la sala se cierra aunque queden bots', () => {
    const mesa = armarMesa(1);
    mesa.comando(0, agregar());
    mesa.comando(0, agregar());
    expect(mesa.comando(0, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.vaciada()).toBe(true);
  });

  it('el anfitrión nunca pasa a un bot', () => {
    const mesa = armarMesa(2);
    mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.salir' });
    expect(mesa.sala.idAnfitrion).toBe(mesa.jugadores[1]!.id);
  });
});

describe('juego con bots (fase 8)', () => {
  it('1 persona y 3 bots juegan las 14 partidas; el cliente reconstruye la misma vista', () => {
    const mesa = armarMesa(1, { pausaBotMs: 800 });
    for (const nivel of ['facil', 'medio', 'dificil'] as const) mesa.comando(0, agregar(nivel));
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    jugarConBots(mesa);
    expect(mesa.sala.estadoDelJuego?.phase).toBe('FINISHED');
    expect(mesa.errores).toEqual([]);

    const persona = mesa.jugadores[0]!;
    const estado = persona.recibidos.reduce(aplicarMensaje, ESTADO_CLIENTE_INICIAL);
    expect(estado.desincronizado).toBe(false);
    expect({ ...estado.sala, horaServidor: 0 }).toEqual({ ...mesa.sala.vistaPara(persona.id), horaServidor: 0 });
    // Nunca recibió cartas ajenas: su mano privada es solo la suya.
    const repartos = persona.recibidos.filter((m) => m.tipo === 'partida.manoRepartida');
    expect(repartos.length).toBe(14);
  });

  it('1 persona y 6 bots, con revancha', () => {
    const mesa = armarMesa(1, { pausaBotMs: 500 });
    for (let i = 0; i < 6; i++) mesa.comando(0, agregar(i % 2 ? 'medio' : 'facil'));
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    jugarConBots(mesa, 5);
    expect(mesa.sala.estadoDelJuego?.phase).toBe('FINISHED');
    expect(mesa.comando(0, { tipo: 'juego.revancha' })).toEqual(OK);
    expect(mesa.sala.estadoDelJuego?.players.length).toBe(7);
    expect(mesa.errores).toEqual([]);
  });

  it('los bots esperan una pausa corta antes de jugar y no tienen tiempo límite', () => {
    const mesa = armarMesa(1, { pausaBotMs: 1000, tiempoTurnoMs: 30_000 });
    for (let i = 0; i < 3; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    const juego = () => mesa.sala.estadoDelJuego!;
    const turnoDeBot = () => {
      const t = currentTurn(juego());
      return t !== null && juego().players[t.seat]?.id !== mesa.jugadores[0]!.id;
    };
    // Avanzar hasta un turno de bot.
    while (!turnoDeBot()) {
      const t = currentTurn(juego())!;
      mesa.comando(0, { tipo: 'juego.apostar', datos: { valor: validBetsFor(juego(), t.seat)[0]! } });
    }
    const apuestas = juego().bets.filter((b) => b !== null).length;
    const turnos = mesa.eventos(0, 'apuesta.turno');
    expect(turnos.at(-1)?.datos).toMatchObject({ fechaLimite: null });
    mesa.reloj.avanzar(999);
    expect(juego().bets.filter((b) => b !== null).length).toBe(apuestas);
    mesa.reloj.avanzar(1);
    expect(juego().bets.filter((b) => b !== null).length).toBe(apuestas + 1);
    expect(mesa.errores).toEqual([]);
  });

  it('sin personas conectadas los bots no siguen, y si nadie vuelve el juego se aborta', () => {
    const mesa = armarMesa(1, { pausaBotMs: 1000, esperaAbortoMs: 60_000 });
    for (let i = 0; i < 3; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    mesa.sala.desconectar(mesa.jugadores[0]!.id);
    const antes = JSON.stringify(mesa.sala.estadoDelJuego);
    mesa.reloj.avanzar(59_000);
    expect(JSON.stringify(mesa.sala.estadoDelJuego)).toBe(antes);
    mesa.reloj.avanzar(1000);
    expect(mesa.sala.estadoDelJuego?.phase).toBe('ABORTED');
    expect(mesa.sala.estadoDelJuego?.abortReason).toBe(MOTIVO_ABORTO_SIN_JUGADORES);
    expect(mesa.vaciada()).toBe(true);
  });

  it('si la persona vuelve a tiempo, los bots siguen jugando', () => {
    const mesa = armarMesa(1, { pausaBotMs: 1000, esperaAbortoMs: 60_000 });
    for (let i = 0; i < 3; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    mesa.sala.desconectar(mesa.jugadores[0]!.id);
    mesa.reloj.avanzar(30_000);
    expect(mesa.reconectar(0).ok).toBe(true);
    jugarConBots(mesa);
    expect(mesa.sala.estadoDelJuego?.phase).toBe('FINISHED');
    expect(mesa.errores).toEqual([]);
  });
});

describe('salir de un juego con bots', () => {
  it('solo contra bots: al tocar Salir el juego se cierra en el acto', () => {
    const mesa = armarMesa(1, { pausaBotMs: 1000, esperaAbortoMs: 60_000 });
    for (let i = 0; i < 3; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    expect(mesa.comando(0, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.sala.estadoDelJuego?.phase).toBe('ABORTED');
    expect(mesa.sala.estadoDelJuego?.abortReason).toBe(MOTIVO_ABORTO_TODOS_SALIERON);
    expect(mesa.vaciada()).toBe(true);
    expect(mesa.errores).toEqual([]);
  });

  it('solo contra bots: si solo se corta la conexión, sigue esperando a que vuelva', () => {
    const mesa = armarMesa(1, { pausaBotMs: 1000, esperaAbortoMs: 60_000 });
    for (let i = 0; i < 3; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    mesa.sala.desconectar(mesa.jugadores[0]!.id);
    expect(mesa.sala.estadoDelJuego?.phase).not.toBe('ABORTED');
    expect(mesa.vaciada()).toBe(false);
  });

  it('con amigos: sigue mientras quede alguien; cuando salen todos, se cierra en el acto', () => {
    const mesa = armarMesa(2, { pausaBotMs: 1000, esperaAbortoMs: 60_000 });
    for (let i = 0; i < 2; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    expect(mesa.comando(0, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.sala.estadoDelJuego?.phase).not.toBe('ABORTED');
    expect(mesa.comando(1, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.sala.estadoDelJuego?.abortReason).toBe(MOTIVO_ABORTO_TODOS_SALIERON);
    expect(mesa.vaciada()).toBe(true);
  });

  it('con amigos: si uno salió y el otro solo perdió la conexión, se espera como siempre', () => {
    const mesa = armarMesa(2, { pausaBotMs: 1000, esperaAbortoMs: 60_000 });
    for (let i = 0; i < 2; i++) mesa.comando(0, agregar());
    mesa.comando(0, { tipo: 'sala.iniciar' });
    mesa.sala.desconectar(mesa.jugadores[1]!.id);
    expect(mesa.comando(0, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.vaciada()).toBe(false);
    mesa.reloj.avanzar(60_000);
    expect(mesa.sala.estadoDelJuego?.abortReason).toBe(MOTIVO_ABORTO_SIN_JUGADORES);
  });
});

describe('abandonar desde el inicio', () => {
  const ana = { tipo: 'invitado' as const, clave: 'i:ana', nombre: 'Ana', cuentaId: null };
  const beto = { tipo: 'invitado' as const, clave: 'i:beto', nombre: 'Beto', cuentaId: null };
  const destino = (): Destino => ({ enviar: () => undefined });
  function pedir<T>(hacer: (responder: (r: T) => void) => void): T {
    let r: T | null = null;
    hacer((x) => (r = x));
    if (r === null) throw new Error('Sin respuesta');
    return r;
  }

  it('con la conexión cortada, Abandonar cierra el juego contra bots y deja empezar otro', () => {
    const reloj = new RelojManual();
    const gestor = new GestorSalas({ sala: { reloj, crearAzar: () => createSeededRng(3), pausaBotMs: 1000 } });
    const r = pedir<Respuesta>((ok) => gestor.jugarContraBots(ana, destino(), ok, 3, 'medio'));
    const sala = gestor.buscar(String(r.ok && r.datos['codigo']))!;
    sala.desconectar(String(r.ok && r.datos['idJugador']));
    // Con la conexión cortada sigue teniendo lugar: no puede empezar otra.
    expect(pedir<Respuesta>((ok) => gestor.crear(ana, destino(), ok))).toMatchObject({ error: { codigo: 'YA_ESTAS_EN_UNA_SALA' } });
    expect(pedir<Respuesta>((ok) => gestor.consultar(ana, ok))).toMatchObject({ datos: { vigente: true } });
    expect(pedir<Respuesta>((ok) => gestor.abandonar(ana, ok))).toEqual(OK);
    expect(sala.estadoDelJuego?.abortReason).toBe(MOTIVO_ABORTO_TODOS_SALIERON);
    expect(pedir<Respuesta>((ok) => gestor.consultar(ana, ok))).toMatchObject({ datos: { vigente: false } });
    expect(pedir<Respuesta>((ok) => gestor.jugarContraBots(ana, destino(), ok, 3, 'medio')).ok).toBe(true);
    gestor.cerrarTodas();
  });

  it('con amigos, Abandonar deja al piloto en su lugar, ya no ofrece volver y libera para otra sala', () => {
    const reloj = new RelojManual();
    const gestor = new GestorSalas({ sala: { reloj, crearAzar: () => createSeededRng(4), pausaBotMs: 1000 } });
    const r = pedir<Respuesta>((ok) => gestor.crear(ana, destino(), ok));
    const codigo = String(r.ok && r.datos['codigo']);
    const sala = gestor.buscar(codigo)!;
    const idAna = String(r.ok && r.datos['idJugador']);
    expect(pedir<Respuesta>((ok) => gestor.unirse(codigo, beto, destino(), ok)).ok).toBe(true);
    for (let i = 0; i < 2; i++) pedir<Respuesta>((ok) => sala.comando(idAna, `b${i}`, agregar(), ok));
    expect(pedir<Respuesta>((ok) => sala.comando(idAna, 'ini', { tipo: 'sala.iniciar' }, ok))).toEqual(OK);
    sala.desconectar(idAna);
    expect(pedir<Respuesta>((ok) => gestor.abandonar(ana, ok))).toEqual(OK);
    expect(sala.estadoDelJuego?.phase).not.toBe('ABORTED');
    expect(sala.vistaPara(idAna)?.jugadores.find((j) => j.idJugador === idAna)?.piloto).toBe('abandono');
    expect(pedir<Respuesta>((ok) => gestor.consultar(ana, ok))).toMatchObject({ datos: { vigente: false } });
    expect(pedir<Respuesta>((ok) => gestor.crear(ana, destino(), ok)).ok).toBe(true);
    gestor.cerrarTodas();
  });

  it('sin partida, Abandonar no hace nada', () => {
    const gestor = new GestorSalas();
    expect(pedir<Respuesta>((ok) => gestor.abandonar(ana, ok))).toEqual(OK);
  });
});

describe('historial de juegos con bots (fase 8)', () => {
  function historialFalso() {
    const juegos: Parameters<Historial['juegoNuevo']>[0][] = [];
    let eventos = 0;
    const historial: Historial = { juegoNuevo: (d) => juegos.push(d), evento: () => eventos++ };
    return { historial, juegos, eventos: () => eventos };
  }

  function mesaCon(perfil: PerfilJugador, historial: Historial): Mesa {
    const mesa = armarMesa(0, { historial });
    const recibidos: MensajeServidor[] = [];
    const destino: Destino = { enviar: (m) => recibidos.push(m) };
    let respuesta: Respuesta | null = null;
    mesa.sala.unirse('Ana', destino, (r) => (respuesta = r), perfil);
    const r = respuesta as Respuesta | null;
    if (!r?.ok) throw new Error('No entró');
    mesa.jugadores.push({ id: r.datos['idJugador'] as string, token: r.datos['token'] as string, nombre: 'Ana', recibidos, destino });
    for (let i = 0; i < 3; i++) mesa.comando(0, agregar('dificil'));
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    return mesa;
  }

  it('con cuenta de Google se guarda, con cada bot marcado', () => {
    const h = historialFalso();
    mesaCon({ cuentaId: 'cuenta-1', invitado: false, clave: 'g:cuenta-1' }, h.historial);
    expect(h.juegos).toHaveLength(1);
    expect(h.juegos[0]!.jugadores.map((j) => [j.cuentaId, j.bot])).toEqual([
      ['cuenta-1', null],
      [null, 'dificil'],
      [null, 'dificil'],
      [null, 'dificil'],
    ]);
    expect(h.eventos()).toBeGreaterThan(0);
  });

  it('como invitado no se guarda nada', () => {
    const h = historialFalso();
    mesaCon({ cuentaId: null, invitado: true, clave: 'i:abc' }, h.historial);
    expect(h.juegos).toHaveLength(0);
    expect(h.eventos()).toBe(0);
  });
});

describe('jugar contra bots desde el gestor (fase 8)', () => {
  it('crea la sala, suma los bots y la inicia sola, sin límite de tiempo', () => {
    const reloj = new RelojManual();
    const gestor = new GestorSalas({ sala: { reloj, crearAzar: () => createSeededRng(9) } });
    const recibidos: MensajeServidor[] = [];
    let respuesta: Respuesta | null = null;
    gestor.jugarContraBots(
      { tipo: 'invitado', clave: 'i:x', nombre: 'Lore', cuentaId: null },
      { enviar: (m) => recibidos.push(m) },
      (r) => (respuesta = r),
      4,
      'medio',
    );
    const r = respuesta as Respuesta | null;
    expect(r?.ok).toBe(true);
    const sala = gestor.buscar(String(r!.ok && r!.datos['codigo']))!;
    expect(sala.estadoDelJuego?.players.map((p) => p.name)).toEqual(['Lore', 'Bot 1', 'Bot 2', 'Bot 3', 'Bot 4']);
    expect(sala.vistaPara(String(r!.ok && r!.datos['idJugador']))?.tiempoTurnoMs).toBeNull();
    const estado = recibidos.reduce(aplicarMensaje, ESTADO_CLIENTE_INICIAL);
    expect(estado.sala?.jugadores.filter((j) => j.bot === 'medio')).toHaveLength(4);
    expect(estado.sala?.juego).not.toBeNull();
    gestor.cerrarTodas();
  });
});

describe('protocolo de bots (fase 8)', () => {
  const pedir = (tipo: string, datos: unknown) => leerPedido({ v: 2, tipo, idPedido: 'x', datos });

  it('jugar contra bots: de 3 a 6 bots y un nivel válido', () => {
    expect(pedir('sala.jugarContraBots', { cantidad: 3, nivel: 'facil' }).ok).toBe(true);
    expect(pedir('sala.jugarContraBots', { cantidad: 6, nivel: 'dificil', tiempoTurno: null }).ok).toBe(true);
    expect(pedir('sala.jugarContraBots', { cantidad: 2, nivel: 'facil' }).ok).toBe(false);
    expect(pedir('sala.jugarContraBots', { cantidad: 7, nivel: 'facil' }).ok).toBe(false);
    expect(pedir('sala.jugarContraBots', { cantidad: 4, nivel: 'experto' }).ok).toBe(false);
    expect(pedir('sala.agregarBot', { nivel: 'medio' }).ok).toBe(true);
    expect(pedir('sala.agregarBot', {}).ok).toBe(false);
    expect(pedir('sala.quitarBot', { idJugador: 'abc' }).ok).toBe(true);
  });
});
