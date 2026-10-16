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
import { App } from '../src/App';
import { CuentaRegresiva } from '../src/componentes/CuentaRegresiva';
import { almacenEnMemoria } from '../src/estado/sesion';
import { armarMesa, esperar, jugarHasta, juegoDe, levantarMundo, salaDe, tiendaDePrueba, type Mundo } from './ayuda';

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
    const ana = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana', 4);
    con(ana, <Lobby />);
    expect(screen.getByText(/Tiempo por jugada: 30 segundos/)).toBeInTheDocument();
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

describe('ausencias (etapa 6)', () => {
  it('la cuenta regresiva muestra los segundos y se resalta en los últimos 10', () => {
    const tienda = crearTienda({ url: 'http://127.0.0.1:1' });
    const { rerender } = con(tienda, <CuentaRegresiva fechaLimite={Date.now() + 25_500} />);
    expect(screen.getByRole('timer')).toHaveTextContent('26 s');
    expect(screen.getByRole('timer')).not.toHaveClass('urgente');
    rerender(
      <ProveedorTienda tienda={tienda}>
        <CuentaRegresiva fechaLimite={Date.now() + 8_000} />
      </ProveedorTienda>,
    );
    expect(screen.getByRole('timer')).toHaveClass('urgente');
    // Con el reloj del servidor adelantado, quedan menos segundos.
    tienda.setState({ desfaseReloj: 5_000 });
    rerender(
      <ProveedorTienda tienda={tienda}>
        <CuentaRegresiva fechaLimite={Date.now() + 25_500} />
      </ProveedorTienda>,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('21 s');
  });

  it('Inicio ofrece volver a la última partida de este navegador', () => {
    const almacen = almacenEnMemoria();
    almacen.ultima = { token: 'ABCDEFGH.secreto', codigo: 'ABCDEFGH', nombre: 'Ana' };
    const tienda = crearTienda({ url: 'http://127.0.0.1:1', almacen });
    con(tienda, <Inicio />);
    expect(screen.getByText(/Tenés una partida en la sala/)).toHaveTextContent('ABCDEFGH como Ana');
    expect(screen.getByRole('button', { name: /volver a esa partida/i })).toBeEnabled();
    expect(screen.getByLabelText(/tiempo por jugada/i)).toHaveValue('30');
  });

  it('avisa mientras reconecta y si la sesión se abrió en otra pestaña', () => {
    const tienda = crearTienda({ url: 'http://127.0.0.1:1' });
    tienda.setState({ conexion: 'reconectando' });
    const { unmount } = con(tienda, <App />);
    expect(screen.getByText(/Volviendo a la mesa/)).toBeInTheDocument();
    unmount();
    tienda.setState({ conexion: 'reemplazada', token: 'ABCDEFGH.secreto' });
    con(tienda, <App />);
    expect(screen.getByRole('heading', { name: /otra pestaña/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /jugar en esta pestaña/i })).toBeInTheDocument();
  });

  describe('con un servidor real', () => {
    let mundo: Mundo;
    beforeEach(async () => {
      mundo = await levantarMundo();
    });
    afterEach(async () => {
      await mundo.cerrar();
    });

    it('la mesa muestra el piloto de quien se fue y la cuenta regresiva del turno', async () => {
      const tiendas = await armarMesa(mundo, 4);
      await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS' && juegoDe(t)?.turno));
      const quedan = tiendas.slice(0, 3);
      await tiendas[3]!.getState().salir();
      await esperar(() => quedan.every((t) => salaDe(t)?.jugadores[3]?.piloto === 'abandono'));
      const t = quedan[0]!;
      con(t, <Mesa sala={salaDe(t)!} juego={juegoDe(t)!} />);
      expect(screen.getByText('Piloto')).toBeInTheDocument();
      if (juegoDe(t)!.turno?.fechaLimite) expect(screen.getAllByRole('timer').length).toBeGreaterThan(0);
    });

    it('salir del juego pide confirmación', async () => {
      const tiendas = await armarMesa(mundo, 4);
      await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS'));
      const t = tiendas[1]!;
      const { rerender } = con(t, <Mesa sala={salaDe(t)!} juego={juegoDe(t)!} />);
      await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(/piloto automático/);
      await userEvent.click(screen.getByRole('button', { name: /seguir jugando/i }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
      await userEvent.click(screen.getByRole('button', { name: /sí, salir/i }));
      await esperar(() => salaDe(t) === null);
      rerender(<ProveedorTienda tienda={t}>{null}</ProveedorTienda>);
      await esperar(() => salaDe(tiendas[0]!)?.jugadores[1]?.piloto === 'abandono');
    });

    it('si el piloto juega por mí, puedo retomar el control', async () => {
      const tiendas = await armarMesa(mundo, 4);
      await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS'));
      const t = tiendas[2]!;
      // Simulamos lo que veríamos tras 3 vencimientos seguidos.
      const sala = structuredClone(salaDe(t)!);
      sala.jugadores.find((j) => j.idJugador === sala.yo)!.piloto = 'tiempo';
      t.setState({ seguimiento: { ...t.getState().seguimiento, sala } });
      con(t, <Mesa sala={sala} juego={sala.juego!} />);
      expect(screen.getByText(/el piloto automático está jugando por vos/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /retomar el control/i }));
      expect(t.getState().aviso).toBeNull();
    });
  });
});
