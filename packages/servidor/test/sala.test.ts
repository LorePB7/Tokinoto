import { currentTurn, forbiddenBetFor, getCardById, playableCards, totalScores } from '@tokinoto/reglas';
import { describe, expect, it } from 'vitest';
import { Sala } from '../src/sala';
import { armarMesa, cartasEn, indiceDeAsiento, jugarHastaElFinal, type Mesa } from './ayudas';

const OK = { ok: true, datos: {} };

function iniciar(mesa: Mesa): void {
  expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
}

/** Índice del jugador al que le toca actuar. */
function deTurno(mesa: Mesa): number {
  const turno = currentTurn(mesa.sala.estadoDelJuego!);
  if (!turno) throw new Error('No es el turno de nadie');
  return indiceDeAsiento(mesa, turno.seat);
}

/** Apuesta 0 con todos hasta que le toque al Pié (o lo prohibido le obligue a otra cosa). */
function apostarHastaElPie(mesa: Mesa): number {
  for (;;) {
    const juego = mesa.sala.estadoDelJuego!;
    const turno = currentTurn(juego)!;
    const indice = indiceDeAsiento(mesa, turno.seat);
    if (turno.seat === juego.dealerSeat) return indice;
    expect(mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor: 0 } })).toEqual(OK);
  }
}

describe('constructor', () => {
  it('rechaza cupos fuera de 4 a 7', () => {
    expect(() => new Sala('X', { maxJugadores: 3 })).toThrow(/4 a 7/);
    expect(() => new Sala('X', { maxJugadores: 8 })).toThrow(/4 a 7/);
    expect(() => new Sala('X', { maxJugadores: 4.5 })).toThrow(/4 a 7/);
  });
});

