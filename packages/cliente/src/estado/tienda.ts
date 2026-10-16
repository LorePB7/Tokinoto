/**
 * Estado del cliente: la conexión con el servidor y lo que el jugador sabe de
 * su sala y su juego.
 *
 * El cliente no deduce nada importante: muestra lo que el servidor confirma.
 * Mantiene la última foto y le aplica los eventos con `aplicarMensaje` (del
 * paquete compartido). Si nota que perdió un evento, pide una foto nueva.
 */
import {
  CANAL_MENSAJES,
  ESTADO_CLIENTE_INICIAL,
  aplicarMensaje,
  armarComando,
  esEvento,
  type EstadoCliente,
  type MensajeError,
  type MensajeOk,
  type MensajeServidor,
} from '@tokinoto/protocolo';
import { io as socketIo, type Socket } from 'socket.io-client';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describirEvento, type LineaRegistro } from './registro';

/** Cuánto se espera la respuesta del servidor a un comando. */
export const TIEMPO_DE_RESPUESTA_MS = 10_000;
const LINEAS_DE_REGISTRO = 60;

export type EstadoConexion = 'inactiva' | 'conectando' | 'conectada' | 'caida';

export interface Aviso {
  id: number;
  texto: string;
}

export interface EstadoTienda {
  conexion: EstadoConexion;
  /** Última foto del servidor con los eventos aplicados. */
  seguimiento: EstadoCliente;
  idJugador: string | null;
  /** Secreto de la sesión (sirve para reconectar en la etapa 6). */
  token: string | null;
  /** Hay un comando esperando respuesta. */
  ocupado: boolean;
  aviso: Aviso | null;
  registro: LineaRegistro[];

  crearSala(nombre: string, maxJugadores: number): Promise<boolean>;
  unirse(codigo: string, nombre: string): Promise<boolean>;
  salir(): Promise<boolean>;
  iniciar(): Promise<boolean>;
  apostar(valor: number): Promise<boolean>;
  jugarCarta(idCarta: string): Promise<boolean>;
  pausarResumen(pausar: boolean): Promise<boolean>;
  revancha(): Promise<boolean>;
  descartarAviso(): void;
  /** Vuelve a la pantalla de inicio, cerrando la conexión. */
  reiniciar(): void;
}

export interface OpcionesTienda {
  url: string;
  /** Permite probar sin red real. Por defecto crea un socket de Socket.IO. */
  crearSocket?: (url: string) => Socket;
}

export type Tienda = StoreApi<EstadoTienda>;

let contadorDePedidos = 0;
function nuevoIdPedido(): string {
  contadorDePedidos++;
  return `${Date.now().toString(36)}-${contadorDePedidos}-${Math.random().toString(36).slice(2, 8)}`;
}

function crearSocketPorDefecto(url: string): Socket {
  return socketIo(url, { transports: ['websocket'], reconnection: false, forceNew: true });
}

interface Pendiente {
  resolver: (respuesta: MensajeOk | MensajeError) => void;
  temporizador: ReturnType<typeof setTimeout>;
}

