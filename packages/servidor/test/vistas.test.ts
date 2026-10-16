/**
 * Etapa 4: vistas por jugador en la sala.
 *
 * Garantía central: en todo momento, lo que cada cliente reconstruye
 * aplicando los eventos que recibió es idéntico a la foto que le armaría
 * el servidor. Así, la foto (al entrar, reconectar o resincronizar) y los
 * eventos nunca se contradicen.
 */
import {
  ESTADO_CLIENTE_INICIAL,
  aplicarMensaje,
  type EstadoCliente,
  type MensajeFoto,
  type VistaSala,
} from '@tokinoto/protocolo';
import { createSeededRng, currentTurn, playableCards, validBetsFor } from '@tokinoto/reglas';
import { describe, expect, it } from 'vitest';
import { armarMesa, cartasEn, jugarHasta, jugarHastaElFinal, type Mesa } from './ayudas';

const OK = { ok: true, datos: {} };

/** Sigue, para cada jugador, el estado que reconstruiría su cliente con los mensajes recibidos. */
function seguidores(mesa: Mesa) {
  const estados = new Map<string, { estado: EstadoCliente; leidos: number }>();
  return {
    estadoDe(indice: number): EstadoCliente {
      const jugador = mesa.jugadores[indice]!;
      const seguido = estados.get(jugador.id) ?? { estado: ESTADO_CLIENTE_INICIAL, leidos: 0 };
      while (seguido.leidos < jugador.recibidos.length) {
        seguido.estado = aplicarMensaje(seguido.estado, jugador.recibidos[seguido.leidos++]!);
      }
      estados.set(jugador.id, seguido);
      return seguido.estado;
    },
  };
}

const sinHora = (vista: VistaSala | null) => (vista ? { ...vista, horaServidor: 0 } : null);

/** Compara, para cada jugador conectado, lo reconstruido con la foto del servidor. */
function verificarCoincidencia(mesa: Mesa, seguidos: ReturnType<typeof seguidores>, conectados: Set<number>): void {
  for (const indice of conectados) {
    const estado = seguidos.estadoDe(indice);
    expect(estado.desincronizado).toBe(false);
    expect(estado.seq).toBe(mesa.sala.ultimoSeq);
    expect(sinHora(estado.sala)).toEqual(sinHora(mesa.sala.vistaPara(mesa.jugadores[indice]!.id)));
  }
}

describe('foto = eventos', () => {
  for (const cantidad of [4, 5, 6, 7]) {
    it(`${cantidad} jugadores: en cada paso del juego, lo reconstruido coincide con la foto`, () => {
      const mesa = armarMesa(cantidad, { semilla: 40 + cantidad });
      const seguidos = seguidores(mesa);
      const conectados = new Set(mesa.jugadores.map((_, i) => i));
      verificarCoincidencia(mesa, seguidos, conectados);

      expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
      verificarCoincidencia(mesa, seguidos, conectados);
      let pasos = 0;
      jugarHastaElFinal(mesa, createSeededRng(cantidad), () => {
        pasos++;
        verificarCoincidencia(mesa, seguidos, conectados);
      });
      expect(pasos).toBeGreaterThan(100);
      expect(mesa.errores).toEqual([]);
    });
  }

  it('también con pausas del resumen, desconexiones, cambio de anfitrión y revancha', () => {
    const mesa = armarMesa(5, { semilla: 77, pausaBazaMs: 0 });
    const seguidos = seguidores(mesa);
    const conectados = new Set([0, 1, 2, 3, 4]);
    mesa.comando(0, { tipo: 'sala.iniciar' });
    mesa.comando(0, { tipo: 'sala.pausarResumen', datos: { pausar: true } });
    verificarCoincidencia(mesa, seguidos, conectados);

    let reanudado = false;
    let desconectado = false;
    jugarHastaElFinal(mesa, createSeededRng(3), () => {
      const juego = mesa.sala.estadoDelJuego!;
      if (juego.phase === 'ROUND_SUMMARY' && mesa.sala.resumenEnPausa) {
        // Con el resumen en pausa el reloj no tiene nada pendiente: se reanuda.
        verificarCoincidencia(mesa, seguidos, conectados);
        const anfitrion = mesa.jugadores.findIndex((j) => j.id === mesa.sala.idAnfitrion);
        expect(mesa.comando(anfitrion, { tipo: 'sala.pausarResumen', datos: { pausar: false } })).toEqual(OK);
        reanudado = true;
      }
      if (!desconectado && juego.roundNumber === 3) {
        // El anfitrión se desconecta: el rol pasa a otro. Su asiento sigue (juega la prueba por él).
        mesa.sala.desconectar(mesa.jugadores[0]!.id);
        conectados.delete(0);
        desconectado = true;
      }
      verificarCoincidencia(mesa, seguidos, conectados);
    });
    expect(reanudado && desconectado).toBe(true);
    expect(mesa.sala.idAnfitrion).toBe(mesa.jugadores[1]!.id);

    // Revancha con el resumen en pausa: el juego nuevo empieza sin pausa, y se avisa.
    expect(mesa.comando(1, { tipo: 'sala.pausarResumen', datos: { pausar: true } })).toEqual(OK);
    expect(mesa.comando(1, { tipo: 'juego.revancha' })).toEqual(OK);
    expect(mesa.sala.resumenEnPausa).toBe(false);
    verificarCoincidencia(mesa, seguidos, conectados);
    jugarHastaElFinal(mesa, createSeededRng(4), () => verificarCoincidencia(mesa, seguidos, conectados));
    expect(mesa.errores).toEqual([]);
  });

  it('también con ausencias: desconexiones, reconexiones, vencimientos, piloto y abandono', () => {
    const mesa = armarMesa(5, { semilla: 91, pausaBazaMs: 100, pausaResumenMs: 100, pausaPilotoMs: 50 });
    const seguidos = seguidores(mesa);
    const conectados = new Set([0, 1, 2, 3, 4]);
    const azar = createSeededRng(17);
    mesa.comando(0, { tipo: 'sala.iniciar' });
    let reconexiones = 0;
    let vencidos = 0;
    let abandono = false;

    for (let pasos = 0; pasos < 4000 && mesa.sala.estado === 'JUGANDO'; pasos++) {
      const juego = mesa.sala.estadoDelJuego!;
      const dado = azar.nextInt(100);
      const indice = azar.nextInt(5);
      if (dado < 4 && conectados.has(indice) && conectados.size > 1) {
        mesa.sala.desconectar(mesa.jugadores[indice]!.id);
        conectados.delete(indice);
      } else if (dado < 10 && !conectados.has(indice) && !(abandono && indice === 4)) {
        expect(mesa.reconectar(indice)).toMatchObject({ ok: true });
        conectados.add(indice);
        reconexiones++;
      } else if (dado < 12 && !abandono && conectados.has(4) && conectados.size > 1) {
        expect(mesa.comando(4, { tipo: 'sala.salir' })).toEqual(OK);
        conectados.delete(4);
        abandono = true;
      } else if (dado < 20) {
        // Nadie juega: vence el plazo o actúa el piloto.
        mesa.reloj.avanzarAlProximo();
        vencidos++;
      } else if (dado < 22 && conectados.has(indice)) {
        mesa.comando(indice, { tipo: 'juego.retomarControl' });
      } else {
        const turno = currentTurn(juego);
        const quien = turno ? mesa.jugadores.findIndex((j) => j.id === juego.players[turno.seat]!.id) : -1;
        if (!turno || !conectados.has(quien)) {
          mesa.reloj.avanzarAlProximo();
        } else if (turno.kind === 'bet') {
          mesa.comando(quien, { tipo: 'juego.apostar', datos: { valor: validBetsFor(juego, turno.seat)[0]! } });
        } else {
          mesa.comando(quien, { tipo: 'juego.jugarCarta', datos: { idCarta: playableCards(juego, turno.seat)[0]!.id } });
        }
      }
      verificarCoincidencia(mesa, seguidos, conectados);
    }
    expect(mesa.sala.estadoDelJuego!.phase).toBe('FINISHED');
    expect(reconexiones).toBeGreaterThan(5);
    expect(vencidos).toBeGreaterThan(20);
    expect(abandono).toBe(true);
    expect(mesa.errores).toEqual([]);
  });

  it('en el lobby: entradas, salidas y cambio de anfitrión', () => {
    const mesa = armarMesa(3);
    const seguidos = seguidores(mesa);
    mesa.sumar('Cuarta');
    mesa.comando(0, { tipo: 'sala.salir' });
    mesa.sumar('Quinto');
    verificarCoincidencia(mesa, seguidos, new Set([1, 2, 3, 4]));
  });
});

