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
  ESTADO_CLIENTE_INICIAL,
  VERSION_PROTOCOLO,
  aplicarMensaje,
  esEvento,
  type EstadoCliente,
  type MensajeEvento,
  type MensajeServidor,
} from '@tokinoto/protocolo';
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

  /** Conecta y entra como invitado (fase 6: hace falta identificarse para entrar a una sala). */
  static async invitado(url: string, nombre: string): Promise<Cliente & { sesion: string }> {
    const cliente = await Cliente.conectar(url);
    const respuesta = await cliente.pedir('cuenta.entrarInvitado', { nombre });
    expect(respuesta.tipo).toBe('ok');
    return Object.assign(cliente, { sesion: (respuesta.datos as { sesion: string }).sesion });
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
  const anfitrion = await Cliente.invitado(url, 'Anfitrión');
  const creada = await anfitrion.pedir('sala.crear', {});
  expect(creada.tipo).toBe('ok');
  const codigo = (creada.datos as { codigo: string }).codigo;
  const clientes = [anfitrion];
  for (let i = 1; i < cantidad; i++) {
    const cliente = await Cliente.invitado(url, `Invitado ${i}`);
    expect((await cliente.pedir('sala.unirse', { codigo: codigo.toLowerCase() })).tipo).toBe('ok');
    clientes.push(cliente);
  }
  return { clientes, codigo };
}

interface Bot {
  estado(): EstadoCliente;
  /** Cuántas veces detectó un salto y pidió una foto nueva. */
  resincronizaciones(): number;
}

/**
 * Jugador automático que decide SOLO con el estado que reconstruye a partir
 * de lo que recibe (el mismo seguimiento que usará el navegador). Así se
 * comprueba que el protocolo alcanza para jugar. Con `perder` se simulan
 * eventos perdidos, para ejercitar la resincronización.
 */
