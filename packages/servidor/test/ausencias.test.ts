/**
 * Etapa 6: ausencias (DP-12 a DP-14).
 *  - Tiempo límite por jugada; al vencer, juega el piloto automático.
 *  - Tras 3 vencimientos seguidos, el piloto toma el asiento hasta que el jugador vuelva a actuar.
 *  - Desconexión o abandono: el piloto juega por él; con su token puede volver.
 *  - Sin nadie conectado, la mesa espera y, si nadie vuelve, el juego se aborta.
 */
import { currentTurn, lowestCard, playableCards, validBetsFor } from '@tokinoto/reglas';
import { describe, expect, it } from 'vitest';
import { armarMesa, indiceDeAsiento, jugarHasta, jugarHastaElFinal, type Mesa } from './ayudas';

const OK = { ok: true, datos: {} };

function iniciar(mesa: Mesa): void {
  expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
}

/** Índice (en mesa.jugadores) de quien tiene el turno. */
function deTurno(mesa: Mesa): number {
  const turno = currentTurn(mesa.sala.estadoDelJuego!);
  if (!turno) throw new Error('No hay turno');
  return indiceDeAsiento(mesa, turno.seat);
}

/** Hace la jugada válida más simple para quien tiene el turno. */
function jugarUna(mesa: Mesa): void {
  const juego = mesa.sala.estadoDelJuego!;
  const turno = currentTurn(juego)!;
  const indice = indiceDeAsiento(mesa, turno.seat);
  const respuesta =
    turno.kind === 'bet'
      ? mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor: validBetsFor(juego, turno.seat).at(-1)! } })
      : mesa.comando(indice, { tipo: 'juego.jugarCarta', datos: { idCarta: playableCards(juego, turno.seat).at(-1)!.id } });
  expect(respuesta).toEqual(OK);
}

/** Avanza el reloj hasta que haya un turno (saltando pausas de baza y de resumen). */
function hastaElProximoTurno(mesa: Mesa): void {
  for (let i = 0; i < 20 && !currentTurn(mesa.sala.estadoDelJuego!); i++) mesa.reloj.avanzarAlProximo();
}

const pilotos = (mesa: Mesa, indice: number) =>
  mesa.eventos(indice, 'jugador.pilotoAutomatico').map((e) => e.datos);