describe('sync.pedir', () => {
  it('responde ok y enseguida manda la foto completa, con el seq actual', () => {
    const mesa = armarMesa(4, { semilla: 8 });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    jugarHasta(mesa, () => mesa.sala.estadoDelJuego!.roundNumber === 5 && mesa.sala.estadoDelJuego!.phase === 'PLAYING');
    const jugador = mesa.jugadores[2]!;
    const antes = jugador.recibidos.length;
    expect(mesa.comando(2, { tipo: 'sync.pedir', datos: { ultimoSeq: 3 } }, 'sync-1')).toEqual(OK);
    const nuevos = jugador.recibidos.slice(antes);
    expect(nuevos.map((m) => m.tipo)).toEqual(['ok', 'estado.foto']);
    const foto = nuevos[1] as MensajeFoto;
    expect(foto.seq).toBe(mesa.sala.ultimoSeq);
    expect(foto.datos).toEqual(mesa.sala.vistaPara(jugador.id));
    expect(foto.datos.juego?.partida).toBe(5);
    // Los demás no reciben nada.
    expect(mesa.jugadores[1]!.recibidos.at(-1)?.tipo).not.toBe('estado.foto');
  });

  it('en el lobby la foto no tiene juego', () => {
    const mesa = armarMesa(2);
    mesa.comando(1, { tipo: 'sync.pedir' });
    const foto = mesa.jugadores[1]!.recibidos.at(-1) as MensajeFoto;
    expect(foto.tipo).toBe('estado.foto');
    expect(foto.datos.juego).toBeNull();
    expect(foto.datos.estado).toBe('ESPERANDO');
  });

  it('la foto de mitad de juego no contiene cartas ajenas', () => {
    const mesa = armarMesa(7, { semilla: 12 });
    mesa.comando(0, { tipo: 'sala.iniciar' });
    jugarHasta(mesa, () => mesa.sala.estadoDelJuego!.roundNumber === 7 && mesa.sala.estadoDelJuego!.phase === 'PLAYING');
    const juego = mesa.sala.estadoDelJuego!;
    mesa.jugadores.forEach((jugador, indice) => {
      mesa.comando(indice, { tipo: 'sync.pedir' });
      const foto = jugador.recibidos.at(-1) as MensajeFoto;
      const { sorteo: _sorteo, ...resto } = foto.datos.juego!;
      const vistas = new Set(cartasEn(resto));
      juego.hands.forEach((mano, asiento) => {
        if (juego.players[asiento]!.id === jugador.id) return;
        for (const carta of mano) expect(vistas.has(carta.id), `${jugador.nombre} ve ${carta.id}`).toBe(false);
      });
      // El token de nadie aparece en la foto.
      for (const otro of mesa.jugadores) expect(JSON.stringify(foto)).not.toContain(otro.token);
    });
  });
});