describe('lobby', () => {
  it('el primero es anfitrión; cada uno recibe su respuesta y una foto; los demás, el aviso', () => {
    const mesa = armarMesa(2);
    const [ana, beto] = mesa.jugadores;
    expect(mesa.sala.idAnfitrion).toBe(ana!.id);
    expect(mesa.sala.estado).toBe('ESPERANDO');

    // Ana: respuesta, foto, y después el aviso de que entró Beto.
    expect(ana!.recibidos.map((m) => m.tipo)).toEqual(['ok', 'estado.foto', 'sala.jugadorEntro']);
    const okAna = ana!.recibidos[0]!;
    expect(okAna.datos).toMatchObject({ codigo: 'PRUEBA23', idJugador: ana!.id });
    expect((okAna.datos as { token: string }).token.length).toBeGreaterThanOrEqual(32);

    // Beto no recibe su propio aviso: la foto ya lo incluye.
    expect(beto!.recibidos.map((m) => m.tipo)).toEqual(['ok', 'estado.foto']);
    const foto = beto!.recibidos[1]!;
    expect(foto).toMatchObject({ seq: 2 });
    expect(foto.datos).toMatchObject({
      codigo: 'PRUEBA23',
      estado: 'ESPERANDO',
      yo: beto!.id,
      anfitrion: ana!.id,
      maxJugadores: 7,
      jugadores: [
        { idJugador: ana!.id, nombre: 'Jugador 1', conectado: true, piloto: null, bot: null },
        { idJugador: beto!.id, nombre: 'Jugador 2', conectado: true, piloto: null, bot: null },
      ],
    });
    // El token es secreto: no aparece en lo que reciben los demás.
    expect(JSON.stringify(ana!.recibidos)).not.toContain(beto!.token);
  });

  it('rechaza nombres repetidos (sin importar mayúsculas) y la sala llena', () => {
    const mesa = armarMesa(4, { maxJugadores: 5 });
    expect(mesa.sumar('  jugador 1 ').respuesta).toMatchObject({ ok: false, error: { codigo: 'NOMBRE_EN_USO' } });
    expect(mesa.sumar('Quinto').respuesta.ok).toBe(true);
    expect(mesa.sumar('Sexto').respuesta).toMatchObject({ ok: false, error: { codigo: 'SALA_LLENA' } });
  });

  it('si el anfitrión se va, el rol pasa al siguiente; vacía, la sala se cierra', () => {
    const mesa = armarMesa(3, { graciaLobbyMs: 0 });
    const [ana, beto, caro] = mesa.jugadores;
    expect(mesa.comando(0, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.sala.idAnfitrion).toBe(beto!.id);
    expect(mesa.eventos(2).map((e) => e.tipo).slice(-2)).toEqual(['sala.jugadorSalio', 'sala.anfitrionCambio']);
    expect(mesa.eventos(2, 'sala.jugadorSalio')[0]!.datos).toEqual({ idJugador: ana!.id });
    // Quien se fue ya no recibe nada.
    const antes = ana!.recibidos.length;
    mesa.sala.desconectar(caro!.id);
    expect(ana!.recibidos).toHaveLength(antes);
    expect(mesa.sala.cantidadJugadores).toBe(1);
    expect(mesa.vaciada()).toBe(false);
    mesa.sala.desconectar(beto!.id);
    expect(mesa.vaciada()).toBe(true);
    expect(mesa.sala.estaCerrada).toBe(true);
    expect(mesa.sumar('Tarde').respuesta).toMatchObject({ ok: false, error: { codigo: 'SALA_NO_EXISTE' } });
  });

  it('un id ajeno no puede mandar comandos', () => {
    const mesa = armarMesa(1);
    let respuesta: unknown;
    mesa.sala.comando('inventado', 'x', { tipo: 'sala.iniciar' }, (r) => (respuesta = r));
    expect(respuesta).toMatchObject({ ok: false, error: { codigo: 'NO_PERTENECE_A_SALA' } });
  });
});

describe('configuración de la sala (DP-11 y DP-13)', () => {
  it('solo el anfitrión cambia el tiempo por jugada, antes de empezar, y todos se enteran', () => {
    const mesa = armarMesa(4);
    const [ana, beto] = mesa.jugadores;
    expect(mesa.comando(1, { tipo: 'sala.configurar', datos: { tiempoTurno: 60 } })).toMatchObject({
      ok: false,
      error: { codigo: 'NO_ES_ANFITRION' },
    });
    expect(mesa.comando(0, { tipo: 'sala.configurar', datos: { tiempoTurno: 60 } })).toEqual(OK);
    expect(beto!.recibidos.at(-1)).toMatchObject({ tipo: 'sala.configuracion', datos: { tiempoTurnoMs: 60_000 } });
    expect(mesa.sala.vistaPara(ana!.id)?.tiempoTurnoMs).toBe(60_000);
    expect(mesa.comando(0, { tipo: 'sala.configurar', datos: { tiempoTurno: null } })).toEqual(OK);
    expect(mesa.sala.vistaPara(beto!.id)?.tiempoTurnoMs).toBeNull();
    iniciar(mesa);
    expect(mesa.comando(0, { tipo: 'sala.configurar', datos: { tiempoTurno: 30 } })).toMatchObject({
      ok: false,
      error: { codigo: 'JUEGO_YA_INICIADO' },
    });
  });

  it('consultar dice si el lugar de un token sigue en pie, sin conectar a nadie', () => {
    const mesa = armarMesa(4);
    const respuestas: unknown[] = [];
    mesa.sala.consultar(mesa.jugadores[1]!.token, (r) => respuestas.push(r));
    mesa.sala.consultar('PRUEBA23.otro-token-que-no-existe', (r) => respuestas.push(r));
    expect(respuestas).toEqual([
      { ok: true, datos: { vigente: true, codigo: 'PRUEBA23', estado: 'ESPERANDO' } },
      { ok: true, datos: { vigente: false } },
    ]);
    expect(mesa.jugadores[1]!.recibidos.at(-1)?.tipo).not.toBe('estado.foto');
  });

  it('las salas del servidor admiten hasta 7 aunque se pida otro cupo', () => {
    const mesa = armarMesa(7);
    expect(mesa.sumar('Octavo').respuesta).toMatchObject({ ok: false, error: { codigo: 'SALA_LLENA' } });
  });
});

describe('inicio del juego', () => {
  it('solo el anfitrión inicia, y con 4 a 7 jugadores', () => {
    const mesa = armarMesa(3);
    expect(mesa.comando(1, { tipo: 'sala.iniciar' })).toMatchObject({ error: { codigo: 'NO_ES_ANFITRION' } });
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toMatchObject({
      error: { codigo: 'CANTIDAD_JUGADORES_INVALIDA' },
    });
    mesa.sumar('Cuarto');
    iniciar(mesa);
    expect(mesa.sala.estado).toBe('JUGANDO');
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toMatchObject({ error: { codigo: 'JUEGO_YA_INICIADO' } });
    expect(mesa.sumar('Tarde').respuesta).toMatchObject({ ok: false, error: { codigo: 'JUEGO_YA_INICIADO' } });
  });

  it('emite inicio, sorteo, primera partida, manos y primer turno; la respuesta llega antes que los eventos', () => {
    const mesa = armarMesa(5);
    iniciar(mesa);
    const juego = mesa.sala.estadoDelJuego!;
    const anfitrion = mesa.jugadores[0]!;
    const desdeElOk = anfitrion.recibidos.slice(anfitrion.recibidos.findIndex((m) => m.tipo === 'ok' && m.idPedido !== 'ingreso'));
    expect(desdeElOk[0]!.tipo).toBe('ok');

    const tipos = desdeElOk.slice(1).map((m) => m.tipo);
    expect(tipos[0]).toBe('juego.iniciado');
    expect(tipos.filter((t) => t === 'sorteo.cartasSacadas').length).toBe(juego.dealerDraw.length);
    expect(tipos.slice(-4)).toEqual(['sorteo.resultado', 'partida.iniciada', 'partida.manoRepartida', 'apuesta.turno']);

    const inicio = mesa.eventos(0, 'juego.iniciado')[0]!;
    expect(inicio.datos).toEqual({
      asientos: mesa.jugadores.map((j, asiento) => ({ asiento, idJugador: j.id, nombre: j.nombre })),
    });
    expect(mesa.eventos(0, 'sorteo.resultado')[0]!.datos).toEqual({ repartidor: juego.dealerSeat });
    expect(mesa.eventos(0, 'partida.iniciada')[0]!.datos).toEqual({
      partida: 1,
      cartasPorJugador: 1,
      repartidor: juego.dealerSeat,
      pie: juego.dealerSeat,
      mano: juego.leadSeat,
    });
    expect(mesa.eventos(0, 'apuesta.turno')[0]!.datos).toEqual({
      asiento: currentTurn(juego)!.seat,
      valorProhibido: null,
      // El reloj de prueba está en 0: la fecha límite es la hora más el tiempo por jugada (30 s).
      fechaLimite: 30_000,
    });
  });

  it('cada jugador recibe solo sus cartas; de los demás, la cantidad', () => {
    const mesa = armarMesa(6);
    iniciar(mesa);
    const juego = mesa.sala.estadoDelJuego!;
    mesa.jugadores.forEach((jugador, indice) => {
      const asiento = juego.players.findIndex((p) => p.id === jugador.id);
      const mano = mesa.eventos(indice, 'partida.manoRepartida')[0]!;
      expect(mano.datos).toEqual({
        cantidades: [1, 1, 1, 1, 1, 1],
        cartas: juego.hands[asiento]!.map((c) => c.id),
      });
    });
  });

  it('el sorteo marca a quiénes repiten cuando hay empate', () => {
    // Buscamos una semilla con empate en el sorteo.
    for (let semilla = 1; semilla < 200; semilla++) {
      const mesa = armarMesa(7, { semilla });
      iniciar(mesa);
      const sorteos = mesa.eventos(0, 'sorteo.cartasSacadas');
      if (sorteos.length < 2) continue;
      const primero = sorteos[0]!.datos as { sacadas: { asiento: number }[]; repiten: number[] };
      const segundo = sorteos[1]!.datos as { sacadas: { asiento: number }[]; repiten: number[] };
      expect(primero.sacadas).toHaveLength(7);
      expect(primero.repiten.length).toBeGreaterThan(1);
      expect(segundo.sacadas.map((s) => s.asiento)).toEqual(primero.repiten);
      expect((sorteos.at(-1)!.datos as { repiten: number[] }).repiten).toEqual([]);
      return;
    }
    throw new Error('No se encontró una semilla con empate');
  });
});

describe('apuestas y tiradas', () => {
  it('rechaza jugadas fuera de turno, sin avisar a los demás', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    const turno = deTurno(mesa);
    const otro = (turno + 1) % 4;
    const testigo = (turno + 2) % 4;
    const antes = mesa.jugadores[testigo]!.recibidos.length;
    expect(mesa.comando(otro, { tipo: 'juego.apostar', datos: { valor: 0 } })).toMatchObject({
      ok: false,
      error: { codigo: 'NO_ES_TU_TURNO' },
    });
    expect(mesa.jugadores[testigo]!.recibidos).toHaveLength(antes);
  });

  it('valida el rango de la apuesta y el valor prohibido del Pié', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    const turno = deTurno(mesa);
    expect(mesa.comando(turno, { tipo: 'juego.apostar', datos: { valor: 2 } })).toMatchObject({
      error: { codigo: 'APUESTA_FUERA_DE_RANGO' },
    });
    expect(mesa.comando(turno, { tipo: 'juego.apostar', datos: { valor: 0.5 } })).toMatchObject({
      error: { codigo: 'APUESTA_FUERA_DE_RANGO' },
    });
    const pie = apostarHastaElPie(mesa);
    const juego = mesa.sala.estadoDelJuego!;
    const prohibido = forbiddenBetFor(juego, juego.dealerSeat!);
    expect(prohibido).toBe(1); // los demás apostaron 0 y hay 1 carta
    expect(mesa.eventos(0, 'apuesta.turno').at(-1)!.datos).toMatchObject({ valorProhibido: 1 });
    expect(mesa.comando(pie, { tipo: 'juego.apostar', datos: { valor: 1 } })).toMatchObject({
      error: { codigo: 'APUESTA_PROHIBIDA_PIE' },
    });
    expect(mesa.comando(pie, { tipo: 'juego.apostar', datos: { valor: 0 } })).toEqual(OK);
    expect(mesa.eventos(0, 'apuesta.realizada')).toHaveLength(4);
    // Con la última apuesta empieza la primera baza.
    expect(mesa.eventos(0).slice(-3).map((e) => e.tipo)).toEqual(['apuesta.realizada', 'baza.iniciada', 'baza.turno']);
  });

  it('rechaza cartas que el jugador no tiene', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    apostarHastaElPie(mesa);
    mesa.comando(deTurno(mesa), { tipo: 'juego.apostar', datos: { valor: 0 } });
    const turno = deTurno(mesa);
    const asiento = mesa.sala.estadoDelJuego!.players.findIndex((p) => p.id === mesa.jugadores[turno]!.id);
    const ajena = mesa.sala.estadoDelJuego!.hands[(asiento + 1) % 4]![0]!;
    for (const idCarta of [ajena.id, 'NO-EXISTE']) {
      expect(mesa.comando(turno, { tipo: 'juego.jugarCarta', datos: { idCarta } })).toMatchObject({
        error: { codigo: 'CARTA_NO_EN_MANO' },
      });
    }
    expect(mesa.comando(turno, { tipo: 'juego.apostar', datos: { valor: 0 } })).toMatchObject({
      error: { codigo: 'ESTADO_INVALIDO' },
    });
  });

  it('sin juego, los comandos de juego responden JUEGO_NO_INICIADO', () => {
    const mesa = armarMesa(4);
    for (const comando of [
      { tipo: 'juego.apostar', datos: { valor: 0 } },
      { tipo: 'juego.jugarCarta', datos: { idCarta: 'K-picas' } },
      { tipo: 'juego.revancha' },
    ] as const) {
      expect(mesa.comando(0, comando)).toMatchObject({ error: { codigo: 'JUEGO_NO_INICIADO' } });
    }
  });
});

