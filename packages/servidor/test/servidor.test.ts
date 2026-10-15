/**
 * Pruebas de integración: servidor real con Socket.IO y clientes simulados
 * que juegan usando SOLO lo que reciben por el protocolo (como hará el
 * navegador), sin mirar el estado interno del servidor.
 */
import { createSeededRng, type Rng } from '@tokinoto/reglas';
import { io as conectarCliente, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANAL_COMANDOS,
  CANAL_MENSAJES,
  VERSION_PROTOCOLO,
  type MensajeServidor,
} from '../src/protocolo';
import { crearServidor, type OpcionesServidor, type ServidorTokinoto } from '../src/servidor';

const abiertos: { servidores: ServidorTokinoto[]; clientes: Cliente[] } = { servidores: [], clientes: [] };

afterEach(async () => {
  for (const cliente of abiertos.clientes) cliente.socket.disconnect();
  for (const servidor of abiertos.servidores) await servidor.cerrar();
  abiertos.clientes = [];
  abiertos.servidores = [];
});

async function levantar(opciones: OpcionesServidor = {}): Promise<string> {
  const servidor = crearServidor({ sala: { pausaBazaMs: 0, pausaResumenMs: 0 }, ...opciones });
  abiertos.servidores.push(servidor);
  const puerto = await servidor.escuchar(0, '127.0.0.1');
  return `http://127.0.0.1:${puerto}`;
}

let contador = 0;

class Cliente {
  readonly recibidos: MensajeServidor[] = [];
  private esperas: { condicion: (m: MensajeServidor) => boolean; resolver: (m: MensajeServidor) => void }[] = [];

  constructor(readonly socket: Socket) {
    socket.on(CANAL_MENSAJES, (mensaje: MensajeServidor) => {
      this.recibidos.push(mensaje);
      this.esperas = this.esperas.filter((espera) => {
        if (!espera.condicion(mensaje)) return true;
        espera.resolver(mensaje);
        return false;
      });
    });
  }

  static async conectar(url: string, opciones: Parameters<typeof conectarCliente>[1] = {}): Promise<Cliente> {
    const socket = conectarCliente(url, { transports: ['websocket'], reconnection: false, forceNew: true, ...opciones });
    const cliente = new Cliente(socket);
    abiertos.clientes.push(cliente);
    await new Promise<void>((resolver, rechazar) => {
      socket.once('connect', () => resolver());
      socket.once('connect_error', rechazar);
    });
    return cliente;
  }

  /** Espera el primer mensaje (ya recibido o futuro) que cumpla la condición. */
  esperar(condicion: (m: MensajeServidor) => boolean, ms = 5000): Promise<MensajeServidor> {
    const ya = this.recibidos.find(condicion);
    if (ya) return Promise.resolve(ya);
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => rechazar(new Error('Tiempo de espera agotado')), ms);
      this.esperas.push({
        condicion,
        resolver: (m) => {
          clearTimeout(temporizador);
          resolver(m);
        },
      });
    });
  }

  crudo(mensaje: unknown): void {
    this.socket.emit(CANAL_COMANDOS, mensaje);
  }

  /** Envía un comando y espera su respuesta (ok o error). */
  pedir(tipo: string, datos?: unknown, idPedido = `c${++contador}`): Promise<MensajeServidor> {
    const respuesta = this.esperar((m) => (m.tipo === 'ok' || m.tipo === 'error') && 'idPedido' in m && m.idPedido === idPedido);
    this.crudo({ v: VERSION_PROTOCOLO, tipo, idPedido, ...(datos === undefined ? {} : { datos }) });
    return respuesta;
  }

  eventos(tipo?: string): (MensajeServidor & { seq: number })[] {
    return this.recibidos.filter(
      (m): m is MensajeServidor & { seq: number } => 'seq' in m && (tipo === undefined || m.tipo === tipo),
    );
  }
}

/** Crea una sala con `cantidad` clientes. Devuelve los clientes (el primero es el anfitrión) y el código. */
async function salaCon(url: string, cantidad: number): Promise<{ clientes: Cliente[]; codigo: string }> {
  const anfitrion = await Cliente.conectar(url);
  const creada = await anfitrion.pedir('sala.crear', { nombre: 'Anfitrión' });
  expect(creada.tipo).toBe('ok');
  const codigo = (creada.datos as { codigo: string }).codigo;
  const clientes = [anfitrion];
  for (let i = 1; i < cantidad; i++) {
    const cliente = await Cliente.conectar(url);
    expect((await cliente.pedir('sala.unirse', { codigo: codigo.toLowerCase(), nombre: `Invitado ${i}` })).tipo).toBe('ok');
    clientes.push(cliente);
  }
  return { clientes, codigo };
}

