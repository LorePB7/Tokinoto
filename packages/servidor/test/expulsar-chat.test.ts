/**
 * Fase 7: expulsar jugadores de la sala de espera y chat de sala.
 *
 * - Expulsar (DP-15): solo el anfitrión, solo antes de empezar y nunca a sí
 *   mismo. La persona queda bloqueada en esa sala.
 * - Chat (DP-22): mensajes fuera de la secuencia de eventos, sin guardarse
 *   en la base; la sala recuerda los últimos 50 mientras exista.
 */
import {
  ESTADO_CLIENTE_INICIAL,
  LARGO_MAXIMO_CHAT,
  MENSAJES_DE_CHAT_GUARDADOS,
  VERSION_PROTOCOLO,
  aplicarMensaje,
  leerPedido,
  type EstadoCliente,
  type MensajeServidor,
  type Respuesta,
  type VistaSala,
} from '@tokinoto/protocolo';
import { describe, expect, it } from 'vitest';
import type { Destino, PerfilJugador } from '../src/sala';
import { armarMesa, jugarHastaElFinal, type Mesa } from './ayudas';

const OK = { ok: true, datos: {} };

const chat = (texto: string) => ({ tipo: 'chat.enviar' as const, datos: { texto } });
const expulsar = (idJugador: string) => ({ tipo: 'sala.expulsar' as const, datos: { idJugador } });

/** Suma a alguien con su clave de persona (como lo hace el gestor). */
function sumarCon(mesa: Mesa, nombre: string, clave: string) {
  const recibidos: MensajeServidor[] = [];
  let expulsiones = 0;
  const destino: Destino = { enviar: (m) => recibidos.push(m), alExpulsar: () => expulsiones++ };
  let respuesta: Respuesta | null = null;
  const perfil: PerfilJugador = { cuentaId: null, invitado: true, clave };
  mesa.sala.unirse(nombre, destino, (r) => (respuesta = r), perfil);
  const final = respuesta as Respuesta | null;
  if (!final) throw new Error('La sala no respondió');
  if (final.ok) {
    mesa.jugadores.push({
      id: final.datos['idJugador'] as string,
      token: final.datos['token'] as string,
      nombre,
      recibidos,
      destino,
    });
  }
  return { respuesta: final, recibidos, expulsiones: () => expulsiones };
}

/** Lo que reconstruye un cliente con todo lo que recibió. */
function reconstruido(recibidos: MensajeServidor[]): EstadoCliente {
  return recibidos.reduce(aplicarMensaje, ESTADO_CLIENTE_INICIAL);
}

const sinHora = (vista: VistaSala | null) => (vista ? { ...vista, horaServidor: 0 } : null);

function coincide(mesa: Mesa, indice: number): void {
  const jugador = mesa.jugadores[indice]!;
  const estado = reconstruido(jugador.recibidos);
  expect(estado.desincronizado).toBe(false);
  expect(estado.seq).toBe(mesa.sala.ultimoSeq);
  expect(sinHora(estado.sala)).toEqual(sinHora(mesa.sala.vistaPara(jugador.id)));
}