describe('idempotencia', () => {
  it('un pedido repetido se ejecuta una sola vez y recibe la misma respuesta', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    const turno = deTurno(mesa);
    expect(mesa.comando(turno, { tipo: 'juego.apostar', datos: { valor: 1 } }, 'repetido')).toEqual(OK);
    expect(mesa.comando(turno, { tipo: 'juego.apostar', datos: { valor: 1 } }, 'repetido')).toEqual(OK);
    expect(mesa.eventos(0, 'apuesta.realizada')).toHaveLength(1);

    const otro = deTurno(mesa);
    const error = mesa.comando((otro + 1) % 4, { tipo: 'juego.apostar', datos: { valor: 0 } }, 'fallido');
    expect(error.ok).toBe(false);
    // Aunque ahora sea su turno, el mismo idPedido devuelve el rechazo original.
    expect(mesa.comando((otro + 1) % 4, { tipo: 'juego.apostar', datos: { valor: 0 } }, 'fallido')).toEqual(error);
  });

  it('los idPedido de distintos jugadores no se mezclan', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    const primero = deTurno(mesa);
    expect(mesa.comando(primero, { tipo: 'juego.apostar', datos: { valor: 0 } }, 'mismo')).toEqual(OK);
    const segundo = deTurno(mesa);
    expect(mesa.comando(segundo, { tipo: 'juego.apostar', datos: { valor: 0 } }, 'mismo')).toEqual(OK);
    expect(mesa.eventos(0, 'apuesta.realizada')).toHaveLength(2);
  });
});

