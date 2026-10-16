import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Carta } from '../src/componentes/Carta';
import { Ficha } from '../src/componentes/Ficha';
import { Mano } from '../src/componentes/Mano';
import { PanelApuesta } from '../src/componentes/PanelApuesta';
import { Resultados } from '../src/componentes/Resultados';
import { ProveedorTienda } from '../src/estado/contexto';
import { crearTienda, type Tienda } from '../src/estado/tienda';
import { Inicio } from '../src/pantallas/Inicio';
import { Lobby } from '../src/pantallas/Lobby';
import { Mesa, mensajeDeTurno } from '../src/pantallas/Mesa';
import { armarMesa, esperar, jugarHasta, juegoDe, levantarMundo, salaDe, type Mundo } from './ayuda';

const con = (tienda: Tienda, hijo: ReactNode) => render(<ProveedorTienda tienda={tienda}>{hijo}</ProveedorTienda>);

describe('Carta y Ficha', () => {
  it('la carta muestra rango y palo, y es botón solo si se puede tocar', async () => {
    let toques = 0;
    const { rerender } = render(<Carta id="K-picas" tamano="m" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText('K').length).toBeGreaterThan(0);
    rerender(<Carta id="K-picas" tamano="m" onClick={() => toques++} />);
    await userEvent.click(screen.getByRole('button'));
    expect(toques).toBe(1);
  });

  it('el Comodín se muestra con estrella', () => {
    render(<Carta id="COMODIN" tamano="m" />);
    expect(screen.getAllByText('★').length).toBeGreaterThan(0);
  });

  it('el dorso no revela la carta', () => {
    const { container } = render(<Carta tamano="s" />);
    expect(container.textContent).toBe('');
  });

  it('la ficha lleva su número', () => {
    render(<Ficha valor={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

describe('pantallas iniciales', () => {
  it('Inicio no deja crear una sala sin nombre', async () => {
    const tienda = crearTienda({ url: 'http://127.0.0.1:1' });
    con(tienda, <Inicio />);
    const crear = screen.getByRole('button', { name: /crear sala/i });
    expect(crear).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/tu nombre/i), 'Ana');
    expect(crear).toBeEnabled();
  });
});

describe('con un servidor real', () => {
  let mundo: Mundo;
  beforeEach(async () => {
    mundo = await levantarMundo();
  });
  afterEach(async () => {
    await mundo.cerrar();
  });

  it('Lobby muestra el código y bloquea "Iniciar" con menos de 4 jugadores', async () => {
    const ana = crearTienda({ url: mundo.url });
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana', 4);
    con(ana, <Lobby />);
    expect(screen.getByText(salaDe(ana)!.codigo)).toBeInTheDocument();
    expect(screen.getByText(/^Ana/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iniciar/i })).toBeDisabled();
  });

  it('el panel de apuesta solo aparece en mi turno y deshabilita el valor prohibido del Pié', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS'));
    const pie = tiendas.find((t) => juegoDe(t)?.repartidor === juegoDe(t)?.miAsiento)!;
    const otros = tiendas.filter((t) => t !== pie);

    // Todavía no me toca: no hay panel.
    const { unmount } = con(pie, <PanelApuesta juego={juegoDe(pie)!} />);
    expect(screen.queryByRole('region', { name: /apuesta/i })).toBeNull();
    unmount();

    await jugarHasta(otros, () => {
      const j = juegoDe(pie);
      return j?.turno?.tipo === 'apuesta' && j.turno.asiento === j.miAsiento;
    });
    const juego = juegoDe(pie)!;
    con(pie, <PanelApuesta juego={juego} />);
    const panel = screen.getByRole('region', { name: /apuesta/i });
    const prohibido = juego.turno?.tipo === 'apuesta' ? juego.turno.valorProhibido : null;
    expect(prohibido).not.toBeNull();
    expect(within(panel).getAllByRole('button')).toHaveLength(juego.cartasPorJugador + 1);
    expect(within(panel).getByRole('button', { name: new RegExp(`Apostar ${prohibido} \\(no permitido\\)`) })).toBeDisabled();
    const permitido = prohibido === 0 ? 1 : 0;
    await userEvent.click(within(panel).getByRole('button', { name: new RegExp(`^Apostar ${permitido}$`) }));
    await esperar(() => juegoDe(pie)?.fase !== 'APUESTAS');
  });

  it('la mano se puede tocar solo en mi turno, y la mesa dice de quién es', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await jugarHasta(tiendas, () => tiendas.every((t) => juegoDe(t)?.fase === 'TIRADAS'));
    await esperar(() => tiendas.some((t) => {
      const j = juegoDe(t);
      return j?.turno?.asiento === j?.miAsiento;
    }));
    const conTurno = tiendas.find((t) => juegoDe(t)?.turno?.asiento === juegoDe(t)?.miAsiento)!;
    const sinTurno = tiendas.find((t) => t !== conTurno)!;

    const a = con(sinTurno, <Mano juego={juegoDe(sinTurno)!} />);
    expect(within(screen.getByRole('group', { name: /tu mano/i })).queryAllByRole('button')).toHaveLength(0);
    expect(mensajeDeTurno(juegoDe(sinTurno)!)).toMatch(/^Juega /);
    a.unmount();

    con(conTurno, <Mano juego={juegoDe(conTurno)!} />);
    expect(mensajeDeTurno(juegoDe(conTurno)!)).toBe('Te toca jugar una carta');
    const botones = within(screen.getByRole('group', { name: /tu mano/i })).getAllByRole('button');
    expect(botones.length).toBeGreaterThan(0);
    await userEvent.click(botones[0]!);
    await esperar(() => juegoDe(conTurno)?.turno?.asiento !== juegoDe(conTurno)?.miAsiento);
  });

  it('un juego completo: la mesa dibuja a todos y el resultado muestra el ranking', async () => {
    const tiendas = await armarMesa(mundo, 4);
    const t = tiendas[0]!;
    await esperar(() => juegoDe(t)?.fase === 'APUESTAS');
    const { unmount } = con(t, <Mesa sala={salaDe(t)!} juego={juegoDe(t)!} />);
    for (let i = 1; i <= 4; i++) expect(screen.getAllByText(new RegExp(`Jugador ${i}`)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tokinoto').length).toBeGreaterThan(0);
    unmount();

    await jugarHasta(tiendas, () => tiendas.every((x) => juegoDe(x)?.fase === 'TERMINADO'), 60000);
    con(t, <Resultados sala={salaDe(t)!} juego={juegoDe(t)!} />);
    const final = screen.getByRole('region', { name: /resultado final/i });
    expect(within(final).getAllByRole('listitem')).toHaveLength(4);
    expect(within(final).getByRole('button', { name: /jugar de nuevo/i })).toBeInTheDocument();
  }, 70000);
});
