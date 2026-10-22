// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearTienda } from '../src/estado/tienda';
import { crearServidor } from '@tokinoto/servidor';
import { almacenEnMemoria } from '../src/estado/sesion';
import { armarMesa, crearComo, esperar, jugarHasta, juegoDe, levantarMundo, salaDe, tiendaDePrueba, unirseComo, type Mundo } from './ayuda';

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
    expect(await crearComo(ana, 'Ana')).toBe(true);
    const codigo = salaDe(ana)?.codigo ?? '';
    expect(codigo).toMatch(/^[A-Z0-9]+$/);
    expect(await unirseComo(beto, codigo, 'Beto')).toBe(true);
    await esperar(() => salaDe(ana)?.jugadores.length === 2);
    expect(ana.getState().registro.map((l) => l.texto)).toContain('Beto entró a la sala');
    expect(beto.getState().codigoSala).toBe(codigo);
    expect(beto.getState().cuenta).toEqual({ tipo: 'invitado', nombre: 'Beto' });
  });

  it('sin cuenta no entra a una sala; con cuenta, el nombre sale de ella y se puede cambiar', async () => {
    const almacen = almacenEnMemoria();
    const t = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(t);
    expect(t.getState().cuenta).toBeNull();
    expect(await t.getState().crearSala()).toBe(false);
    expect(t.getState().aviso?.texto).toMatch(/entrá/i);

    expect(await t.getState().entrarComoInvitado('Ana')).toBe(true);
    expect(almacen.cuenta).toMatchObject({ tipo: 'invitado', nombre: 'Ana' });
    expect(t.getState().conexion).toBe('inactiva'); // sin sala no deja la conexión abierta
    expect(await t.getState().cambiarNombre('Anita')).toBe(true);
    expect(t.getState().cuenta?.nombre).toBe('Anita');
    expect(await t.getState().crearSala()).toBe(true);
    expect(salaDe(t)?.jugadores.map((j) => j.nombre)).toEqual(['Anita']);

    // Cerrar sesión olvida la cuenta y la sala.
    t.getState().cerrarSesion();
    expect(t.getState().cuenta).toBeNull();
    expect(almacen.cuenta).toBeNull();
    expect(salaDe(t)).toBeNull();
  });

  it('una cuenta guardada se muestra enseguida, y se olvida si el servidor la rechaza', async () => {
    const almacen = almacenEnMemoria({ sesion: 'adulterada.firma-falsa', tipo: 'google', nombre: 'Ana' });
    const t = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(t);
    expect(t.getState().cuenta).toEqual({ tipo: 'google', nombre: 'Ana' });
    expect(await t.getState().consultarUltima()).toBeNull();
    expect(t.getState().cuenta).toBeNull();
    expect(almacen.cuenta).toBeNull();
    expect(t.getState().aviso?.texto).toMatch(/sesión venció/);
  });

  it('avisa si el código no existe y no deja a medias la conexión', async () => {
    const t = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(t);
    expect(await unirseComo(t, 'NOEXISTE', 'Ana')).toBe(false);
    expect(t.getState().aviso?.texto).toBeTruthy();
    expect(t.getState().conexion).toBe('inactiva');
  });

  it('avisa si no hay servidor', async () => {
    const t = crearTienda({ url: 'http://127.0.0.1:1' });
    expect(await crearComo(t, 'Ana')).toBe(false);
    expect(t.getState().aviso?.texto).toMatch(/conectar/);
  });

  it('no deja iniciar con menos de 4 jugadores', async () => {
    const ana = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana);
    await crearComo(ana, 'Ana');
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
    await crearComo(ana, 'Ana');
    expect(await ana.getState().salir()).toBe(true);
    expect(salaDe(ana)).toBeNull();
    expect(ana.getState().conexion).toBe('inactiva');
  });

});

describe('expulsar y chat (fase 7)', () => {
  it('el anfitrión saca a alguien: vuelve al inicio con un aviso y no puede volver a esa sala', async () => {
    const ana = tiendaDePrueba(mundo.url);
    const beto = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana, beto);
    await crearComo(ana, 'Ana');
    const codigo = salaDe(ana)!.codigo;
    await unirseComo(beto, codigo, 'Beto');
    await esperar(() => salaDe(ana)?.jugadores.length === 2);
    const idBeto = beto.getState().idJugador!;

    // Un invitado no puede sacar a nadie.
    expect(await beto.getState().expulsar(ana.getState().idJugador!)).toBe(false);
    expect(await ana.getState().expulsar(idBeto)).toBe(true);
    await esperar(() => salaDe(beto) === null);
    expect(beto.getState().conexion).toBe('inactiva');
    expect(beto.getState().aviso?.texto).toBe('El anfitrión te sacó de la sala.');
    expect(beto.getState().cuenta).toEqual({ tipo: 'invitado', nombre: 'Beto' });
    await esperar(() => salaDe(ana)?.jugadores.length === 1);
    expect(ana.getState().registro.map((l) => l.texto)).toContain('El anfitrión sacó a Beto de la sala');

    expect(await beto.getState().unirse(codigo)).toBe(false);
    expect(beto.getState().aviso?.texto).toMatch(/no podés volver a entrar/);
    // Puede armar otra sala.
    expect(await beto.getState().crearSala()).toBe(true);
  });

  it('el chat llega a todos, cuenta los sin leer y no bloquea los botones del juego', async () => {
    const ana = tiendaDePrueba(mundo.url);
    const beto = tiendaDePrueba(mundo.url);
    mundo.tiendas.push(ana, beto);
    await crearComo(ana, 'Ana');
    await unirseComo(beto, salaDe(ana)!.codigo, 'Beto');

    const enviado = ana.getState().enviarChat('Hola');
    expect(ana.getState().ocupado).toBe(false);
    expect(await enviado).toBe(true);
    await esperar(() => salaDe(beto)?.chat.length === 1);
    expect(salaDe(beto)!.chat[0]).toMatchObject({ nombre: 'Ana', texto: 'Hola' });
    expect(beto.getState().chatLeido).toBe(0);
    beto.getState().marcarChatLeido();
    expect(beto.getState().chatLeido).toBe(salaDe(beto)!.chat[0]!.id);

    // El servidor rechaza los vacíos y la tienda lo avisa.
    expect(await ana.getState().enviarChat('   ')).toBe(false);
    expect(ana.getState().aviso).not.toBeNull();
    // Al salir, el chat (y lo leído) se olvidan.
    await beto.getState().salir();
    expect(beto.getState().chatLeido).toBe(0);
  });
});