describe('pausas (el tiempo lo maneja el servidor)', () => {
  function hastaLaPrimeraBazaResuelta(mesa: Mesa): void {
    while (mesa.sala.estadoDelJuego!.phase !== 'TRICK_RESOLUTION') {
      const juego = mesa.sala.estadoDelJuego!;
      const turno = currentTurn(juego)!;
      const indice = indiceDeAsiento(mesa, turno.seat);
      if (turno.kind === 'bet') {
        const valor = forbiddenBetFor(juego, turno.seat) === 0 ? 1 : 0;
        mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor } });
      } else {
        mesa.comando(indice, { tipo: 'juego.jugarCarta', datos: { idCarta: playableCards(juego, turno.seat)[0]!.id } });
      }
    }
  }

  it('la baza resuelta queda 3 s a la vista y el resumen 6 s', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    hastaLaPrimeraBazaResuelta(mesa);
    expect(mesa.eventos(0).at(-1)!.tipo).toBe('baza.resuelta');
    mesa.reloj.avanzar(2999);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('TRICK_RESOLUTION');
    mesa.reloj.avanzar(1);
    // Partida 1 tiene una sola baza: después de la pausa se puntúa.
    expect(mesa.sala.estadoDelJuego!.phase).toBe('ROUND_SUMMARY');
    const puntajes = mesa.eventos(0, 'partida.puntajes')[0]!.datos as { totales: number[]; finResumen: number };
    expect(puntajes.totales).toEqual(totalScores(mesa.sala.estadoDelJuego!));
    // La hora en que termina el resumen viaja con los puntajes y en la foto.
    expect(puntajes.finResumen).toBe(mesa.reloj.ahora() + 6000);
    expect(mesa.sala.vistaPara(mesa.jugadores[1]!.id)!.juego!.finResumen).toBe(puntajes.finResumen);
    mesa.reloj.avanzar(5999);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('ROUND_SUMMARY');
    mesa.reloj.avanzar(1);
    expect(mesa.sala.estadoDelJuego!.roundNumber).toBe(2);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('BETTING');
    expect(mesa.sala.vistaPara(mesa.jugadores[1]!.id)!.juego!.finResumen).toBeNull();
  });
});