describe('tiempo límite por jugada', () => {
  it('cada turno trae su fecha límite y, al vencer, el piloto juega el menor valor válido', () => {
    const mesa = armarMesa(4, { semilla: 3 });
    iniciar(mesa);
    const turno = mesa.eventos(0, 'apuesta.turno').at(-1)!;
    expect(turno.datos).toMatchObject({ fechaLimite: 30_000 });
    expect(mesa.sala.vistaPara(mesa.jugadores[0]!.id)!.juego!.turno).toMatchObject({ fechaLimite: 30_000 });

    const juego = mesa.sala.estadoDelJuego!;
    const asiento = currentTurn(juego)!.seat;
    const menor = validBetsFor(juego, asiento)[0];
    mesa.reloj.avanzar(29_999);
    expect(mesa.eventos(0, 'apuesta.realizada')).toHaveLength(0);
    mesa.reloj.avanzar(1);
    expect(mesa.eventos(0, 'apuesta.realizada').at(-1)!.datos).toEqual({ asiento, valor: menor, porPiloto: true });
    // Un solo vencimiento no activa el piloto de forma permanente.
    expect(pilotos(mesa, 0)).toEqual([]);
    // El siguiente turno arranca con su propio plazo.
    expect(mesa.eventos(0, 'apuesta.turno').at(-1)!.datos).toMatchObject({ fechaLimite: 60_000 });
  });

  it('la jugada que llega tarde se rechaza', () => {
    const mesa = armarMesa(4, { semilla: 3 });
    iniciar(mesa);
    const indice = deTurno(mesa);
    mesa.reloj.avanzar(30_000);
    const respuesta = mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor: 0 } });
    expect(respuesta.ok).toBe(false);
    // El motor da el motivo más preciso: ya apostó (por él, el piloto).
    expect(!respuesta.ok && respuesta.error.codigo).toBe('APUESTA_YA_REALIZADA');
  });

  it('el piloto juega la carta de menor valor', () => {
    const mesa = armarMesa(4, { semilla: 5 });
    iniciar(mesa);
    jugarHasta(mesa, () => mesa.sala.estadoDelJuego!.phase === 'PLAYING');
    const juego = mesa.sala.estadoDelJuego!;
    const asiento = currentTurn(juego)!.seat;
    const menor = lowestCard(juego.hands[asiento]!)!;
    mesa.reloj.avanzar(30_000);
    expect(mesa.eventos(0, 'baza.cartaJugada').at(-1)!.datos).toEqual({ asiento, carta: menor.id, porPiloto: true });
  });

  it('tras 3 vencimientos seguidos el piloto toma el asiento; jugar a tiempo reinicia la cuenta', () => {
    const mesa = armarMesa(4, { semilla: 9, pausaBazaMs: 0, pausaResumenMs: 0, pausaPilotoMs: 500 });
    iniciar(mesa);
    const lento = deTurno(mesa);
    const id = mesa.jugadores[lento]!.id;
    let vencidos = 0;
    let jugoATiempo = false;

    // Todos juegan enseguida salvo `lento`, que deja vencer 2, juega una vez a tiempo y después deja vencer 3.
    for (let pasos = 0; pasos < 2000 && mesa.sala.estadoDelJuego!.phase !== 'FINISHED'; pasos++) {
      hastaElProximoTurno(mesa);
      if (mesa.sala.estado !== 'JUGANDO') break;
      if (deTurno(mesa) !== lento) {
        jugarUna(mesa);
        continue;
      }
      const jugador = mesa.sala.vistaPara(id)!.jugadores.find((j) => j.idJugador === id)!;
      if (jugador.piloto) break;
      if (vencidos === 2 && !jugoATiempo) {
        jugarUna(mesa);
        jugoATiempo = true;
        continue;
      }
      mesa.reloj.avanzar(30_000);
      vencidos++;
    }
    // 2 vencidos + 1 a tiempo + 3 vencidos: recién ahí toma el asiento.
    expect(vencidos).toBe(5);
    expect(pilotos(mesa, lento)).toEqual([{ idJugador: id, asiento: expect.any(Number), activado: true, motivo: 'tiempo' }]);

    // Con el piloto activo, su turno no tiene fecha límite y el piloto juega en 500 ms.
    hastaElProximoTurno(mesa);
    while (deTurno(mesa) !== lento) {
      jugarUna(mesa);
      hastaElProximoTurno(mesa);
    }
    expect(mesa.sala.vistaPara(id)!.juego!.turno).toMatchObject({ fechaLimite: null });
    const antes = mesa.sala.eventos.length;
    mesa.reloj.avanzar(500);
    expect(mesa.sala.eventos.slice(antes).some((e) => 'porPiloto' in e.datos && e.datos.porPiloto)).toBe(true);

    // Retoma el control: el piloto se apaga y vuelve a tener plazo.
    expect(mesa.comando(lento, { tipo: 'juego.retomarControl' })).toEqual(OK);
    expect(pilotos(mesa, 0).at(-1)).toEqual({ idJugador: id, asiento: expect.any(Number), activado: false, motivo: null });
    expect(mesa.errores).toEqual([]);
  });

  it('una sala sin límite de tiempo no programa vencimientos', () => {
    const mesa = armarMesa(4, { tiempoTurnoMs: null });
    iniciar(mesa);
    expect(mesa.eventos(0, 'apuesta.turno').at(-1)!.datos).toMatchObject({ fechaLimite: null });
    expect(mesa.reloj.pendientes).toBe(0);
    expect(mesa.sala.vistaPara(mesa.jugadores[0]!.id)!.tiempoTurnoMs).toBeNull();
  });
});

