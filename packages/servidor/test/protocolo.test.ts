import { describe, expect, it } from 'vitest';
import { generarCodigoSala } from '../src/gestor';
import { Limitador } from '../src/limitador';
import { ALFABETO_CODIGO, VERSION_PROTOCOLO, leerPedido } from '../src/protocolo';
import { origenPermitido } from '../src/servidor';

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
      sobre('sala.crear', { nombre: 'Ana' }),
      sobre('sala.crear', { nombre: 'Ana', maxJugadores: 5 }),
      sobre('sala.unirse', { codigo: 'ABCD2345', nombre: 'Beto' }),
      sobre('sala.salir'),
      sobre('sala.salir', {}),
      sobre('sala.iniciar'),
      sobre('sala.pausarResumen', { pausar: true }),
      sobre('juego.apostar', { valor: 2 }),
      sobre('juego.jugarCarta', { idCarta: 'K-picas' }),
      sobre('juego.revancha'),
      sobre('ping'),
    ];
    for (const crudo of validos) expect(leerPedido(crudo).ok, JSON.stringify(crudo)).toBe(true);
  });

  it('limpia el nombre y normaliza el código de sala', () => {
    const lectura = leerPedido(sobre('sala.unirse', { codigo: ' abcd2345 ', nombre: '  Caro  ' }));
    expect(lectura).toEqual({
      ok: true,
      pedido: { idPedido: 'abc', comando: { tipo: 'sala.unirse', datos: { codigo: 'ABCD2345', nombre: 'Caro' } } },
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
    const lectura = leerPedido({ ...sobre('ping'), v: 2 });
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
      sobre('sala.crear', {}),
      sobre('sala.crear', { nombre: 'Ana', maxJugadores: 3 }),
      sobre('sala.crear', { nombre: 'Ana', maxJugadores: 8 }),
      sobre('sala.crear', { nombre: 'Ana', maxJugadores: 5.5 }),
      sobre('sala.crear', { nombre: 'Ana', asiento: 0 }),
      sobre('sala.unirse', { codigo: 'ABC', nombre: 'Ana' }),
      sobre('sala.unirse', { codigo: 'ABCD234O', nombre: 'Ana' }), // la O no está en el alfabeto
      sobre('sala.iniciar', { forzar: true }),
      sobre('sala.pausarResumen', { pausar: 'si' }),
      sobre('juego.apostar', {}),
      sobre('juego.apostar', { valor: 1, jugador: 'otro' }),
      sobre('juego.jugarCarta', { idCarta: '' }),
      sobre('juego.jugarCarta', { idCarta: 'x'.repeat(21) }),
    ];
    for (const crudo of invalidos) expect(codigoDeError(crudo), JSON.stringify(crudo)).toBe('MENSAJE_INVALIDO');
  });

  it('valida los nombres', () => {
    for (const nombre of ['', '   ', 'x'.repeat(21), 'Ana\u0000', 'Ana\nBeto', 'Ana​']) {
      expect(codigoDeError(sobre('sala.crear', { nombre })), JSON.stringify(nombre)).toBe('MENSAJE_INVALIDO');
    }
    for (const nombre of ['Ana', 'José María', 'Ñoño 7', 'x'.repeat(20), '🙂 Lu']) {
      expect(codigoDeError(sobre('sala.crear', { nombre })), nombre).toBeNull();
    }
  });

  it('deja que el motor valide el rango de la apuesta (incluido que sea entera)', () => {
    expect(codigoDeError(sobre('juego.apostar', { valor: 1.5 }))).toBeNull();
    expect(codigoDeError(sobre('juego.apostar', { valor: -1 }))).toBeNull();
  });
});

describe('códigos de sala', () => {
  it('tienen 8 caracteres del alfabeto sin confusiones y no se repiten', () => {
    const codigos = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const codigo = generarCodigoSala();
      expect(codigo).toMatch(new RegExp(`^[${ALFABETO_CODIGO}]{8}$`));
      codigos.add(codigo);
    }
    expect(codigos.size).toBe(2000);
    expect(ALFABETO_CODIGO).not.toMatch(/[01ILO]/);
  });
});

describe('límite de frecuencia', () => {
  it('permite una ráfaga y después repone a ritmo constante', () => {
    let ahora = 0;
    const limitador = new Limitador({ capacidad: 3, porSegundo: 2 }, () => ahora);
    expect([limitador.tomar(), limitador.tomar(), limitador.tomar(), limitador.tomar()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    ahora = 400; // 0,8 fichas
    expect(limitador.tomar()).toBe(false);
    ahora = 500; // se completa una ficha
    expect(limitador.tomar()).toBe(true);
    ahora = 100_000; // nunca más que la capacidad
    expect([limitador.tomar(), limitador.tomar(), limitador.tomar(), limitador.tomar()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('origen de las conexiones', () => {
  it('acepta solo los sitios permitidos (y clientes sin cabecera Origin)', () => {
    expect(origenPermitido('*', 'https://cualquiera.com')).toBe(true);
    expect(origenPermitido(['https://tokinoto.com'], 'https://tokinoto.com')).toBe(true);
    expect(origenPermitido(['https://tokinoto.com'], 'https://malo.com')).toBe(false);
    expect(origenPermitido(['https://tokinoto.com'], undefined)).toBe(true);
  });
});