/**
 * Jugador automático que decide solo con lo que recibe: su asiento, su mano
 * y los avisos de turno. Así se comprueba que el protocolo alcanza para jugar.
 */
function jugarSolo(cliente: Cliente, idJugador: string, rng: Rng): void {
  let asiento = -1;
  let cartasPorJugador = 0;
  let mano: string[] = [];
  const elegir = <T,>(opciones: T[]): T => opciones[rng.nextInt(opciones.length)]!;

  cliente.socket.on(CANAL_MENSAJES, (m: MensajeServidor) => {
    const datos = m.datos as Record<string, unknown>;
    switch (m.tipo) {
      case 'juego.iniciado':
        asiento = (datos['asientos'] as { asiento: number; idJugador: string }[]).find((a) => a.idJugador === idJugador)!.asiento;
        break;
      case 'partida.iniciada':
        cartasPorJugador = datos['cartasPorJugador'] as number;
        break;
      case 'partida.manoRepartida':
        mano = [...(datos['cartas'] as string[])];
        break;
      case 'baza.cartaJugada':
        if (datos['asiento'] === asiento) mano = mano.filter((c) => c !== datos['carta']);
        break;
      case 'apuesta.turno':
        if (datos['asiento'] === asiento) {
          const opciones = Array.from({ length: cartasPorJugador + 1 }, (_, i) => i).filter(
            (valor) => valor !== datos['valorProhibido'],
          );
          void cliente.pedir('juego.apostar', { valor: elegir(opciones) });
        }
        break;
      case 'baza.turno':
        if (datos['asiento'] === asiento) void cliente.pedir('juego.jugarCarta', { idCarta: elegir(mano) });
        break;
      default:
        break;
    }
  });
}

describe('servidor HTTP', () => {
  it('responde /salud', async () => {
    const url = await levantar();
    const respuesta = await fetch(`${url}/salud`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.text()).toBe('ok');
    expect((await fetch(`${url}/otra`)).status).toBe(404);
  });
});

describe('conexión y protocolo', () => {
  it('responde ping con la hora del servidor', async () => {
    const cliente = await Cliente.conectar(await levantar());
    const antes = Date.now();
    const respuesta = await cliente.pedir('ping');
    expect(respuesta).toMatchObject({ v: VERSION_PROTOCOLO, tipo: 'ok' });
    expect((respuesta.datos as { horaServidor: number }).horaServidor).toBeGreaterThanOrEqual(antes);
  });

  it('rechaza mensajes inválidos, otras versiones y comandos sin sala', async () => {
    const cliente = await Cliente.conectar(await levantar());
    cliente.crudo('basura');
    const basura = await cliente.esperar((m) => m.tipo === 'error' && 'idPedido' in m && m.idPedido === null);
    expect(basura.datos).toMatchObject({ codigo: 'MENSAJE_INVALIDO' });

    cliente.crudo({ v: 99, tipo: 'ping', idPedido: 'viejo' });
    const version = await cliente.esperar((m) => 'idPedido' in m && m.idPedido === 'viejo');
    expect(version.datos).toMatchObject({ codigo: 'VERSION_NO_SOPORTADA' });

    expect((await cliente.pedir('juego.apostar', { valor: 0 })).datos).toMatchObject({ codigo: 'NO_PERTENECE_A_SALA' });
    expect((await cliente.pedir('sala.unirse', { codigo: 'ABCD2345', nombre: 'X' })).datos).toMatchObject({
      codigo: 'SALA_NO_EXISTE',
    });
  });

  it('limita la frecuencia de mensajes por conexión', async () => {
    const cliente = await Cliente.conectar(await levantar({ limite: { capacidad: 5, porSegundo: 1 } }));
    const respuestas = await Promise.all(Array.from({ length: 10 }, () => cliente.pedir('ping')));
    const rechazos = respuestas.filter((r) => r.tipo === 'error');
    expect(rechazos.length).toBeGreaterThanOrEqual(4);
    expect(rechazos[0]!.datos).toMatchObject({ codigo: 'DEMASIADOS_MENSAJES' });
  });

  it('rechaza conexiones de orígenes no permitidos', async () => {
    const url = await levantar({ origenes: ['http://bueno.test'] });
    const opciones = (origin: string) => ({ transports: ['polling'], extraHeaders: { origin } });
    await expect(Cliente.conectar(url, opciones('http://malo.test'))).rejects.toThrow();
    const bueno = await Cliente.conectar(url, opciones('http://bueno.test'));
    expect((await bueno.pedir('ping')).tipo).toBe('ok');
  });
});

