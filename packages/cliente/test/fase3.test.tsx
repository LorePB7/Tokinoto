import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VistaJuego } from '@tokinoto/protocolo';
import { Carga } from '../src/componentes/Carga';
import { Menu } from '../src/componentes/Menu';
import { TablaPuntos } from '../src/componentes/TablaPuntos';

function juegoConPuntos(puntajes: number[][]): VistaJuego {
  return {
    miAsiento: 1,
    totalPartidas: 14,
    partida: 2,
    asientos: puntajes.map((_, asiento) => ({ asiento, nombre: `J${asiento + 1}`, idJugador: `j${asiento}` })),
    puntajes,
  } as unknown as VistaJuego;
}

describe('Tabla de puntos', () => {
  it('va de mayor a menor total, con lugares compartidos y "–" en las partidas que faltan', () => {
    render(<TablaPuntos juego={juegoConPuntos([[0, 3], [10, 0], [10, 0], [4, 4]])} />);
    const filas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const textos = filas.map((f) => f.textContent ?? '');
    expect(textos[0]).toMatch(/^1J210/);
    expect(textos[1]).toMatch(/^1J310/);
    expect(textos[2]).toMatch(/^3J48/);
    expect(textos[3]).toMatch(/^4J13/);
    expect(textos[0]).toContain('–');
    expect(filas[0]).toHaveClass('yo');
  });
});

describe('Menú de la barra', () => {
  it('abre la lista, ejecuta la acción elegida y se cierra; Escape devuelve el foco al botón', async () => {
    const accion = vi.fn();
    render(<Menu elementos={[{ clave: 'a', texto: 'Reglas', accion }, { clave: 'b', texto: 'Salir', accion: () => undefined }]} />);
    const boton = screen.getByRole('button', { name: 'Menú' });
    await userEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reglas' }));
    expect(accion).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(boton);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(boton).toHaveFocus();
  });
});

describe('Pantalla de carga', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('muestra el estudio y el lema, y se va sola', () => {
    render(<Carga duracion={1000} />);
    expect(screen.getByText('El Niño Games')).toBeInTheDocument();
    expect(screen.getByText('Un juego 100% argentino')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1000));
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByText('El Niño Games')).toBeNull();
  });

  it('se saltea con un toque', () => {
    render(<Carga duracion={60_000} />);
    act(() => screen.getByRole('status').click());
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByText('El Niño Games')).toBeNull();
  });
});
