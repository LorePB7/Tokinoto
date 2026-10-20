// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearTienda } from '../src/estado/tienda';
import { crearServidor } from '@tokinoto/servidor';
import { almacenEnMemoria } from '../src/estado/sesion';
import { armarMesa, esperar, jugarHasta, juegoDe, levantarMundo, salaDe, tiendaDePrueba, type Mundo } from './ayuda';

let mundo: Mundo;
beforeEach(async () => {
  mundo = await levantarMundo();
});
afterEach(async () => {
  await mundo.cerrar();
});

describe('tienda contra un servidor real', () => {
  it('crea una sala y otro jugador se une con el código', async () => {
    const ana = tiendaDePrueba(mundo.url);
    const beto = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana, beto);
    expect(await ana.getState().crearSala('Ana')).toBe(true);
    const codigo = salaDe(ana)?.codigo ?? '';
    expect(codigo).toMatch(/^[A-Z0-9]+$/);
    expect(await beto.getState().unirse(codigo, 'Beto')).toBe(true);
    await esperar(() => salaDe(ana)?.jugadores.length === 2);
    expect(ana.getState().registro.map((l) => l.texto)).toContain('Beto entró a la sala');
    expect(beto.getState().token).toBeTruthy();
  });

  it('avisa si el código no existe y no deja a medias la conexión', async () => {
    const t = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(t);
    expect(await t.getState().unirse('NOEXISTE', 'Ana')).toBe(false);
    expect(t.getState().aviso?.texto).toBeTruthy();
    expect(t.getState().conexion).toBe('inactiva');
  });

  it('avisa si no hay servidor', async () => {
    const t = crearTienda({ url: 'http://127.0.0.1:1' });
    expect(await t.getState().crearSala('Ana')).toBe(false);
    expect(t.getState().aviso?.texto).toMatch(/conectar/);
  });

  it('no deja iniciar con menos de 4 jugadores', async () => {
    const ana = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    expect(await ana.getState().iniciar()).toBe(false);
    expect(ana.getState().aviso).not.toBeNull();
  });

  it('el Pié no puede apostar el valor que iguala las bazas', async () => {
    const tiendas = await armarMesa(mundo, 4);
    // Todos apuestan 0, salvo que le toque al Pié con 0 prohibido.
    await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS'));
    const pie = tiendas.find((t) => juegoDe(t)?.repartidor === juegoDe(t)?.miAsiento);
    expect(pie).toBeDefined();
    await jugarHasta(tiendas.filter((t) => t !== pie), () => {
      const j = juegoDe(pie!);
      return j?.turno?.tipo === 'apuesta' && j.turno.asiento === j.miAsiento;
    });
    const juego = juegoDe(pie!)!;
    expect(juego.turno?.tipo === 'apuesta' ? juego.turno.valorProhibido : null).not.toBeNull();
    const prohibido = juego.turno?.tipo === 'apuesta' ? juego.turno.valorProhibido : null;
    pie!.getState().descartarAviso();
    expect(await pie!.getState().apostar(prohibido ?? 0)).toBe(false);
    expect(pie!.getState().aviso).not.toBeNull();
  });

  it('un juego entero termina con el mismo ranking para todos', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await jugarHasta(tiendas, () => tiendas.every((t) => juegoDe(t)?.fase === 'TERMINADO'), 60000);
    const rankings = tiendas.map((t) => JSON.stringify(juegoDe(t)?.ranking));
    expect(new Set(rankings).size).toBe(1);
    expect(juegoDe(tiendas[0]!)?.ranking).toHaveLength(4);
    expect(tiendas.map((t) => t.getState().aviso?.texto ?? null)).toEqual([null, null, null, null]);
  }, 70000);

  it('nunca recibe las cartas de los demás', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS'));
    for (const t of tiendas) {
      const { sorteo: _sorteo, miMano: _mano, ...resto } = juegoDe(t)!;
      const texto = JSON.stringify(resto);
      const miMano = juegoDe(t)?.miMano ?? [];
      expect(miMano).toHaveLength(1);
      // Las cartas de los otros no aparecen en ningún lado del estado.
      for (const otra of tiendas) {
        if (otra === t) continue;
        for (const carta of juegoDe(otra)?.miMano ?? []) {
          if (!miMano.includes(carta)) expect(texto).not.toContain(`"${carta}"`);
        }
      }
    }
  });

  it('salir devuelve a la pantalla de inicio', async () => {
    const ana = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    expect(await ana.getState().salir()).toBe(true);
    expect(salaDe(ana)).toBeNull();
    expect(ana.getState().conexion).toBe('inactiva');
  });

});