describe('ausencias (etapa 6)', () => {
  it('la sala usa 30 s por jugada, o ninguno si se pide', async () => {
    const [ana, beto] = [tiendaDePrueba(mundo.url), tiendaDePrueba(mundo.url)];
    mundo.tiendas.push(ana, beto);
    await crearComo(ana, 'Ana');
    expect(salaDe(ana)?.tiempoTurnoMs).toBe(30_000);
    await crearComo(beto, 'Beto');
    expect(await beto.getState().configurarTiempo(null)).toBe(true);
    await esperar(() => salaDe(beto)?.tiempoTurnoMs === null);
  });

  it('solo el anfitrión cambia el tiempo, y solo antes de empezar; todos se enteran', async () => {
    const [ana, beto] = [tiendaDePrueba(mundo.url), tiendaDePrueba(mundo.url)];
    mundo.tiendas.push(ana, beto);
    await crearComo(ana, 'Ana');
    await unirseComo(beto, salaDe(ana)!.codigo, 'Beto');
    expect(await ana.getState().configurarTiempo(60)).toBe(true);
    await esperar(() => salaDe(beto)?.tiempoTurnoMs === 60_000);
    expect(await beto.getState().configurarTiempo(null)).toBe(false);
    expect(salaDe(ana)?.tiempoTurnoMs).toBe(60_000);
  });

  it('"volver a esa partida" solo se ofrece si la partida sigue', async () => {
    const almacen = almacenEnMemoria();
    const ana = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(ana);
    await crearComo(ana, 'Ana');
    const codigo = salaDe(ana)!.codigo;
    // Otra pestaña del mismo navegador (misma cuenta, otra pestaña): la sala sigue, se ofrece volver.
    const otraPestaña = almacenEnMemoria(almacen.cuenta);
    const otra = tiendaDePrueba(mundo.url, otraPestaña);
    mundo.tiendas.push(otra);
    expect(await otra.getState().consultarUltima()).toEqual({ codigo });
    expect(otra.getState().conexion).toBe('inactiva');
    // Si sale de la sala, ya no hay nada que ofrecer.
    expect(await ana.getState().salir()).toBe(true);
    expect(await otra.getState().consultarUltima()).toBeNull();
    // Sin cuenta, tampoco.
    expect(await tiendaDePrueba(mundo.url).getState().consultarUltima()).toBeNull();
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
    await crearComo(ana, 'Ana');
    const codigo = salaDe(ana)!.codigo;
    expect(almacen.sala).toBe(codigo);

    // "Recarga": la tienda vieja se cierra sin avisar y una nueva retoma la sesión.
    ana.setState({ codigoSala: null });
    mundo.servidor.io.disconnectSockets(true);
    const otraVez = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(otraVez);
    expect(await otraVez.getState().retomarSesion()).toBe(true);
    expect(salaDe(otraVez)?.codigo).toBe(codigo);
    expect(salaDe(otraVez)?.jugadores).toHaveLength(1);
  });

  it('si la misma cuenta se abre en otra pestaña, la primera queda reemplazada', async () => {
    const almacen = almacenEnMemoria();
    const primera = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(primera);
    await crearComo(primera, 'Ana');
    const segunda = tiendaDePrueba(mundo.url, almacenEnMemoria(almacen.cuenta));
    mundo.tiendas.push(segunda);
    expect(await segunda.getState().reconectar()).toBe(true);
    await esperar(() => primera.getState().conexion === 'reemplazada');
    // Y puede volver a jugar desde la primera.
    expect(await primera.getState().reconectar()).toBe(true);
    await esperar(() => segunda.getState().conexion === 'reemplazada');
  });

  it('si la sala ya no existe, vuelve al inicio con un aviso y olvida la sesión', async () => {
    const almacen = almacenEnMemoria();
    const ana = tiendaDePrueba(mundo.url, almacen);
    mundo.tiendas.push(ana);
    await crearComo(ana, 'Ana');
    const puerto = Number(new URL(mundo.url).port);
    await mundo.servidor.cerrar();
    await esperar(() => ana.getState().conexion === 'reconectando');
    // El servidor vuelve (con la misma firma de sesiones, como en producción), pero sin la sala.
    mundo.servidor = crearServidor({ sala: { pausaBazaMs: 10, pausaResumenMs: 20 }, sesiones: mundo.sesiones });
    await mundo.servidor.escuchar(puerto, '127.0.0.1');
    await esperar(() => ana.getState().conexion === 'inactiva');
    expect(salaDe(ana)).toBeNull();
    expect(ana.getState().aviso?.texto).toMatch(/ya no existe/);
    expect(almacen.sala).toBeNull();
    expect(almacen.cuenta).not.toBeNull(); // la cuenta sigue: solo se perdió la sala
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