describe('expulsar (fase 7, DP-15)', () => {
  it('solo el anfitrión, solo en la sala de espera, nunca a sí mismo ni a alguien que no está', () => {
    const mesa = armarMesa(4);
    const [anfitrion, , tercero] = mesa.jugadores;
    expect(mesa.comando(1, expulsar(tercero!.id))).toMatchObject({ ok: false, error: { codigo: 'NO_ES_ANFITRION' } });
    expect(mesa.comando(0, expulsar(anfitrion!.id))).toMatchObject({ ok: false, error: { codigo: 'ESTADO_INVALIDO' } });
    expect(mesa.comando(0, expulsar('nadie'))).toMatchObject({ ok: false, error: { codigo: 'NO_PERTENECE_A_SALA' } });
    expect(mesa.sala.cantidadJugadores).toBe(4);

    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    expect(mesa.comando(0, expulsar(tercero!.id))).toMatchObject({ ok: false, error: { codigo: 'JUEGO_YA_INICIADO' } });
    expect(mesa.sala.cantidadJugadores).toBe(4);
  });

  it('el expulsado recibe su aviso privado y los demás, que salió por expulsión', () => {
    const mesa = armarMesa(2);
    const pepe = sumarCon(mesa, 'Pepe', 'i:pepe');
    const idPepe = mesa.jugadores[2]!.id;
    const seqAntes = mesa.sala.ultimoSeq;

    expect(mesa.comando(0, expulsar(idPepe))).toEqual(OK);
    expect(mesa.sala.cantidadJugadores).toBe(2);
    expect(pepe.expulsiones()).toBe(1);
    expect(pepe.recibidos.at(-1)).toEqual({ v: VERSION_PROTOCOLO, tipo: 'sala.expulsado', datos: { codigo: 'PRUEBA23' } });
    // El expulsado no recibe el evento de su propia salida.
    expect(pepe.recibidos.filter((m) => m.tipo === 'sala.jugadorSalio')).toHaveLength(0);

    for (const indice of [0, 1]) {
      const salio = mesa.eventos(indice, 'sala.jugadorSalio');
      expect(salio).toHaveLength(1);
      expect(salio[0]).toMatchObject({ seq: seqAntes + 1, datos: { idJugador: idPepe, expulsado: true } });
      coincide(mesa, indice);
    }
    // Ya fuera, sus comandos no llegan a la sala.
    expect(mesa.comando(2, chat('hola'))).toMatchObject({ ok: false, error: { codigo: 'NO_PERTENECE_A_SALA' } });
  });

  it('la persona expulsada no puede volver a esa sala: ni con la misma clave ni con su token', () => {
    const mesa = armarMesa(1);
    sumarCon(mesa, 'Pepe', 'i:pepe');
    const { id, token } = mesa.jugadores[1]!;
    expect(mesa.comando(0, expulsar(id))).toEqual(OK);

    expect(sumarCon(mesa, 'Pepe', 'i:pepe').respuesta).toMatchObject({ ok: false, error: { codigo: 'EXPULSADO' } });
    expect(sumarCon(mesa, 'Otro nombre', 'i:pepe').respuesta).toMatchObject({ ok: false, error: { codigo: 'EXPULSADO' } });
    expect(mesa.reconectar(0, token)).toMatchObject({ ok: false, error: { codigo: 'EXPULSADO' } });
    // Otra persona (otra clave) entra sin problema, aunque use el mismo nombre.
    expect(sumarCon(mesa, 'Pepe', 'i:otra').respuesta.ok).toBe(true);
  });

  it('se puede expulsar a alguien desconectado que tenía el lugar guardado', () => {
    const mesa = armarMesa(1, { graciaLobbyMs: 15000 });
    sumarCon(mesa, 'Pepe', 'g:cuenta-pepe');
    const pepe = mesa.jugadores[1]!;
    mesa.sala.desconectar(pepe.id);
    expect(mesa.comando(0, expulsar(pepe.id))).toEqual(OK);
    expect(mesa.sala.cantidadJugadores).toBe(1);
    // El lugar guardado ya no existe: el plazo de gracia no lo vuelve a quitar ni rompe nada.
    mesa.reloj.avanzar(20000);
    expect(mesa.errores).toEqual([]);
    expect(mesa.eventos(0, 'sala.jugadorSalio')).toHaveLength(1);
    expect(mesa.reconectar(1)).toMatchObject({ ok: false, error: { codigo: 'EXPULSADO' } });
  });

  it('un reintento del mismo pedido no expulsa dos veces', () => {
    const mesa = armarMesa(3);
    const id = mesa.jugadores[2]!.id;
    expect(mesa.comando(0, expulsar(id), 'exp-1')).toEqual(OK);
    expect(mesa.comando(0, expulsar(id), 'exp-1')).toEqual(OK);
    expect(mesa.eventos(1, 'sala.jugadorSalio')).toHaveLength(1);
  });
});

describe('validación del chat (DP-22)', () => {
  const leer = (texto: unknown) =>
    leerPedido({ v: VERSION_PROTOCOLO, tipo: 'chat.enviar', idPedido: 'x', datos: { texto } });

  it('acepta de 1 a 200 caracteres, recortando espacios, y emojis compuestos', () => {
    expect(leer('  hola  ')).toMatchObject({ ok: true, pedido: { comando: { datos: { texto: 'hola' } } } });
    expect(leer('a'.repeat(LARGO_MAXIMO_CHAT)).ok).toBe(true);
    expect(leer('¡Bien ahí! 👨‍👩‍👧 🇦🇷').ok).toBe(true);
  });

  it('rechaza vacíos, largos, saltos de línea, caracteres de control y de dirección', () => {
    for (const malo of ['', '   ', 'a'.repeat(LARGO_MAXIMO_CHAT + 1), 'hola\nchau', 'a\u0000b', 'mirá ‮odaterces', 42]) {
      expect(leer(malo)).toMatchObject({ ok: false, error: { codigo: 'MENSAJE_INVALIDO' } });
    }
  });
});

