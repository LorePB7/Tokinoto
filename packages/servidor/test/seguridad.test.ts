import { describe, expect, it } from 'vitest';
import { ALFABETO_CODIGO } from '@tokinoto/protocolo';
import { generarCodigoSala } from '../src/gestor';
import { Limitador } from '../src/limitador';
import { origenPermitido } from '../src/servidor';

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