describe('salas por red', () => {
  it('crear es idempotente y no se puede estar en dos salas', async () => {
    const servidores = abiertos.servidores;
    const url = await levantar();
    const cliente = await Cliente.conectar(url);
    const primera = await cliente.pedir('sala.crear', { nombre: 'Ana' }, 'crear-1');
    const repetida = await cliente.pedir('sala.crear', { nombre: 'Ana' }, 'crear-1');
    expect(repetida.datos).toEqual(primera.datos);
    expect(servidores.at(-1)!.gestor.cantidad).toBe(1);
    expect((await cliente.pedir('sala.crear', { nombre: 'Ana' })).datos).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
    expect(cliente.recibidos.filter((m) => m.tipo === 'estado.foto')).toHaveLength(1);
  });

  it('al desconectarse en el lobby, los demás se enteran; al vaciarse, la sala desaparece', async () => {
    const url = await levantar();
    const gestor = abiertos.servidores.at(-1)!.gestor;
    const { clientes, codigo } = await salaCon(url, 2);
    const invitado = clientes[1]!;
    const idInvitado = (invitado.recibidos.find((m) => m.tipo === 'ok')!.datos as { idJugador: string }).idJugador;
    invitado.socket.disconnect();
    const salio = await clientes[0]!.esperar((m) => m.tipo === 'sala.jugadorSalio');
    expect(salio.datos).toEqual({ idJugador: idInvitado });

    expect((await clientes[0]!.pedir('sala.salir')).tipo).toBe('ok');
    expect(gestor.buscar(codigo)).toBeUndefined();
    // Ya fuera de la sala, puede crear otra.
    expect((await clientes[0]!.pedir('sala.crear', { nombre: 'Otra vez' })).tipo).toBe('ok');
  });

  for (const cantidad of [4, 7]) {
    it(`${cantidad} clientes juegan un juego completo usando solo el protocolo`, async () => {
      // Sin pausas, el juego va mucho más rápido que entre personas: se amplía el límite de frecuencia.
      const url = await levantar({ limite: { capacidad: 1000, porSegundo: 1000 } });
      const { clientes } = await salaCon(url, cantidad);
      clientes.forEach((cliente, i) => {
        const id = (cliente.recibidos.find((m) => m.tipo === 'ok')!.datos as { idJugador: string }).idJugador;
        jugarSolo(cliente, id, createSeededRng(100 + i));
      });
      expect((await clientes[1]!.pedir('sala.iniciar', undefined, 'no-anfitrion')).datos).toMatchObject({
        codigo: 'NO_ES_ANFITRION',
      });
      expect((await clientes[0]!.pedir('sala.iniciar')).tipo).toBe('ok');

      const finales = await Promise.all(clientes.map((c) => c.esperar((m) => m.tipo === 'juego.terminado', 20_000)));
      // Todos ven el mismo resultado.
      for (const final of finales) expect(final).toEqual(finales[0]);

      for (const cliente of clientes) {
        // Ningún rechazo: los clientes eligieron con lo que el servidor les informó.
        const errores = cliente.recibidos.filter((m) => m.tipo === 'error' && m.idPedido !== 'no-anfitrion');
        expect(errores).toEqual([]);
        expect(cliente.eventos('baza.resuelta')).toHaveLength(56);
        // seq consecutivo desde la foto.
        const foto = cliente.recibidos.find((m) => m.tipo === 'estado.foto') as { seq: number };
        const seqs = cliente.eventos().filter((m) => m.tipo !== 'estado.foto').map((m) => m.seq);
        expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => foto.seq + 1 + i));
      }
      const ranking = (finales[0]!.datos as { ranking: { puesto: number }[] }).ranking;
      expect(ranking).toHaveLength(cantidad);
      expect(ranking[0]!.puesto).toBe(1);
    }, 30_000);
  }
});