describe('juego completo', () => {
  for (const cantidad of [4, 5, 6, 7]) {
    it(`${cantidad} jugadores juegan las 14 partidas sin errores del servidor`, () => {
      const mesa = armarMesa(cantidad, { semilla: cantidad });
      iniciar(mesa);
      jugarHastaElFinal(mesa);
      expect(mesa.errores).toEqual([]);
      expect(mesa.sala.estado).toBe('TERMINADO');
      expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
      expect(mesa.eventos(0, 'baza.resuelta')).toHaveLength(56);
      expect(mesa.eventos(0, 'partida.puntajes')).toHaveLength(14);
      expect(mesa.reloj.pendientes).toBe(0);

      const ranking = mesa.eventos(0, 'juego.terminado')[0]!.datos as { ranking: { asiento: number; total: number }[] };
      const totales = totalScores(mesa.sala.estadoDelJuego!);
      for (const entrada of ranking.ranking) expect(entrada.total).toBe(totales[entrada.asiento]);
    });
  }

  it('cada jugador recibe todos los eventos, con seq consecutivo y los mismos datos públicos', () => {
    const mesa = armarMesa(5, { semilla: 3 });
    iniciar(mesa);
    jugarHastaElFinal(mesa);
    const total = mesa.sala.ultimoSeq;
    const referencia = mesa.sala.eventos;
    mesa.jugadores.forEach((jugador, indice) => {
      const foto = jugador.recibidos.find((m) => m.tipo === 'estado.foto') as { seq: number };
      const eventos = mesa.eventos(indice);
      expect(eventos.map((e) => e.seq)).toEqual(
        Array.from({ length: total - foto.seq }, (_, i) => foto.seq + 1 + i),
      );
      for (const evento of eventos) {
        const registrado = referencia[evento.seq - 1]!;
        expect(evento.tipo).toBe(registrado.tipo);
        expect(evento.datos).toEqual(registrado.privados?.get(jugador.id) ?? registrado.datos);
      }
    });
  });

  it('nadie ve una carta ajena antes de que se juegue', () => {
    const mesa = armarMesa(7, { semilla: 9 });
    iniciar(mesa);
    jugarHastaElFinal(mesa);
    const reveladoras = new Set(['sorteo.cartasSacadas', 'baza.cartaJugada']);
    mesa.jugadores.forEach((jugador, indice) => {
      let visibles = new Set<string>();
      for (const evento of mesa.eventos(indice)) {
        const cartas = cartasEn(evento.datos);
        if (evento.tipo === 'partida.manoRepartida') {
          // Una partida nueva: solo conoce sus cartas (las jugadas antes vuelven al mazo).
          visibles = new Set(cartas);
          continue;
        }
        if (reveladoras.has(evento.tipo)) {
          for (const carta of cartas) visibles.add(carta);
          continue;
        }
        for (const carta of cartas) expect(visibles.has(carta), `${evento.tipo} mostró ${carta}`).toBe(true);
      }
    });

    // Y en cada reparto, las manos privadas son disjuntas y coinciden con la cantidad pública.
    const repartos = mesa.sala.eventos.filter((e) => e.tipo === 'partida.manoRepartida');
    expect(repartos).toHaveLength(14);
    for (const reparto of repartos) {
      const todas = [...reparto.privados!.values()].flatMap((d) => d['cartas'] as string[]);
      expect(new Set(todas).size).toBe(todas.length);
      expect(todas.every((id) => getCardById(id))).toBe(true);
      const cantidades = reparto.datos['cantidades'] as number[];
      expect(todas.length).toBe(cantidades.reduce((a, b) => a + b, 0));
    }
  });
});