function jugarSolo(cliente: Cliente, rng: Rng, perder: (m: MensajeEvento) => boolean = () => false): Bot {
  let estado = ESTADO_CLIENTE_INICIAL;
  let resincronizaciones = 0;
  let esperandoFoto = false;
  let actuoEnSeq = -1;
  const elegir = <T,>(opciones: readonly T[]): T => opciones[rng.nextInt(opciones.length)]!;

  const procesar = (mensaje: MensajeServidor): void => {
    if (esEvento(mensaje) && perder(mensaje)) return;
    estado = aplicarMensaje(estado, mensaje);
    if (mensaje.tipo === 'estado.foto') esperandoFoto = false;
    if (estado.desincronizado) {
      if (!esperandoFoto) {
        esperandoFoto = true;
        resincronizaciones++;
        void cliente.pedir('sync.pedir', { ultimoSeq: estado.seq });
      }
      return;
    }
    const juego = estado.sala?.juego;
    const turno = juego?.turno;
    if (!juego || !turno || turno.asiento !== juego.miAsiento || actuoEnSeq === estado.seq) return;
    actuoEnSeq = estado.seq;
    if (turno.tipo === 'apuesta') {
      const opciones = Array.from({ length: juego.cartasPorJugador + 1 }, (_, i) => i).filter(
        (valor) => valor !== turno.valorProhibido,
      );
      void cliente.pedir('juego.apostar', { valor: elegir(opciones) });
    } else {
      void cliente.pedir('juego.jugarCarta', { idCarta: elegir(juego.miMano) });
    }
  };

  for (const mensaje of cliente.recibidos) procesar(mensaje);
  cliente.socket.on(CANAL_MENSAJES, procesar);
  return { estado: () => estado, resincronizaciones: () => resincronizaciones };
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
    // Sin identificarse no se entra a ninguna sala.
    expect((await cliente.pedir('sala.unirse', { codigo: 'ABCD2345' })).datos).toMatchObject({ codigo: 'NO_IDENTIFICADO' });
    expect((await cliente.pedir('sala.crear', {})).datos).toMatchObject({ codigo: 'NO_IDENTIFICADO' });
    expect((await cliente.pedir('sala.reconectar')).datos).toMatchObject({ codigo: 'NO_IDENTIFICADO' });
    expect((await cliente.pedir('sala.consultar')).datos).toEqual({ vigente: false });
    expect((await cliente.pedir('cuenta.entrarInvitado', { nombre: 'X' })).tipo).toBe('ok');
    expect((await cliente.pedir('sala.unirse', { codigo: 'ABCD2345' })).datos).toMatchObject({ codigo: 'SALA_NO_EXISTE' });
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
    const cliente = await Cliente.invitado(url, 'Ana');
    const primera = await cliente.pedir('sala.crear', {}, 'crear-1');
    const repetida = await cliente.pedir('sala.crear', {}, 'crear-1');
    expect(repetida.datos).toEqual(primera.datos);
    expect(primera.datos).not.toHaveProperty('token'); // el token del asiento no sale del servidor
    expect(servidores.at(-1)!.gestor.cantidad).toBe(1);
    expect((await cliente.pedir('sala.crear', {})).datos).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
    // Con la misma sesión desde otra conexión tampoco se abre una segunda sala.
    const otra = await Cliente.conectar(url);
    expect((await otra.pedir('cuenta.reanudar', { sesion: cliente.sesion })).tipo).toBe('ok');
    expect((await otra.pedir('sala.crear', {})).datos).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
    expect(servidores.at(-1)!.gestor.cantidad).toBe(1);
    expect(cliente.recibidos.filter((m) => m.tipo === 'estado.foto')).toHaveLength(1);
  });

  it('al desconectarse en el lobby, los demás se enteran; al vaciarse, la sala desaparece', async () => {
    const url = await levantar({ sala: { pausaBazaMs: 0, pausaResumenMs: 0, graciaLobbyMs: 30 } });
    const gestor = abiertos.servidores.at(-1)!.gestor;
    const { clientes, codigo } = await salaCon(url, 2);
    const invitado = clientes[1]!;
    const idInvitado = (invitado.recibidos.filter((m) => m.tipo === 'ok').at(-1)!.datos as { idJugador: string }).idJugador;
    invitado.socket.disconnect();
    // Primero se lo marca desconectado (por si recarga la página); si no vuelve, sale.
    await clientes[0]!.esperar((m) => m.tipo === 'jugador.conexion');
    const salio = await clientes[0]!.esperar((m) => m.tipo === 'sala.jugadorSalio');
    expect(salio.datos).toEqual({ idJugador: idInvitado });

    expect((await clientes[0]!.pedir('sala.salir')).tipo).toBe('ok');
    expect(gestor.buscar(codigo)).toBeUndefined();
    // Ya fuera de la sala, puede crear otra.
    expect((await clientes[0]!.pedir('sala.crear', {})).tipo).toBe('ok');
  });

  it('con la sesión se vuelve desde otra conexión; la anterior queda reemplazada', async () => {
    const url = await levantar();
    const gestor = abiertos.servidores.at(-1)!.gestor;
    const { clientes, codigo } = await salaCon(url, 4);
    expect((await clientes[0]!.pedir('sala.iniciar')).tipo).toBe('ok');
    const invitado = clientes[2]! as Cliente & { sesion: string };
    const ingreso = invitado.recibidos.filter((m) => m.tipo === 'ok').at(-1)!.datos as { idJugador: string };

    // Se corta y vuelve desde una conexión nueva: primero retoma la sesión, después el asiento.
    invitado.socket.disconnect();
    await clientes[0]!.esperar((m) => m.tipo === 'jugador.pilotoAutomatico');
    const nueva = await Cliente.conectar(url);
    expect((await nueva.pedir('sala.consultar')).datos).toEqual({ vigente: false }); // sin sesión no sabe quién es
    expect((await nueva.pedir('cuenta.reanudar', { sesion: invitado.sesion })).datos).toMatchObject({
      cuenta: { tipo: 'invitado', nombre: 'Invitado 2' },
    });
    expect((await nueva.pedir('sala.consultar')).datos).toEqual({ vigente: true, codigo, estado: 'JUGANDO' });
    const vuelta = await nueva.pedir('sala.reconectar');
    expect(vuelta).toMatchObject({ tipo: 'ok', datos: { codigo, idJugador: ingreso.idJugador } });
    const foto = await nueva.esperar((m) => m.tipo === 'estado.foto');
    expect((foto.datos as { yo: string; juego: unknown }).yo).toBe(ingreso.idJugador);
    expect((foto.datos as { juego: unknown }).juego).not.toBeNull();

    // Una tercera conexión con la misma sesión reemplaza a la segunda (también si usa el código).
    const otra = await Cliente.conectar(url);
    expect((await otra.pedir('cuenta.reanudar', { sesion: invitado.sesion })).tipo).toBe('ok');
    expect((await otra.pedir('sala.unirse', { codigo })).datos).toMatchObject({ codigo, idJugador: ingreso.idJugador });
    const aviso = await nueva.esperar((m) => m.tipo === 'error' && m.idPedido === null);
    expect(aviso.datos).toMatchObject({ codigo: 'SESION_REEMPLAZADA' });
    expect((await nueva.pedir('sync.pedir')).datos).toMatchObject({ codigo: 'SESION_REEMPLAZADA' });
    // Ya sin sala, esa conexión no puede abrir otra: la persona sigue sentada en la primera.
    expect((await nueva.pedir('sala.crear', {})).datos).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
    expect(gestor.cantidad).toBe(1);

    // Una sesión adulterada no entra; alguien identificado sin asiento tampoco vuelve.
    const extraña = await Cliente.conectar(url);
    const adulterada = `${invitado.sesion.split('.')[0]}x.${invitado.sesion.split('.')[1]}`;
    expect((await extraña.pedir('cuenta.reanudar', { sesion: adulterada })).datos).toMatchObject({ codigo: 'SESION_INVALIDA' });
    expect((await extraña.pedir('cuenta.entrarInvitado', { nombre: 'Extraña' })).tipo).toBe('ok');
    expect((await extraña.pedir('sala.reconectar')).datos).toMatchObject({ codigo: 'SESION_INVALIDA' });
  });

  for (const cantidad of [4, 7]) {
    it(`${cantidad} clientes juegan un juego completo usando solo el protocolo`, async () => {
      // Sin pausas, el juego va mucho más rápido que entre personas: se amplía el límite de frecuencia.
      const url = await levantar({ limite: { capacidad: 1000, porSegundo: 1000 } });
      const { clientes } = await salaCon(url, cantidad);
      const bots = clientes.map((cliente, i) => jugarSolo(cliente, createSeededRng(100 + i)));
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
      for (const bot of bots) {
        expect(bot.estado().sala?.juego?.ranking).toEqual(ranking);
        expect(bot.resincronizaciones()).toBe(0);
      }
    }, 30_000);
  }

  it('un cliente que pierde eventos lo detecta, pide una foto y sigue jugando', async () => {
    const url = await levantar({ limite: { capacidad: 1000, porSegundo: 1000 } });
    const { clientes } = await salaCon(url, 5);
    const avisosDeTurno = new Set(['apuesta.turno', 'baza.turno', 'juego.terminado']);
    const bots = clientes.map((cliente, i) =>
      jugarSolo(cliente, createSeededRng(200 + i), (m) => i === 2 && m.seq % 23 === 0 && !avisosDeTurno.has(m.tipo)),
    );
    expect((await clientes[0]!.pedir('sala.iniciar')).tipo).toBe('ok');
    await Promise.all(clientes.map((c) => c.esperar((m) => m.tipo === 'juego.terminado', 20_000)));

    const olvidadizo = bots[2]!;
    expect(olvidadizo.resincronizaciones()).toBeGreaterThan(3);
    expect(clientes[2]!.recibidos.filter((m) => m.tipo === 'estado.foto').length).toBe(1 + olvidadizo.resincronizaciones());
    // Al final, todos saben exactamente lo mismo del juego (salvo su propio asiento).
    const referencia = bots[0]!.estado();
    for (const bot of bots) {
      const estado = bot.estado();
      expect(estado.desincronizado).toBe(false);
      expect(estado.seq).toBe(referencia.seq);
      expect({ ...estado.sala!.juego!, miAsiento: 0 }).toEqual({ ...referencia.sala!.juego!, miAsiento: 0 });
    }
  }, 30_000);
});