describe('ausencias (etapa 6)', () => {
  it('la sala usa 30 s por jugada, o ninguno si se pide', async () => {
    const [ana, beto] = [tiendaDePrueba(mundo.url), tiendaDePrueba(mundo.url)];
    mundo.tiendas.push(ana, beto);
    await ana.getState().crearSala('Ana');
    expect(salaDe(ana)?.tiempoTurnoMs).toBe(30_000);
    await beto.getState().crearSala('Beto');
    expect(await beto.getState().configurarTiempo(null)).toBe(true);
    await esperar(() => salaDe(beto)?.tiempoTurnoMs === null);
  });

  it('solo el anfitrión cambia el tiempo, y solo antes de empezar; todos se enteran', async () => {
    const [ana, beto] = [tiendaDePrueba(mundo.url), tiendaDePrueba(mundo.url)];
    mundo.tiendas.push(ana, beto);
    await ana.getState().crearSala('Ana');
    await beto.getState().unirse(salaDe(ana)!.codigo, 'Beto');
    expect(await ana.getState().configurarTiempo(60)).toBe(true);
    await esperar(() => salaDe(beto)?.tiempoTurnoMs === 60_000);
    expect(await beto.getState().configurarTiempo(null)).toBe(false);
    expect(salaDe(ana)?.tiempoTurnoMs).toBe(60_000);
  });

  it('"volver a esa partida" solo se ofrece si la partida sigue; si no, se olvida', async () => {
    const almacen = almacenEnMemoria();
    const ana = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    const token = almacen.ultima!.token;
    // Otra pestaña del mismo navegador: la sala sigue, se ofrece volver.
    const otra = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(otra);
    expect((await otra.getState().consultarUltima())?.token).toBe(token);
    expect(otra.getState().conexion).toBe('inactiva');
    // Un token de una sala que ya no existe: no se ofrece y se borra.
    almacen.ultima = { token: 'ZZZZZZZZ.inexistente-123456', codigo: 'ZZZZZZZZ', nombre: 'Ana' };
    expect(await otra.getState().consultarUltima()).toBeNull();
    expect(almacen.ultima).toBeNull();
  });

  it('el turno trae fecha límite y la tienda mide el desfase del reloj', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await esperar(() => tiendas.every((t) => juegoDe(t)?.turno !== null && juegoDe(t)?.fase === 'APUESTAS'));
    const turno = juegoDe(tiendas[0]!)!.turno!;
    expect(turno.fechaLimite).toBeGreaterThan(Date.now() + 25_000);
    expect(Math.abs(tiendas[0]!.getState().desfaseReloj)).toBeLessThan(1000);
  });

  it('si se corta la conexión, vuelve sola a su asiento y el juego sigue hasta el final', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await jugarHasta(tiendas, () => (juegoDe(tiendas[0]!)?.partida ?? 0) >= 2);
    const ids = tiendas.map((t) => t.getState().idJugador);
    mundo.servidor.io.disconnectSockets(true);
    await esperar(() => tiendas.every((t) => t.getState().conexion === 'reconectando'));
    await esperar(() => tiendas.every((t) => t.getState().conexion === 'conectada'));
    expect(tiendas.map((t) => t.getState().idJugador)).toEqual(ids);
    expect(tiendas.map((t) => juegoDe(t)?.miMano.length)).toEqual(tiendas.map((t) => juegoDe(t)?.cantidades[juegoDe(t)!.miAsiento]));
    await jugarHasta(tiendas, () => tiendas.every((t) => juegoDe(t)?.fase === 'TERMINADO'), 60_000);
    expect(new Set(tiendas.map((t) => JSON.stringify(juegoDe(t)?.ranking))).size).toBe(1);
  }, 70_000);

  it('al recargar la página vuelve con la sesión guardada en la pestaña', async () => {
    const almacen = almacenEnMemoria();
    const ana = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    const codigo = salaDe(ana)!.codigo;
    expect(almacen.leer()).toMatchObject({ codigo, nombre: 'Ana', token: ana.getState().token });

    // "Recarga": la tienda vieja se cierra sin avisar y una nueva retoma la sesión.
    ana.setState({ token: null });
    mundo.servidor.io.disconnectSockets(true);
    const otraVez = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(otraVez);
    expect(await otraVez.getState().retomarSesion()).toBe(true);
    expect(salaDe(otraVez)?.codigo).toBe(codigo);
    expect(salaDe(otraVez)?.jugadores).toHaveLength(1);
  });

  it('si la misma sesión se abre en otra pestaña, la primera queda reemplazada', async () => {
    const almacen = almacenEnMemoria();
    const primera = tiendaDePrueba(mundo.url, almacen);
    const segunda = tiendaDePrueba(mundo.url, almacenEnMemoria());
    mundo.tiendas.push(primera, segunda);
    await primera.getState().crearSala('Ana');
    expect(await segunda.getState().reconectar(primera.getState().token!)).toBe(true);
    await esperar(() => primera.getState().conexion === 'reemplazada');
    // Y puede volver a jugar desde la primera.
    expect(await primera.getState().reconectar(primera.getState().token!)).toBe(true);
    await esperar(() => segunda.getState().conexion === 'reemplazada');
  });

  it('si la sala ya no existe, vuelve al inicio con un aviso y olvida la sesión', async () => {
    const almacen = almacenEnMemoria();
    const ana = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana');
    const puerto = Number(new URL(mundo.url).port);
    await mundo.servidor.cerrar();
    await esperar(() => ana.getState().conexion === 'reconectando');
    // El servidor vuelve, pero sin la sala.
    mundo.servidor = crearServidor({ sala: { pausaBazaMs: 10, pausaResumenMs: 20 } });
    await mundo.servidor.escuchar(puerto, '127.0.0.1');
    await esperar(() => ana.getState().conexion === 'inactiva');
    expect(salaDe(ana)).toBeNull();
    expect(ana.getState().aviso?.texto).toMatch(/ya no existe/);
    expect(almacen.leer()).toBeNull();
  });

  it('quien sale con el juego en curso deja el piloto; los demás terminan el juego', async () => {
    const tiendas = await armarMesa(mundo, 4);
    await esperar(() => tiendas.every((t) => juegoDe(t)?.fase === 'APUESTAS'));
    const [ana, ...resto] = tiendas;
    expect(await ana!.getState().salir()).toBe(true);
    expect(salaDe(ana!)).toBeNull();
    await esperar(() => resto.every((t) => salaDe(t)?.jugadores.some((j) => j.piloto === 'abandono')));
    expect(resto[0]!.getState().registro.map((l) => l.texto)).toContain('Jugador 1 dejó la mesa: juega el piloto automático');
    await jugarHasta(resto, () => resto.every((t) => juegoDe(t)?.fase === 'TERMINADO'), 60_000);
    expect(resto[0]!.getState().registro.some((l) => l.texto.endsWith('(piloto)'))).toBe(true);
  }, 70_000);
});