export function crearTienda(opciones: OpcionesTienda): Tienda {
  const crearSocket = opciones.crearSocket ?? crearSocketPorDefecto;
  let socket: Socket | null = null;
  const pendientes = new Map<string, Pendiente>();
  let esperandoFoto = false;
  let contadorDeLineas = 0;
  let contadorDeAvisos = 0;

  const tienda = createStore<EstadoTienda>((set, get) => {
    const avisar = (texto: string): void => set({ aviso: { id: ++contadorDeAvisos, texto } });

    const errorLocal = (idPedido: string, mensaje: string): MensajeError => ({
      v: 1,
      tipo: 'error',
      idPedido,
      datos: { codigo: 'ERROR_INTERNO', mensaje },
    });

    /** Manda un comando y espera su respuesta (ok o error). */
    function enviar(idPedido: string, cuerpo: unknown): Promise<MensajeOk | MensajeError> {
      const actual = socket;
      if (!actual?.connected) return Promise.resolve(errorLocal(idPedido, 'No hay conexión con el servidor'));
      return new Promise((resolver) => {
        const temporizador = setTimeout(() => {
          pendientes.delete(idPedido);
          resolver(errorLocal(idPedido, 'El servidor no respondió. Probá de nuevo.'));
        }, TIEMPO_DE_RESPUESTA_MS);
        pendientes.set(idPedido, { resolver, temporizador });
        actual.emit('comando', cuerpo);
      });
    }

    function cerrarConexion(): void {
      const actual = socket;
      socket = null;
      esperandoFoto = false;
      for (const [id, pendiente] of pendientes) {
        clearTimeout(pendiente.temporizador);
        pendiente.resolver(errorLocal(id, 'Se perdió la conexión con el servidor'));
      }
      pendientes.clear();
      actual?.disconnect();
    }

    function pedirFoto(): void {
      esperandoFoto = true;
      const id = nuevoIdPedido();
      void enviar(id, armarComando('sync.pedir', id, { ultimoSeq: get().seguimiento.seq })).then((respuesta) => {
        if (respuesta.tipo === 'error') esperandoFoto = false;
      });
    }

    function procesar(mensaje: MensajeServidor): void {
      if (mensaje.tipo === 'ok' || mensaje.tipo === 'error') {
        const pendiente = mensaje.idPedido === null ? undefined : pendientes.get(mensaje.idPedido);
        if (pendiente && mensaje.idPedido !== null) {
          clearTimeout(pendiente.temporizador);
          pendientes.delete(mensaje.idPedido);
          pendiente.resolver(mensaje);
        } else if (mensaje.tipo === 'error') {
          // Rechazos sin pedido conocido, por ejemplo por exceso de mensajes.
          avisar(mensaje.datos.mensaje);
        }
        return;
      }

      const previo = get().seguimiento;
      const nuevo = aplicarMensaje(previo, mensaje);
      if (mensaje.tipo === 'estado.foto') esperandoFoto = false;

      let registro = get().registro;
      if (esEvento(mensaje) && nuevo !== previo && nuevo.sala && !nuevo.desincronizado) {
        const texto = describirEvento(mensaje, previo.sala, nuevo.sala);
        if (texto) registro = [...registro, { id: ++contadorDeLineas, texto }].slice(-LINEAS_DE_REGISTRO);
      }
      set({ seguimiento: nuevo, registro });

      if (nuevo.desincronizado && !esperandoFoto) pedirFoto();
    }

    async function conectar(): Promise<boolean> {
      if (socket?.connected) return true;
      set({ conexion: 'conectando' });
      return new Promise((resolver) => {
        const nuevoSocket = crearSocket(opciones.url);
        socket = nuevoSocket;
        nuevoSocket.on(CANAL_MENSAJES, procesar);
        nuevoSocket.once('connect', () => {
          set({ conexion: 'conectada' });
          resolver(true);
        });
        nuevoSocket.once('connect_error', () => {
          if (socket === nuevoSocket) socket = null;
          nuevoSocket.disconnect();
          set({ conexion: 'inactiva' });
          avisar('No se pudo conectar con el servidor. Probá de nuevo en un momento.');
          resolver(false);
        });
        nuevoSocket.on('disconnect', () => {
          if (socket !== nuevoSocket) return; // cierre a propósito
          cerrarConexion();
          set({ conexion: get().seguimiento.sala ? 'caida' : 'inactiva' });
        });
      });
    }

    /** Ejecuta un comando y avisa si fue rechazado. Devuelve true si el servidor lo aceptó. */
    async function ejecutar(construir: (idPedido: string) => unknown): Promise<MensajeOk | null> {
      set({ ocupado: true });
      const id = nuevoIdPedido();
      const respuesta = await enviar(id, construir(id));
      set({ ocupado: false });
      if (respuesta.tipo === 'error') {
        avisar(respuesta.datos.mensaje);
        return null;
      }
      return respuesta;
    }

    async function ingresar(construir: (idPedido: string) => unknown): Promise<boolean> {
      if (!(await conectar())) return false;
      const respuesta = await ejecutar(construir);
      if (!respuesta) {
        if (!get().seguimiento.sala) cerrarConexion();
        set({ conexion: get().seguimiento.sala ? get().conexion : 'inactiva' });
        return false;
      }
      set({
        idJugador: String(respuesta.datos['idJugador']),
        token: String(respuesta.datos['token']),
      });
      return true;
    }

    const reiniciar = (): void => {
      cerrarConexion();
      set({
        conexion: 'inactiva',
        seguimiento: ESTADO_CLIENTE_INICIAL,
        idJugador: null,
        token: null,
        ocupado: false,
        registro: [],
      });
    };

    return {
      conexion: 'inactiva',
      seguimiento: ESTADO_CLIENTE_INICIAL,
      idJugador: null,
      token: null,
      ocupado: false,
      aviso: null,
      registro: [],

      crearSala: (nombre, maxJugadores) =>
        ingresar((id) => armarComando('sala.crear', id, { nombre, maxJugadores })),
      unirse: (codigo, nombre) => ingresar((id) => armarComando('sala.unirse', id, { codigo, nombre })),

      async salir() {
        const respuesta = await ejecutar((id) => armarComando('sala.salir', id));
        if (!respuesta) return false;
        reiniciar();
        return true;
      },
      iniciar: async () => (await ejecutar((id) => armarComando('sala.iniciar', id))) !== null,
      apostar: async (valor) => (await ejecutar((id) => armarComando('juego.apostar', id, { valor }))) !== null,
      jugarCarta: async (idCarta) =>
        (await ejecutar((id) => armarComando('juego.jugarCarta', id, { idCarta }))) !== null,
      pausarResumen: async (pausar) =>
        (await ejecutar((id) => armarComando('sala.pausarResumen', id, { pausar }))) !== null,
      revancha: async () => (await ejecutar((id) => armarComando('juego.revancha', id))) !== null,
      descartarAviso: () => set({ aviso: null }),
      reiniciar,
    };
  });

  return tienda;
}
