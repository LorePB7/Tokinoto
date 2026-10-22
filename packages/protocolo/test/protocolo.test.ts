import { describe, expect, it } from 'vitest';
import { VERSION_PROTOCOLO, armarComando, idPedidoDe, leerPedido } from '../src/protocolo';

const sobre = (tipo: string, datos?: unknown, extra: Record<string, unknown> = {}) => ({
  v: VERSION_PROTOCOLO,
  tipo,
  idPedido: 'abc',
  ...(datos === undefined ? {} : { datos }),
  ...extra,
});

function codigoDeError(crudo: unknown): string | null {
  const lectura = leerPedido(crudo);
  return lectura.ok ? null : lectura.error.codigo;
}

describe('lectura de comandos', () => {
  it('acepta cada comando válido', () => {
    const validos = [
      sobre('cuenta.entrar', { credencial: 'eyJhbGciOiJSUzI1NiJ9.x.y' }),
      sobre('cuenta.entrarInvitado', { nombre: 'Ana' }),
      sobre('cuenta.reanudar', { sesion: 'abcdefghij.klmnop' }),
      sobre('cuenta.cambiarNombre', { nombre: 'Anita' }),
      sobre('sala.crear', {}),
      sobre('sala.crear', { maxJugadores: 5 }),
      sobre('sala.crear', { tiempoTurno: 45 }),
      sobre('sala.crear', { tiempoTurno: null }),
      sobre('sala.reconectar'),
      sobre('sala.reconectar', {}),
      sobre('juego.retomarControl'),
      sobre('sala.unirse', { codigo: 'ABCD2345' }),
      sobre('sala.salir'),
      sobre('sala.salir', {}),
      sobre('sala.iniciar'),
      sobre('sala.pausarResumen', { pausar: true }),
      sobre('sala.configurar', { tiempoTurno: 60 }),
      sobre('sala.configurar', { tiempoTurno: null }),
      sobre('sala.consultar'),
      sobre('juego.apostar', { valor: 2 }),
      sobre('juego.jugarCarta', { idCarta: 'K-picas' }),
      sobre('juego.revancha'),
      sobre('sync.pedir'),
      sobre('sync.pedir', { ultimoSeq: 17 }),
      sobre('ping'),
    ];
    for (const crudo of validos) expect(leerPedido(crudo).ok, JSON.stringify(crudo)).toBe(true);
  });

  it('limpia el nombre y normaliza el código de sala', () => {
    expect(leerPedido(sobre('sala.unirse', { codigo: ' abcd2345 ' }))).toEqual({
      ok: true,
      pedido: { idPedido: 'abc', comando: { tipo: 'sala.unirse', datos: { codigo: 'ABCD2345' } } },
    });
    expect(leerPedido(sobre('cuenta.entrarInvitado', { nombre: '  Caro  ' }))).toEqual({
      ok: true,
      pedido: { idPedido: 'abc', comando: { tipo: 'cuenta.entrarInvitado', datos: { nombre: 'Caro' } } },
    });
  });

  it('rechaza sobres mal formados', () => {
    for (const crudo of [null, 'texto', 42, [], {}, { v: 1, tipo: 'ping' }, { v: 1, tipo: 'ping', idPedido: '' }]) {
      expect(codigoDeError(crudo)).toBe('MENSAJE_INVALIDO');
    }
    expect(codigoDeError({ v: 1, tipo: 'ping', idPedido: 'x'.repeat(65) })).toBe('MENSAJE_INVALIDO');
  });

  it('devuelve el idPedido aunque el resto esté mal, si se puede leer', () => {
    expect(leerPedido({ tipo: 'ping', idPedido: 'p1' })).toMatchObject({ ok: false, idPedido: 'p1' });
    expect(leerPedido(sobre('juego.apostar', { valor: 'dos' }))).toMatchObject({ ok: false, idPedido: 'abc' });
  });

  it('rechaza otra versión del protocolo con un mensaje claro', () => {
    const lectura = leerPedido({ ...sobre('ping'), v: 1 });
    expect(lectura).toMatchObject({ ok: false, error: { codigo: 'VERSION_NO_SOPORTADA' } });
    expect(lectura.ok || lectura.error.mensaje).toMatch(/actualizá la página/);
  });

  it('rechaza tipos desconocidos, incluidos los que el cliente no puede pedir', () => {
    for (const tipo of ['juego.avanzar', 'juego.sortear', 'juego.barajar', 'baza.resolver', 'inventado']) {
      expect(codigoDeError(sobre(tipo))).toBe('MENSAJE_INVALIDO');
    }
  });

  it('rechaza datos de más, de menos o con tipos equivocados', () => {
    const invalidos = [
      sobre('sala.crear', { nombre: 'Ana' }), // el nombre sale de la cuenta
      sobre('sala.crear', { maxJugadores: 3 }),
      sobre('sala.crear', { maxJugadores: 8 }),
      sobre('sala.crear', { maxJugadores: 5.5 }),
      sobre('sala.crear', { asiento: 0 }),
      sobre('sala.crear', { tiempoTurno: 5 }),
      sobre('sala.crear', { tiempoTurno: 500 }),
      sobre('sala.crear', { tiempoTurno: 30.5 }),
      sobre('sala.reconectar', { token: 'ABCD2345.un-token-cualquiera' }),
      sobre('cuenta.entrar', {}),
      sobre('cuenta.entrar', { credencial: 'corto' }),
      sobre('cuenta.entrar', { credencial: 'x'.repeat(4097) }),
      sobre('cuenta.entrarInvitado', {}),
      sobre('cuenta.entrarInvitado', { nombre: 'Ana', cuenta: 'otra' }),
      sobre('cuenta.reanudar', { sesion: 'corto' }),
      sobre('cuenta.reanudar', { sesion: 'x'.repeat(513) }),
      sobre('cuenta.cambiarNombre', { nombre: '' }),
      sobre('juego.retomarControl', { asiento: 1 }),
      sobre('sala.unirse', { codigo: 'ABC' }),
      sobre('sala.unirse', { codigo: 'ABCD234O' }), // la O no está en el alfabeto
      sobre('sala.unirse', { codigo: 'ABCD2345', nombre: 'Ana' }),
      sobre('sala.iniciar', { forzar: true }),
      sobre('sala.pausarResumen', { pausar: 'si' }),
      sobre('sala.configurar', {}),
      sobre('sala.configurar', { tiempoTurno: 5 }),
      sobre('sala.configurar', { tiempoTurno: 60, maxJugadores: 5 }),
      sobre('sala.consultar', { token: 'ABCD2345.un-token-cualquiera' }),
      sobre('juego.apostar', {}),
      sobre('juego.apostar', { valor: 1, jugador: 'otro' }),
      sobre('juego.jugarCarta', { idCarta: '' }),
      sobre('juego.jugarCarta', { idCarta: 'x'.repeat(21) }),
      sobre('sync.pedir', { ultimoSeq: -1 }),
      sobre('sync.pedir', { ultimoSeq: 1.5 }),
    ];
    for (const crudo of invalidos) expect(codigoDeError(crudo), JSON.stringify(crudo)).toBe('MENSAJE_INVALIDO');
  });

  it('valida los nombres', () => {
    for (const nombre of ['', '   ', 'x'.repeat(21), 'Ana\u0000', 'Ana\nBeto', 'Ana​']) {
      expect(codigoDeError(sobre('cuenta.entrarInvitado', { nombre })), JSON.stringify(nombre)).toBe('MENSAJE_INVALIDO');
      expect(codigoDeError(sobre('cuenta.cambiarNombre', { nombre })), JSON.stringify(nombre)).toBe('MENSAJE_INVALIDO');
    }
    for (const nombre of ['Ana', 'José María', 'Ñoño 7', 'x'.repeat(20), '🙂 Lu']) {
      expect(codigoDeError(sobre('cuenta.entrarInvitado', { nombre })), nombre).toBeNull();
    }
  });

  it('deja que el motor valide el rango de la apuesta (incluido que sea entera)', () => {
    expect(codigoDeError(sobre('juego.apostar', { valor: 1.5 }))).toBeNull();
    expect(codigoDeError(sobre('juego.apostar', { valor: -1 }))).toBeNull();
  });
});

describe('ayudas del protocolo', () => {
  it('armarComando produce algo que leerPedido acepta', () => {
    expect(leerPedido(armarComando('juego.apostar', 'x1', { valor: 3 }))).toMatchObject({
      ok: true,
      pedido: { idPedido: 'x1', comando: { tipo: 'juego.apostar', datos: { valor: 3 } } },
    });
    expect(armarComando('sala.iniciar', 'x2')).toEqual({ v: VERSION_PROTOCOLO, tipo: 'sala.iniciar', idPedido: 'x2' });
  });

  it('idPedidoDe tolera cualquier cosa', () => {
    expect(idPedidoDe(null)).toBeNull();
    expect(idPedidoDe({ idPedido: 5 })).toBeNull();
    expect(idPedidoDe({ idPedido: '' })).toBeNull();
    expect(idPedidoDe({ idPedido: 'y'.repeat(100) })).toHaveLength(64);
  });
});