describe('revancha', () => {
  it('solo al terminar, solo el anfitrión; empieza otro juego con puntajes en cero y nuevo sorteo', () => {
    const mesa = armarMesa(4, { semilla: 5 });
    iniciar(mesa);
    expect(mesa.comando(0, { tipo: 'juego.revancha' })).toMatchObject({ error: { codigo: 'ESTADO_INVALIDO' } });
    jugarHastaElFinal(mesa);
    expect(mesa.comando(2, { tipo: 'juego.revancha' })).toMatchObject({ error: { codigo: 'NO_ES_ANFITRION' } });
    const seqAntes = mesa.sala.ultimoSeq;
    expect(mesa.comando(0, { tipo: 'juego.revancha' })).toEqual(OK);
    const juego = mesa.sala.estadoDelJuego!;
    expect(mesa.sala.estado).toBe('JUGANDO');
    expect(juego.roundNumber).toBe(1);
    expect(totalScores(juego)).toEqual([0, 0, 0, 0]);
    const nuevos = mesa.eventos(1).filter((e) => e.seq > seqAntes);
    expect(nuevos[0]!.tipo).toBe('juego.iniciado');
    expect(nuevos.some((e) => e.tipo === 'sorteo.resultado')).toBe(true);
    jugarHastaElFinal(mesa);
    expect(mesa.errores).toEqual([]);
    expect(mesa.eventos(1, 'juego.terminado')).toHaveLength(2);
  });
});