describe('desconexión y reconexión', () => {
  it('si se desconecta en su turno, el piloto juega por él tras una pausa corta', () => {
    const mesa = armarMesa(4, { semilla: 3, pausaPilotoMs: 800 });
    iniciar(mesa);
    const indice = deTurno(mesa);
    const asiento = currentTurn(mesa.sala.estadoDelJuego!)!.seat;
    mesa.sala.desconectar(mesa.jugadores[indice]!.id);
    const otro = (indice + 1) % 4;
    // El turno se vuelve a anunciar, sin fecha límite.
    expect(mesa.eventos(otro, 'apuesta.turno').at(-1)!.datos).toMatchObject({ asiento, fechaLimite: null });
    mesa.reloj.avanzar(799);
    expect(mesa.eventos(otro, 'apuesta.realizada')).toHaveLength(0);
    mesa.reloj.avanzar(1);
    expect(mesa.eventos(otro, 'apuesta.realizada').at(-1)!.datos).toMatchObject({ asiento, porPiloto: true });
  });

  it('al volver con su token recupera el asiento, recibe la foto y retoma el control', () => {
    const mesa = armarMesa(4, { semilla: 3 });
    iniciar(mesa);
    const indice = deTurno(mesa);
    const jugador = mesa.jugadores[indice]!;
    mesa.sala.desconectar(jugador.id);
    const recibidosAntes = jugador.recibidos.length;
    mesa.reloj.avanzar(100); // todavía no jugó el piloto

    const respuesta = mesa.reconectar(indice);
    expect(respuesta).toMatchObject({ ok: true, datos: { codigo: 'PRUEBA23', idJugador: jugador.id, token: jugador.token } });
    const nuevos = jugador.recibidos.slice(recibidosAntes);
    expect(nuevos.map((m) => m.tipo)).toEqual(['ok', 'estado.foto', 'apuesta.turno']);
    const foto = nuevos[1]!;
    expect(foto.datos).toMatchObject({ yo: jugador.id });

    // Los demás se enteran de que volvió y de que ya no hay piloto.
    const otro = (indice + 1) % 4;
    const tipos = mesa.eventos(otro).map((e) => e.tipo);
    expect(tipos.slice(-3)).toEqual(['jugador.conexion', 'jugador.pilotoAutomatico', 'apuesta.turno']);
    // Su turno arranca de nuevo con un plazo completo.
    expect(mesa.eventos(otro, 'apuesta.turno').at(-1)!.datos).toMatchObject({ fechaLimite: 100 + 30_000 });
    mesa.reloj.avanzar(5_000);
    expect(mesa.eventos(otro, 'apuesta.realizada')).toHaveLength(0);
  });

  it('un token inválido no entra', () => {
    const mesa = armarMesa(4);
    expect(mesa.reconectar(0, 'PRUEBA23.otro-token-que-no-existe')).toMatchObject({
      ok: false,
      error: { codigo: 'SESION_INVALIDA' },
    });
  });

  it('si entra desde otra pestaña, la conexión anterior queda reemplazada', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    const vieja = mesa.jugadores[1]!.destino;
    const recibidosViejos: string[] = [];
    // Reemplazamos el destino viejo por uno que registra qué le llega.
    const espia = { enviar: (m: { tipo: string; datos?: unknown }) => recibidosViejos.push(JSON.stringify(m)) };
    void vieja;
    mesa.sala.reconectar(mesa.jugadores[1]!.token, espia, () => {});
    expect(mesa.reconectar(1)).toMatchObject({ ok: true });
    expect(recibidosViejos.at(-1)).toContain('SESION_REEMPLAZADA');

    // Lo que mande la conexión vieja se rechaza y su desconexión no cuenta.
    let respuesta: unknown = null;
    mesa.sala.comando(mesa.jugadores[1]!.id, 'x', { tipo: 'sync.pedir' }, (r) => (respuesta = r), espia);
    expect(respuesta).toMatchObject({ ok: false, error: { codigo: 'SESION_REEMPLAZADA' } });
    mesa.sala.desconectar(mesa.jugadores[1]!.id, espia);
    expect(mesa.sala.vistaPara(mesa.jugadores[1]!.id)!.jugadores[1]!.conectado).toBe(true);
  });

  it('salir con el juego en curso es abandonar: el piloto juega por él y no se pisa con la desconexión', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    expect(mesa.comando(2, { tipo: 'sala.salir' })).toEqual(OK);
    const id = mesa.jugadores[2]!.id;
    expect(pilotos(mesa, 0)).toEqual([{ idJugador: id, asiento: 2, activado: true, motivo: 'abandono' }]);
    mesa.sala.desconectar(id);
    expect(mesa.sala.vistaPara(mesa.jugadores[0]!.id)!.jugadores[2]!.piloto).toBe('abandono');
  });

  it('un juego entero se completa con tres jugadores ausentes', () => {
    const mesa = armarMesa(4, { semilla: 12, pausaBazaMs: 0, pausaResumenMs: 0 });
    iniciar(mesa);
    for (const i of [1, 2, 3]) mesa.sala.desconectar(mesa.jugadores[i]!.id);
    for (let pasos = 0; pasos < 3000 && mesa.sala.estadoDelJuego!.phase !== 'FINISHED'; pasos++) {
      const turno = currentTurn(mesa.sala.estadoDelJuego!);
      if (turno && indiceDeAsiento(mesa, turno.seat) === 0) jugarUna(mesa);
      else mesa.reloj.avanzarAlProximo();
    }
    expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
    expect(mesa.eventos(0, 'juego.terminado')).toHaveLength(1);
    expect(mesa.errores).toEqual([]);
  });

  it('si nadie juega nunca, los vencimientos y el piloto terminan el juego igual', () => {
    const mesa = armarMesa(4, { semilla: 13, pausaBazaMs: 0, pausaResumenMs: 0 });
    iniciar(mesa);
    for (let pasos = 0; pasos < 5000 && mesa.sala.estadoDelJuego!.phase !== 'FINISHED'; pasos++) {
      expect(mesa.reloj.avanzarAlProximo()).toBe(true);
    }
    expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
    // Todos terminaron con el piloto por tiempo.
    const vista = mesa.sala.vistaPara(mesa.jugadores[0]!.id)!;
    expect(vista.jugadores.every((j) => j.piloto === 'tiempo')).toBe(true);
    expect(mesa.errores).toEqual([]);
  });

  it('si todos se van, quien vuelve a tiempo evita el aborto y la mesa sigue', () => {
    const mesa = armarMesa(4, { semilla: 4, esperaAbortoMs: 60_000 });
    iniciar(mesa);
    for (const jugador of mesa.jugadores) mesa.sala.desconectar(jugador.id);
    mesa.reloj.avanzar(50_000);
    expect(mesa.reconectar(3)).toMatchObject({ ok: true });
    expect(mesa.sala.idAnfitrion).toBe(mesa.jugadores[3]!.id);
    mesa.reloj.avanzar(20_000);
    expect(mesa.sala.estadoDelJuego!.phase).not.toBe('ABORTED');
    expect(mesa.vaciada()).toBe(false);
    // Los ausentes juegan con piloto; el que volvió, con su plazo.
    jugarHastaElFinal(mesa);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
  });

  it('si alguien vuelve y se va de nuevo, la espera para abortar empieza otra vez', () => {
    const mesa = armarMesa(4, { semilla: 4, esperaAbortoMs: 60_000 });
    iniciar(mesa);
    for (const jugador of mesa.jugadores) mesa.sala.desconectar(jugador.id);
    mesa.reloj.avanzar(50_000);
    expect(mesa.reconectar(0)).toMatchObject({ ok: true });
    mesa.reloj.avanzar(5_000);
    mesa.sala.desconectar(mesa.jugadores[0]!.id);
    // 60 s desde la primera salida: todavía no.
    mesa.reloj.avanzar(10_000);
    expect(mesa.vaciada()).toBe(false);
    // 60 s desde la última salida: ahora sí.
    mesa.reloj.avanzar(50_000);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('ABORTED');
    expect(mesa.vaciada()).toBe(true);
  });

    it('en la revancha, quien sigue ausente empieza con piloto y los presentes sin', () => {
    const mesa = armarMesa(4, { semilla: 6 });
    iniciar(mesa);
    mesa.sala.desconectar(mesa.jugadores[3]!.id);
    jugarHasta(mesa, () => false);
    mesa.sala.desconectar(mesa.jugadores[2]!.id); // terminado: no activa el piloto
    expect(mesa.comando(0, { tipo: 'juego.revancha' })).toEqual(OK);
    const vista = mesa.sala.vistaPara(mesa.jugadores[0]!.id)!;
    expect(vista.jugadores.map((j) => j.piloto)).toEqual([null, null, 'desconexion', 'desconexion']);
  });
});