describe('chat de sala (DP-22)', () => {
  it('llega a todos (también a quien lo manda), fuera de la secuencia de eventos', () => {
    const mesa = armarMesa(4);
    const seq = mesa.sala.ultimoSeq;
    const registro = mesa.sala.eventos.length;
    mesa.reloj.avanzar(1234);
    expect(mesa.comando(1, chat('¿Arrancamos?'))).toEqual({ ok: true, datos: { id: 1 } });

    for (const jugador of mesa.jugadores) {
      const mensaje = jugador.recibidos.at(-1)!;
      expect(mensaje).toEqual({
        v: VERSION_PROTOCOLO,
        tipo: 'chat.mensaje',
        datos: { id: 1, idJugador: mesa.jugadores[1]!.id, nombre: 'Jugador 2', texto: '¿Arrancamos?', hora: 1234 },
      });
      expect(mensaje).not.toHaveProperty('seq');
    }
    expect(mesa.sala.ultimoSeq).toBe(seq);
    expect(mesa.sala.eventos).toHaveLength(registro);
  });

  it('la foto trae el chat y coincide con lo que arma cada cliente, también al reconectar', () => {
    const mesa = armarMesa(4, { graciaLobbyMs: 15000 });
    expect(mesa.comando(0, chat('Hola'))).toMatchObject({ ok: true });
    expect(mesa.comando(2, chat('Buenas'))).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) coincide(mesa, i);

    mesa.sala.desconectar(mesa.jugadores[3]!.id);
    expect(mesa.comando(1, chat('¿Y el cuarto?'))).toMatchObject({ ok: true });
    expect(mesa.reconectar(3)).toMatchObject({ ok: true });
    const foto = mesa.jugadores[3]!.recibidos.filter((m) => m.tipo === 'estado.foto').at(-1)!;
    expect((foto.datos as VistaSala).chat.map((m) => m.texto)).toEqual(['Hola', 'Buenas', '¿Y el cuarto?']);
    for (let i = 0; i < 4; i++) coincide(mesa, i);
  });

  it('limita el ritmo por jugador: una ráfaga corta y después uno por segundo', () => {
    const mesa = armarMesa(4);
    for (let i = 0; i < 3; i++) expect(mesa.comando(0, chat(`m${i}`)).ok).toBe(true);
    expect(mesa.comando(0, chat('de más'))).toMatchObject({ ok: false, error: { codigo: 'DEMASIADOS_MENSAJES' } });
    // El límite es de cada uno: los demás siguen hablando.
    expect(mesa.comando(1, chat('yo sí')).ok).toBe(true);
    mesa.reloj.avanzar(1000);
    expect(mesa.comando(0, chat('ahora sí')).ok).toBe(true);
    expect(mesa.comando(0, chat('otra vez no'))).toMatchObject({ ok: false, error: { codigo: 'DEMASIADOS_MENSAJES' } });
  });

  it(`guarda solo los últimos ${MENSAJES_DE_CHAT_GUARDADOS} mensajes`, () => {
    const mesa = armarMesa(4);
    for (let i = 1; i <= MENSAJES_DE_CHAT_GUARDADOS + 5; i++) {
      expect(mesa.comando(i % 4, chat(`n${i}`)).ok).toBe(true);
      mesa.reloj.avanzar(1000);
    }
    const guardados = mesa.sala.mensajesDeChat;
    expect(guardados).toHaveLength(MENSAJES_DE_CHAT_GUARDADOS);
    expect(guardados[0]!.texto).toBe('n6');
    expect(guardados.at(-1)!.id).toBe(MENSAJES_DE_CHAT_GUARDADOS + 5);
    for (let i = 0; i < 4; i++) coincide(mesa, i);
  });

  it('un reintento del mismo pedido no repite el mensaje', () => {
    const mesa = armarMesa(4);
    expect(mesa.comando(0, chat('una vez'), 'chat-1')).toEqual({ ok: true, datos: { id: 1 } });
    expect(mesa.comando(0, chat('una vez'), 'chat-1')).toEqual({ ok: true, datos: { id: 1 } });
    expect(mesa.sala.mensajesDeChat).toHaveLength(1);
    expect(mesa.jugadores[1]!.recibidos.filter((m) => m.tipo === 'chat.mensaje')).toHaveLength(1);
  });

  it('funciona durante y después del juego, y nunca llega al historial', () => {
    const llamadas: unknown[] = [];
    const historial = {
      juegoNuevo: (datos: unknown) => llamadas.push(datos),
      evento: (...datos: unknown[]) => llamadas.push(datos),
    };
    const mesa = armarMesa(4, { historial, semilla: 3 });
    expect(mesa.comando(0, { tipo: 'sala.iniciar' })).toEqual(OK);
    expect(mesa.comando(2, chat('suerte a todos'))).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) coincide(mesa, i);
    jugarHastaElFinal(mesa);
    expect(mesa.sala.estado).toBe('TERMINADO');
    expect(mesa.comando(1, chat('buen juego'))).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) coincide(mesa, i);
    expect(JSON.stringify(llamadas)).not.toContain('suerte a todos');
    expect(JSON.stringify(llamadas)).not.toContain('chat');
    expect(mesa.errores).toEqual([]);
  });

  it('al cerrarse la sala, el chat se borra', () => {
    const mesa = armarMesa(4);
    expect(mesa.comando(0, chat('hola')).ok).toBe(true);
    mesa.sala.cerrar();
    expect(mesa.sala.mensajesDeChat).toHaveLength(0);
  });

  it('el seguimiento del cliente ignora mensajes repetidos o viejos', () => {
    const mesa = armarMesa(4);
    expect(mesa.comando(0, chat('hola')).ok).toBe(true);
    const recibidos = mesa.jugadores[1]!.recibidos;
    const repetido = recibidos.find((m) => m.tipo === 'chat.mensaje')!;
    const estado = reconstruido([...recibidos, repetido]);
    expect(estado.sala?.chat).toHaveLength(1);
  });
});
