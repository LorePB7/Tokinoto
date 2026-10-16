import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProveedorTienda } from '../src/estado/contexto';
import { Lobby } from '../src/pantallas/Lobby';
import { enlaceDeLaSala, esDireccionLocal } from '../src/util/enlace';
import { copiarAlPortapapeles } from '../src/util/portapapeles';
import { levantarMundo, salaDe, tiendaDePrueba, type Mundo } from './ayuda';

function simularSeguro(seguro: boolean, escribir?: (t: string) => Promise<void>) {
  Object.defineProperty(window, 'isSecureContext', { value: seguro, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: escribir ? { writeText: escribir } : undefined,
    configurable: true,
  });
}

describe('enlace de la sala', () => {
  it('lleva el código en ?sala= y descarta lo que ya hubiera en la dirección', () => {
    expect(enlaceDeLaSala('ABCD2345', 'https://tokinoto.example/jugar?x=1#y')).toBe(
      'https://tokinoto.example/jugar?sala=ABCD2345',
    );
  });

  it('sin dirección base usa la de la página actual', () => {
    const url = new URL(enlaceDeLaSala('ABCD2345'));
    expect(url.origin).toBe(window.location.origin);
    expect(url.searchParams.get('sala')).toBe('ABCD2345');
  });

  it('reconoce las direcciones que solo existen en la propia computadora', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'tokinoto.localhost']) expect(esDireccionLocal(host)).toBe(true);
    for (const host of ['tokinoto.com', '192.168.0.10', 'miLocalhost.com']) expect(esDireccionLocal(host)).toBe(false);
  });
});

describe('copiar al portapapeles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    simularSeguro(true, async () => {});
  });

  it('usa la API moderna en páginas seguras', async () => {
    const escribir = vi.fn(async () => {});
    simularSeguro(true, escribir);
    expect(await copiarAlPortapapeles('hola')).toBe(true);
    expect(escribir).toHaveBeenCalledWith('hola');
  });

  it('si la página no es segura, usa el método clásico y deja la página como estaba', async () => {
    const escribir = vi.fn(async () => {});
    simularSeguro(false, escribir);
    let copiado = '';
    document.execCommand = vi.fn(() => {
      copiado = document.querySelector('textarea')!.value;
      return true;
    });
    const boton = document.createElement('button');
    document.body.appendChild(boton);
    boton.focus();
    expect(await copiarAlPortapapeles('texto clásico')).toBe(true);
    expect(escribir).not.toHaveBeenCalled();
    expect(copiado).toBe('texto clásico');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(boton);
    boton.remove();
  });

  it('si la API moderna falla, prueba el método clásico', async () => {
    simularSeguro(true, async () => {
      throw new Error('denegado');
    });
    document.execCommand = vi.fn(() => true);
    expect(await copiarAlPortapapeles('x')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('si nada funciona, devuelve false', async () => {
    simularSeguro(false);
    document.execCommand = vi.fn(() => false);
    expect(await copiarAlPortapapeles('x')).toBe(false);
  });
});

describe('sala de espera: copiar código y enlace', () => {
  let mundo: Mundo;
  beforeEach(async () => {
    mundo = await levantarMundo();
  });
  afterEach(async () => {
    await mundo.cerrar();
    simularSeguro(true, async () => {});
  });

  async function entrarALaSala() {
    const ana = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana', 4);
    render(
      <ProveedorTienda tienda={ana}>
        <Lobby />
      </ProveedorTienda>,
    );
    return salaDe(ana)!.codigo;
  }

  it('copia exactamente el código y el enlace con el código', async () => {
    const escritos: string[] = [];
    simularSeguro(true, async (t) => void escritos.push(t));
    const codigo = await entrarALaSala();
    await userEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    expect(await screen.findByRole('button', { name: 'Código copiado' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(await screen.findByRole('button', { name: 'Enlace copiado' })).toBeInTheDocument();
    expect(escritos[0]).toBe(codigo);
    expect(new URL(escritos[1]!).searchParams.get('sala')).toBe(codigo);
    expect(screen.queryByLabelText(/no se pudo copiar/i)).toBeNull();
  });

  it('si no se puede copiar, muestra el texto para copiarlo a mano', async () => {
    simularSeguro(false);
    document.execCommand = vi.fn(() => false);
    const codigo = await entrarALaSala();
    await userEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    const campo = await screen.findByLabelText(/no se pudo copiar/i);
    expect(campo).toHaveValue(codigo);
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeInTheDocument();
  });

  it('avisa que el enlace solo sirve en esta computadora cuando se juega en localhost', async () => {
    await entrarALaSala();
    expect(screen.getByText(/solo abre en ella/i)).toBeInTheDocument();
  });
});