describe('lobby', () => {
  it('quien recarga la página conserva su lugar; si no vuelve a tiempo, sale', () => {
    const mesa = armarMesa(3, { graciaLobbyMs: 10_000 });
    const [, beto, caro] = mesa.jugadores;
    mesa.sala.desconectar(beto!.id);
    expect(mesa.eventos(0, 'jugador.conexion').at(-1)!.datos).toMatchObject({ idJugador: beto!.id, conectado: false });
    mesa.reloj.avanzar(9_000);
    expect(mesa.reconectar(1)).toMatchObject({ ok: true });
    mesa.reloj.avanzar(5_000);
    expect(mesa.sala.cantidadJugadores).toBe(3);

    mesa.sala.desconectar(caro!.id);
    mesa.reloj.avanzar(10_000);
    expect(mesa.sala.cantidadJugadores).toBe(2);
    expect(mesa.eventos(0, 'sala.jugadorSalio').at(-1)!.datos).toEqual({ idJugador: caro!.id });
    expect(mesa.reconectar(2)).toMatchObject({ ok: false, error: { codigo: 'SESION_INVALIDA' } });
  });

  it('si el juego empieza con alguien desconectado, el piloto juega por él', () => {
    const mesa = armarMesa(4, { graciaLobbyMs: 10_000 });
    mesa.sala.desconectar(mesa.jugadores[3]!.id);
    iniciar(mesa);
    expect(mesa.sala.cantidadJugadores).toBe(4);
    expect(mesa.sala.vistaPara(mesa.jugadores[0]!.id)!.jugadores[3]!.piloto).toBe('desconexion');
    mesa.reloj.avanzar(10_000);
    expect(mesa.sala.cantidadJugadores).toBe(4);
  });
});

