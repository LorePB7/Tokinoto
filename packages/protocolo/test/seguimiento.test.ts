import { describe, expect, it } from 'vitest';
import { VERSION_PROTOCOLO, type MensajeServidor } from '../src/protocolo';
import { ESTADO_CLIENTE_INICIAL, aplicarMensaje, juegoNuevo, type EstadoCliente } from '../src/seguimiento';
import type { VistaSala } from '../src/vista';

const v = VERSION_PROTOCOLO;

function foto(seq: number, cambios: Partial<VistaSala> = {}): MensajeServidor {
  return {
    v,
    tipo: 'estado.foto',
    seq,
    datos: {
      codigo: 'ABCDEFGH',
      estado: 'ESPERANDO',
      yo: 'ana',
      anfitrion: 'ana',
      maxJugadores: 7,
      resumenPausado: false,
      jugadores: [{ idJugador: 'ana', nombre: 'Ana', conectado: true }],
      horaServidor: 1000,
      juego: null,
      ...cambios,
    },
  };
}

const entro = (seq: number, id: string): MensajeServidor => ({
  v,
  tipo: 'sala.jugadorEntro',
  seq,
  datos: { idJugador: id, nombre: id.toUpperCase() },
});

function aplicarTodos(mensajes: MensajeServidor[], estado: EstadoCliente = ESTADO_CLIENTE_INICIAL): EstadoCliente {
  return mensajes.reduce(aplicarMensaje, estado);
}

describe('seguimiento del estado en el cliente', () => {
  it('ignora eventos hasta recibir la primera foto', () => {
    expect(aplicarMensaje(ESTADO_CLIENTE_INICIAL, entro(1, 'beto'))).toBe(ESTADO_CLIENTE_INICIAL);
  });

  it('la foto reemplaza todo y los eventos siguientes se aplican en orden', () => {
    const estado = aplicarTodos([foto(5), entro(6, 'beto'), entro(7, 'caro')]);
    expect(estado.seq).toBe(7);
    expect(estado.desincronizado).toBe(false);
    expect(estado.sala?.jugadores.map((j) => j.idJugador)).toEqual(['ana', 'beto', 'caro']);
  });

  it('un evento repetido o viejo no cambia nada', () => {
    const estado = aplicarTodos([foto(5), entro(6, 'beto')]);
    expect(aplicarMensaje(estado, entro(6, 'beto'))).toBe(estado);
    expect(aplicarMensaje(estado, entro(3, 'otro'))).toBe(estado);
  });

  it('un salto en seq marca desincronizado hasta la próxima foto', () => {
    let estado = aplicarTodos([foto(5), entro(7, 'caro')]);
    expect(estado).toMatchObject({ seq: 5, desincronizado: true });
    expect(estado.sala?.jugadores).toHaveLength(1);
    // Mientras tanto, los eventos se ignoran.
    estado = aplicarMensaje(estado, entro(8, 'dani'));
    expect(estado.sala?.jugadores).toHaveLength(1);
    estado = aplicarMensaje(estado, foto(8));
    expect(estado).toMatchObject({ seq: 8, desincronizado: false });
  });

  it('un evento de juego sin juego pide resincronizar', () => {
    const estado = aplicarTodos([
      foto(1),
      { v, tipo: 'apuesta.realizada', seq: 2, datos: { asiento: 0, valor: 1, porPiloto: false } },
    ]);
    expect(estado.desincronizado).toBe(true);
  });

  it('las respuestas no cambian el estado', () => {
    const estado = aplicarTodos([foto(1)]);
    expect(aplicarMensaje(estado, { v, tipo: 'ok', idPedido: 'x', datos: {} })).toBe(estado);
    expect(
      aplicarMensaje(estado, { v, tipo: 'error', idPedido: 'x', datos: { codigo: 'NO_ES_TU_TURNO', mensaje: '' } }),
    ).toBe(estado);
  });

  it('no modifica el estado anterior ni el mensaje', () => {
    const mensajeFoto = foto(1);
    const copiaFoto = structuredClone(mensajeFoto);
    const antes = aplicarTodos([mensajeFoto]);
    const copiaAntes = structuredClone(antes);
    const despues = aplicarMensaje(antes, entro(2, 'beto'));
    expect(antes).toEqual(copiaAntes);
    expect(mensajeFoto).toEqual(copiaFoto);
    expect(despues.sala?.jugadores).toHaveLength(2);
  });

  it('juego.iniciado arma un juego vacío con mi asiento', () => {
    const asientos = [
      { asiento: 0, idJugador: 'beto', nombre: 'Beto' },
      { asiento: 1, idJugador: 'ana', nombre: 'Ana' },
    ];
    const estado = aplicarTodos([foto(1), { v, tipo: 'juego.iniciado', seq: 2, datos: { asientos } }]);
    expect(estado.sala?.estado).toBe('JUGANDO');
    expect(estado.sala?.juego).toEqual(juegoNuevo(asientos, 'ana'));
    expect(estado.sala?.juego?.miAsiento).toBe(1);
  });
});
