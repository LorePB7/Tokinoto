import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Carta } from '../src/componentes/Carta';
import { Ficha } from '../src/componentes/Ficha';
import { Mano } from '../src/componentes/Mano';
import { BotonReglas } from '../src/componentes/Reglas';
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

describe('fichas y reglas', () => {
  it('todas las fichas son iguales: solo cambia el número', () => {
    const { container } = render(
      <>
        <Ficha valor={0} />
        <Ficha valor={3} />
        <Ficha valor={7} />
      </>,
    );
    const clases = [...container.querySelectorAll('.ficha')].map((f) => f.className);
    expect(clases).toHaveLength(3);
    expect(new Set(clases).size).toBe(1);
  });

  it('el botón Reglas abre un panel con las reglas y las 14 cartas, y se cierra con Escape devolviendo el foco', async () => {
    render(<BotonReglas />);
    const boton = screen.getByRole('button', { name: 'Reglas' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(boton);
    const panel = screen.getByRole('dialog', { name: /reglas del juego/i });
    expect(within(panel).getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    expect(within(panel).getAllByRole('tab')).toHaveLength(4);
    await userEvent.click(within(panel).getByRole('tab', { name: 'Cartas' }));
    expect(within(within(panel).getByRole('list', { name: /cartas de menor a mayor/i })).getAllByRole('listitem')).toHaveLength(14);
    expect(within(panel).getByText(/le gana a todas, incluso al As/i)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('tab', { name: 'Puntos' }));
    expect(within(panel).getByText(/5 puntos más tu apuesta/i)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(boton).toHaveFocus();
  });

  it('el botón Cerrar también cierra el panel', async () => {
    render(<BotonReglas flotante />);
    await userEvent.click(screen.getByRole('button', { name: 'Reglas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('Inicio ofrece volver a la última partida solo si sigue en curso', async () => {
    const almacen = almacenEnMemoria();
    const ana = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    const otra = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(otra);
    con(otra, <Inicio />);
    expect(await screen.findByText(/Tenés una partida en la sala/)).toHaveTextContent(`${salaDe(ana)!.codigo} como Ana`);
    expect(screen.getByRole('button', { name: /volver a esa partida/i })).toBeEnabled();
  });

  it('Lobby muestra el código y bloquea "Iniciar" con menos de 4 jugadores', async () => {
    const ana = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    con(ana, <Lobby />);
    // El anfitrión elige el tiempo por jugada dentro de la sala.
    expect(screen.getByLabelText(/tiempo por jugada/i)).toHaveValue('30');
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
    expect(screen.queryByText(/tocá la carta que querés jugar/i)).toBeNull();
    a.unmount();

    // La pista va en el recuadro fijo del turno, en la pantalla de la mesa.
    con(conTurno, <Mesa sala={salaDe(conTurno)!} juego={juegoDe(conTurno)!} />);
    expect(mensajeDeTurno(juegoDe(conTurno)!)).toBe('Te toca jugar una carta');
    expect(screen.getByText(/tocá la carta que querés jugar/i)).toBeInTheDocument();
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

  it('Inicio no ofrece volver si no puede confirmar que la partida sigue, y ya no elige cupo ni tiempo', async () => {
    const almacen = almacenEnMemoria();
    almacen.ultima = { token: 'ABCDEFGH.secreto', codigo: 'ABCDEFGH', nombre: 'Ana' };
    const tienda = crearTienda({ url: 'http://127.0.0.1:1', almacen });
    con(tienda, <Inicio />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Tenés una partida en la sala/)).toBeNull();
    expect(screen.queryByLabelText(/jugadores como máximo/i)).toBeNull();
    expect(screen.queryByLabelText(/tiempo por jugada/i)).toBeNull();
    // Sin conexión no se sabe si la partida sigue: no se borra.
    expect(almacen.ultima).not.toBeNull();
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
      expect(screen.getByRole('img', { name: 'Piloto automático' })).toBeInTheDocument();
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