describe('desconexiones', () => {
  it('en juego el asiento se conserva, se avisa, el anfitrión pasa a otro y el piloto toma el asiento', () => {
    const mesa = armarMesa(4);
    iniciar(mesa);
    const [ana, beto] = mesa.jugadores;
    mesa.sala.desconectar(ana!.id);
    expect(mesa.sala.cantidadJugadores).toBe(4);
    expect(mesa.sala.idAnfitrion).toBe(beto!.id);
    const avisos = mesa.eventos(1).filter((e) => e.tipo !== 'apuesta.turno');
    expect(avisos.slice(-3).map((e) => [e.tipo, e.datos])).toEqual([
      ['jugador.conexion', { idJugador: ana!.id, asiento: 0, conectado: false }],
      ['sala.anfitrionCambio', { anfitrion: beto!.id }],
      ['jugador.pilotoAutomatico', { idJugador: ana!.id, asiento: 0, activado: true, motivo: 'desconexion' }],
    ]);
    // Desconectar dos veces no repite el aviso.
    const cantidad = mesa.eventos(1).length;
    mesa.sala.desconectar(ana!.id);
    expect(mesa.eventos(1)).toHaveLength(cantidad);
  });

  it('si no queda nadie conectado, la mesa espera y, si nadie vuelve, el juego se aborta y la sala se cierra', () => {
    const mesa = armarMesa(4, { semilla: 2, esperaAbortoMs: 60_000 });
    iniciar(mesa);
    // Llegamos a una baza resuelta para que haya una pausa programada.
    while (mesa.sala.estadoDelJuego!.phase !== 'TRICK_RESOLUTION') {
      const juego = mesa.sala.estadoDelJuego!;
      const turno = currentTurn(juego)!;
      const indice = indiceDeAsiento(mesa, turno.seat);
      if (turno.kind === 'bet') {
        mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor: forbiddenBetFor(juego, turno.seat) === 0 ? 1 : 0 } });
      } else {
        mesa.comando(indice, { tipo: 'juego.jugarCarta', datos: { idCarta: playableCards(juego, turno.seat)[0]!.id } });
      }
    }
    expect(mesa.reloj.pendientes).toBe(1);
    for (const jugador of mesa.jugadores) mesa.sala.desconectar(jugador.id);
    expect(mesa.vaciada()).toBe(false);
    const desde = mesa.sala.eventos.length;
    // La baza termina y empieza la siguiente, pero el piloto no juega sin nadie mirando.
    mesa.reloj.avanzar(59_000);
    expect(mesa.sala.estadoDelJuego!.phase).not.toBe('TRICK_RESOLUTION');
    const jugadas = mesa.sala.eventos.slice(desde).filter((e) => e.tipo === 'apuesta.realizada' || e.tipo === 'baza.cartaJugada');
    expect(jugadas).toEqual([]);
    mesa.reloj.avanzar(1_000);
    expect(mesa.sala.estadoDelJuego!.phase).toBe('ABORTED');
    expect(mesa.sala.eventos.at(-1)).toMatchObject({ tipo: 'juego.abortado', datos: { motivo: 'No quedó ningún jugador conectado' } });
    expect(mesa.vaciada()).toBe(true);
    expect(mesa.reloj.pendientes).toBe(0);
  });

  it('terminado el juego, salir equivale a desconectarse', () => {
    const mesa = armarMesa(4, { semilla: 4 });
    iniciar(mesa);
    jugarHastaElFinal(mesa);
    expect(mesa.comando(3, { tipo: 'sala.salir' })).toEqual(OK);
    expect(mesa.sala.cantidadJugadores).toBe(4);
    expect(mesa.eventos(0).at(-1)).toMatchObject({ tipo: 'jugador.conexion', datos: { conectado: false } });
  });
});

describe('errores inesperados', () => {
  it('un fallo al enviar a un jugador no rompe la sala ni afecta a los demás', () => {
    const mesa = armarMesa(3);
    mesa.sala.unirse('Rompe', { enviar: () => { throw new Error('conexión rota'); } }, () => {});
    iniciar(mesa);
    expect(mesa.sala.estado).toBe('JUGANDO');
    expect(mesa.errores.length).toBeGreaterThan(0);
    expect(mesa.eventos(1, 'apuesta.turno')).toHaveLength(1);
  });
});
