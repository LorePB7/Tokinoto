import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VistaJuego } from '@tokinoto/protocolo';
import { Resumen } from '../src/componentes/Resumen';
import { ProveedorTienda } from '../src/estado/contexto';
import { crearTienda } from '../src/estado/tienda';
import { almacenEnMemoria } from '../src/estado/sesion';

describe('Resumen de la partida', () => {
  it('ordena de mayor a menor total y los empatados comparten lugar', () => {
    const nombres = ['Ana', 'Beto', 'Cora', 'Dani'];
    // Totales: Ana 0, Beto 12, Cora 12, Dani 20. Beto y Cora empatan en todo.
    const puntajes = [[0], [12], [12], [20]];
    const juego = {
      fase: 'RESUMEN',
      partida: 1,
      totalPartidas: 14,
      miAsiento: 0,
      asientos: nombres.map((nombre, asiento) => ({ asiento, nombre, idJugador: `j${asiento}` })),
      apuestas: [1, 1, 1, 1],
      bazasGanadas: [0, 1, 1, 1],
      puntajes,
      totales: [0, 12, 12, 20],
      finResumen: Date.now() + 6000,
    } as unknown as VistaJuego;
    const tienda = crearTienda({ url: 'http://localhost:1', almacen: almacenEnMemoria(), esperasDeReconexion: [20] });
    render(
      <ProveedorTienda tienda={tienda}>
        <Resumen juego={juego} />
      </ProveedorTienda>,
    );
    const filas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const lectura = filas.map((f) => f.textContent ?? '');
    expect(lectura[0]).toMatch(/^1Dani/);
    expect(lectura[1]).toMatch(/^2Beto/);
    expect(lectura[2]).toMatch(/^2Cora/);
    expect(lectura[3]).toMatch(/^4Ana/);
    // Sin botón de pausa: solo la cuenta regresiva de 6 s.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('timer').textContent).toBe('6');
  });
});