describe('expulsar y chat por red (fase 7)', () => {
  it('el expulsado queda fuera de la sala pero identificado: no vuelve a esa sala y puede crear otra', async () => {
    const url = await levantar();
    const { clientes, codigo } = await salaCon(url, 3);
    const [anfitrion, , pepe] = clientes as [Cliente, Cliente, Cliente & { sesion: string }];
    const idPepe = (pepe.recibidos.filter((m) => m.tipo === 'ok').at(-1)!.datos as { idJugador: string }).idJugador;

    expect((await anfitrion.pedir('sala.expulsar', { idJugador: idPepe })).tipo).toBe('ok');
    expect((await pepe.esperar((m) => m.tipo === 'sala.expulsado')).datos).toEqual({ codigo });
    expect((await anfitrion.esperar((m) => m.tipo === 'sala.jugadorSalio')).datos).toEqual({ idJugador: idPepe, expulsado: true });

    // Su conexión ya no está en la sala: sus comandos no llegan y no puede volver, ni con el código ni reconectando.
    expect((await pepe.pedir('chat.enviar', { texto: 'hola' })).datos).toMatchObject({ codigo: 'NO_PERTENECE_A_SALA' });
    expect((await pepe.pedir('sala.unirse', { codigo })).datos).toMatchObject({ codigo: 'EXPULSADO' });
    expect((await pepe.pedir('sala.reconectar')).datos).toMatchObject({ codigo: 'EXPULSADO' });
    expect((await pepe.pedir('sala.consultar')).datos).toEqual({ vigente: false });
    // Desde otra conexión con la misma sesión, tampoco.
    const otra = await Cliente.conectar(url);
    expect((await otra.pedir('cuenta.reanudar', { sesion: pepe.sesion })).tipo).toBe('ok');
    expect((await otra.pedir('sala.unirse', { codigo })).datos).toMatchObject({ codigo: 'EXPULSADO' });
    // Puede armar su propia sala.
    expect((await pepe.pedir('sala.crear', {})).tipo).toBe('ok');
  });

  it('los mensajes de chat llegan a todos, sin seq, y quien entra después los ve en la foto', async () => {
    const url = await levantar();
    const { clientes, codigo } = await salaCon(url, 2);
    expect((await clientes[1]!.pedir('chat.enviar', { texto: '  ¡Hola!  ' })).tipo).toBe('ok');
    for (const cliente of clientes) {
      const mensaje = await cliente.esperar((m) => m.tipo === 'chat.mensaje');
      expect(mensaje).not.toHaveProperty('seq');
      expect(mensaje.datos).toMatchObject({ id: 1, nombre: 'Invitado 1', texto: '¡Hola!' });
    }
    const tercero = await Cliente.invitado(url, 'Tercero');
    expect((await tercero.pedir('sala.unirse', { codigo })).tipo).toBe('ok');
    const foto = await tercero.esperar((m) => m.tipo === 'estado.foto');
    expect((foto.datos as { chat: { texto: string }[] }).chat.map((m) => m.texto)).toEqual(['¡Hola!']);
    expect((await clientes[0]!.pedir('chat.enviar', { texto: 'x'.repeat(201) })).datos).toMatchObject({ codigo: 'MENSAJE_INVALIDO' });
  });
});
