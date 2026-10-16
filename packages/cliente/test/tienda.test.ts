// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearTienda } from '../src/estado/tienda';
import { armarMesa, esperar, jugarHasta, juegoDe, levantarMundo, salaDe, type Mundo } from './ayuda';

let mundo: Mundo;
beforeEach(async () => {
  mundo = await levantarMundo();
});
afterEach(async () => {
  await mundo.cerrar();
});

describe('tienda contra un servidor real', () => {
  it('crea una sala y otro jugador se une con el código', async () => {
    const ana = crearTienda({ url: mundo.url });
    const beto = crearTienda({ url: mundo.url });
    mundo.tiendas.push(ana, beto);
    expect(await ana.getState().crearSala('Ana', 4)).toBe(true);
    const codigo = salaDe(ana)?.codigo ?? '';
    expect(codigo).toMatch(/^[A-Z0-9]+$/);
    expect(await beto.getState().unirse(codigo, 'Beto')).toBe(true);
    await esperar(() => salaDe(ana)?.jugadores.length === 2);
    expect(ana.getState().registro.map((l) => l.texto)).toContain('Beto entró a la sala');
    expect(beto.getState().token).toBeTruthy();
  });

  it('avisa si el código no existe y no deja a medias la conexión', async () => {
    const t = crearTienda({ url: mundo.url });
    mundo.tiendas.push(t);
    expect(await t.getState().unirse('NOEXISTE', 'Ana')).toBe(false);
    expect(t.getState().aviso?.texto).toBeTruthy();
    expect(t.getState().conexion).toBe('inactiva');
  });

  it('avisa si no hay servidor', async () => {
    const t = crearTienda({ url: 'http://127.0.0.1:1' });
    expect(await t.getState().crearSala('Ana', 4)).toBe(false);
    expect(t.getState().aviso?.texto).toMatch(/conectar/);
  });

  it('no deja iniciar con menos de 4 jugadores', async () => {
    const ana = crearTienda({ url: mundo.url });
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana', 4);
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
    const ana = crearTienda({ url: mundo.url });
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana', 4);
    expect(await ana.getState().salir()).toBe(true);
    expect(salaDe(ana)).toBeNull();
    expect(ana.getState().conexion).toBe('inactiva');
  });

  it('si el servidor se cae, la conexión queda caída', async () => {
    const ana = crearTienda({ url: mundo.url });
    mundo.tiendas.push(ana);
    await ana.getState().crearSala('Ana', 4);
    await mundo.servidor.cerrar();
    await esperar(() => ana.getState().conexion === 'caida');
  });
});
