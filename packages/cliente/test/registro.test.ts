// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describirEvento } from '../src/estado/registro';
import type { MensajeEvento, VistaSala } from '@tokinoto/protocolo';

const evento = (tipo: string, datos: unknown): MensajeEvento =>
  ({ v: 1, tipo, seq: 1, datos }) as unknown as MensajeEvento;

const sala = {
  yo: 'a',
  anfitrion: 'a',
  jugadores: [
    { idJugador: 'a', nombre: 'Ana', conectado: true },
    { idJugador: 'b', nombre: 'Beto', conectado: true },
  ],
  juego: null,
} as unknown as VistaSala;

describe('describirEvento', () => {
  it('entradas y salidas', () => {
    expect(describirEvento(evento('sala.jugadorEntro', { nombre: 'Beto' }), sala, sala)).toBe('Beto entró a la sala');
    expect(describirEvento(evento('sala.jugadorSalio', { idJugador: 'b' }), sala, sala)).toBe('Beto salió de la sala');
  });

  it('conexión', () => {
    expect(describirEvento(evento('jugador.conexion', { idJugador: 'b', conectado: false }), sala, sala)).toBe('Beto se desconectó');
    expect(describirEvento(evento('jugador.conexion', { idJugador: 'b', conectado: true }), sala, sala)).toBe('Beto volvió');
  });

  it('partidas con cartas en singular y plural', () => {
    expect(describirEvento(evento('partida.iniciada', { partida: 1, cartasPorJugador: 1 }), sala, sala)).toBe('Partida 1: 1 carta por jugador');
    expect(describirEvento(evento('partida.iniciada', { partida: 4, cartasPorJugador: 4 }), sala, sala)).toBe('Partida 4: 4 cartas por jugador');
  });

  it('devuelve null para eventos que no se muestran', () => {
    expect(describirEvento(evento('algo.desconocido', {}), sala, sala)).toBeNull();
  });
});
