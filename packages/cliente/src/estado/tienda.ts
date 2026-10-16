/**
 * Estado del cliente: la conexión con el servidor y lo que el jugador sabe de
 * su sala y su juego.
 *
 * El cliente no deduce nada importante: muestra lo que el servidor confirma.
 * Mantiene la última foto y le aplica los eventos con `aplicarMensaje` (del
 * paquete compartido). Si nota que perdió un evento, pide una foto nueva.
 *
 * Reconexión (DP-14): el token de la sesión se guarda en la pestaña. Si la
 * conexión se corta, la tienda reintenta sola y vuelve al asiento con
 * `sala.reconectar`; al recargar la página, también.
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
import { almacenDelNavegador, type AlmacenSesion, type Sesion } from './sesion';

/** Cuánto se espera la respuesta del servidor a un comando. */
export const TIEMPO_DE_RESPUESTA_MS = 10_000;
/** Esperas entre reintentos de reconexión: crecen hasta el último valor y se quedan ahí. */
export const ESPERAS_DE_RECONEXION_MS = [300, 1000, 2000, 4000];
const LINEAS_DE_REGISTRO = 60;

/**
 * - inactiva: sin sala.
 * - conectando: entrando a una sala (o volviendo a ella al abrir la página).
 * - conectada: en la sala.
 * - reconectando: se cortó la conexión y se está volviendo solo.
 * - reemplazada: la misma sesión se abrió en otra pestaña.
 */
export type EstadoConexion = 'inactiva' | 'conectando' | 'conectada' | 'reconectando' | 'reemplazada';

export interface Aviso {
  id: number;
  texto: string;
}

export interface EstadoTienda {
  conexion: EstadoConexion;
  /** Última foto del servidor con los eventos aplicados. */
  seguimiento: EstadoCliente;
  idJugador: string | null;
  /** Secreto de la sesión: permite volver al asiento. */
  token: string | null;
  /** Hora del servidor menos la hora local, en ms (para las cuentas regresivas). */
  desfaseReloj: number;
  /** Hay un comando esperando respuesta. */
  ocupado: boolean;
  aviso: Aviso | null;
  registro: LineaRegistro[];

  crearSala(nombre: string, maxJugadores: number, tiempoTurno?: number | null): Promise<boolean>;
  unirse(codigo: string, nombre: string): Promise<boolean>;
  /** Vuelve a la sala con un token guardado. */
  reconectar(token: string): Promise<boolean>;
  /** Al abrir la página: si esta pestaña tenía una sesión, vuelve a ella. */
  retomarSesion(): Promise<boolean>;
  /** La última sesión de este navegador (aunque sea de otra pestaña), para ofrecer volver. */
  ultimaSesion(): Sesion | null;
  salir(): Promise<boolean>;
  iniciar(): Promise<boolean>;
  apostar(valor: number): Promise<boolean>;
  jugarCarta(idCarta: string): Promise<boolean>;
  retomarControl(): Promise<boolean>;
  pausarResumen(pausar: boolean): Promise<boolean>;
  revancha(): Promise<boolean>;
  descartarAviso(): void;
  /** Vuelve a la pantalla de inicio, cerrando la conexión y olvidando la sesión. */
  reiniciar(): void;
}

export interface OpcionesTienda {
  url: string;
  /** Permite probar sin red real. Por defecto crea un socket de Socket.IO. */
  crearSocket?: (url: string) => Socket;
  /** Dónde se guarda la sesión. Por defecto, el almacenamiento del navegador. */
  almacen?: AlmacenSesion;
  /** Esperas entre reintentos de reconexión. */
  esperasDeReconexion?: readonly number[];
}

export type Tienda = StoreApi<EstadoTienda>;

let contadorDePedidos = 0;
function nuevoIdPedido(): string {
  contadorDePedidos++;
  return `${Date.now().toString(36)}-${contadorDePedidos}-${Math.random().toString(36).slice(2, 8)}`;
}

function crearSocketPorDefecto(url: string): Socket {
  // La reconexión la maneja la tienda (necesita mandar el token en cada intento).
  return socketIo(url, { transports: ['websocket'], reconnection: false, forceNew: true });
}

interface Pendiente {
  resolver: (respuesta: MensajeOk | MensajeError) => void;
  temporizador: ReturnType<typeof setTimeout>;
}

export function crearTienda(opciones: OpcionesTienda): Tienda {
  const crearSocket = opciones.crearSocket ?? crearSocketPorDefecto;
  const almacen = opciones.almacen ?? almacenDelNavegador;
  const esperas = opciones.esperasDeReconexion ?? ESPERAS_DE_RECONEXION_MS;
  let socket: Socket | null = null;
  const pendientes = new Map<string, Pendiente>();
  let esperandoFoto = false;
  let contadorDeLineas = 0;
  let contadorDeAvisos = 0;
  let reintento: ReturnType<typeof setTimeout> | null = null;
  let intentos = 0;

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

    function cancelarReintento(): void {
      if (reintento) clearTimeout(reintento);
      reintento = null;
    }

    /** Cierra la conexión a propósito (sin disparar la reconexión). */
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
        } else if (mensaje.tipo === 'error' && mensaje.datos.codigo === 'SESION_REEMPLAZADA') {
          // Se abrió la misma sesión en otra pestaña: esta deja de jugar.
          cancelarReintento();
          cerrarConexion();
          set({ conexion: 'reemplazada' });
        } else if (mensaje.tipo === 'error') {
          // Rechazos sin pedido conocido, por ejemplo por exceso de mensajes.
          avisar(mensaje.datos.mensaje);
        }
        return;
      }

      const previo = get().seguimiento;
      const nuevo = aplicarMensaje(previo, mensaje);
      const cambios: Partial<EstadoTienda> = { seguimiento: nuevo };
      if (mensaje.tipo === 'estado.foto') {
        esperandoFoto = false;
        cambios.desfaseReloj = mensaje.datos.horaServidor - Date.now();
      }

      if (esEvento(mensaje) && nuevo !== previo && nuevo.sala && !nuevo.desincronizado) {
        const texto = describirEvento(mensaje, previo.sala, nuevo.sala);
        if (texto) {
          cambios.registro = [...get().registro, { id: ++contadorDeLineas, texto }].slice(-LINEAS_DE_REGISTRO);
        }
      }
      set(cambios);

      if (nuevo.desincronizado && !esperandoFoto) pedirFoto();
    }

    /** Abre una conexión. `silencioso` evita el aviso al fallar (en los reintentos). */
    async function conectar(silencioso = false): Promise<boolean> {
      if (socket?.connected) return true;
      return new Promise((resolver) => {
        const nuevoSocket = crearSocket(opciones.url);
        socket = nuevoSocket;
        nuevoSocket.on(CANAL_MENSAJES, procesar);
        nuevoSocket.once('connect', () => resolver(true));
        nuevoSocket.once('connect_error', () => {
          if (socket === nuevoSocket) socket = null;
          nuevoSocket.disconnect();
          if (!silencioso) avisar('No se pudo conectar con el servidor. Probá de nuevo en un momento.');
          resolver(false);
        });
        nuevoSocket.on('disconnect', () => {
          if (socket !== nuevoSocket) return; // cierre a propósito
          cerrarConexion();
          if (get().seguimiento.sala && get().token) empezarReconexion();
          else set({ conexion: 'inactiva' });
        });
      });
    }

    function empezarReconexion(): void {
      set({ conexion: 'reconectando', ocupado: false });
      intentos = 0;
      programarReintento();
    }

    function programarReintento(): void {
      cancelarReintento();
      const espera = esperas[Math.min(intentos, esperas.length - 1)] ?? 1000;
      intentos++;
      reintento = setTimeout(() => {
        reintento = null;
        void reintentar();
      }, espera);
    }

    async function reintentar(): Promise<void> {
      const token = get().token;
      if (get().conexion !== 'reconectando' || !token) return;
      if (!(await conectar(true))) {
        if (get().conexion === 'reconectando') programarReintento();
        return;
      }
      const id = nuevoIdPedido();
      const respuesta = await enviar(id, armarComando('sala.reconectar', id, { token }));
      if (get().conexion !== 'reconectando') return;
      if (respuesta.tipo === 'ok') {
        set({ conexion: 'conectada' });
      } else if (respuesta.datos.codigo === 'SESION_INVALIDA') {
        reiniciar();
        avisar('La sala ya no existe. Podés crear otra o unirte con un código.');
      } else {
        cerrarConexion();
        programarReintento();
      }
    }

    /** Ejecuta un comando y avisa si fue rechazado. Devuelve la confirmación, o null. */
    async function ejecutar(construir: (idPedido: string) => unknown, avisarError = true): Promise<MensajeOk | MensajeError> {
      set({ ocupado: true });
      const id = nuevoIdPedido();
      const respuesta = await enviar(id, construir(id));
      set({ ocupado: false });
      if (respuesta.tipo === 'error' && avisarError) avisar(respuesta.datos.mensaje);
      return respuesta;
    }

    /** Entra a una sala (crear, unirse o reconectar) y guarda la sesión. */
    async function ingresar(construir: (idPedido: string) => unknown, nombre: string | null): Promise<MensajeOk | MensajeError> {
      cancelarReintento();
      set({ conexion: 'conectando' });
      if (!(await conectar())) {
        set({ conexion: 'inactiva' });
        return errorLocal('', 'No se pudo conectar con el servidor');
      }
      const respuesta = await ejecutar(construir, false);
      if (respuesta.tipo === 'error') {
        if (!get().seguimiento.sala) cerrarConexion();
        set({ conexion: get().seguimiento.sala ? 'conectada' : 'inactiva' });
        return respuesta;
      }
      const token = String(respuesta.datos['token']);
      const codigo = String(respuesta.datos['codigo']);
      set({ conexion: 'conectada', idJugador: String(respuesta.datos['idJugador']), token });
      const yo = get().seguimiento.sala?.jugadores.find((j) => j.idJugador === get().idJugador)?.nombre;
      almacen.guardar({ token, codigo, nombre: nombre ?? yo ?? '' });
      return respuesta;
    }

    async function ingresarAvisando(construir: (idPedido: string) => unknown, nombre: string): Promise<boolean> {
      const respuesta = await ingresar(construir, nombre);
      if (respuesta.tipo === 'error' && respuesta.idPedido !== '') avisar(respuesta.datos.mensaje);
      return respuesta.tipo === 'ok';
    }

    async function reconectar(token: string): Promise<boolean> {
      const respuesta = await ingresar((id) => armarComando('sala.reconectar', id, { token }), null);
      if (respuesta.tipo === 'ok') return true;
      if (respuesta.datos.codigo === 'SESION_INVALIDA') {
        almacen.borrar();
        avisar('Esa partida ya no existe.');
      } else if (respuesta.idPedido !== '') {
        avisar(respuesta.datos.mensaje);
      }
      return false;
    }

    function reiniciar(): void {
      cancelarReintento();
      cerrarConexion();
      almacen.borrar();
      set({
        conexion: 'inactiva',
        seguimiento: ESTADO_CLIENTE_INICIAL,
        idJugador: null,
        token: null,
        ocupado: false,
        registro: [],
      });
    }

    const aceptado = async (construir: (idPedido: string) => unknown): Promise<boolean> =>
      (await ejecutar(construir)).tipo === 'ok';

    return {
      conexion: 'inactiva',
      seguimiento: ESTADO_CLIENTE_INICIAL,
      idJugador: null,
      token: null,
      desfaseReloj: 0,
      ocupado: false,
      aviso: null,
      registro: [],

      crearSala: (nombre, maxJugadores, tiempoTurno) =>
        ingresarAvisando(
          (id) =>
            armarComando('sala.crear', id, {
              nombre,
              maxJugadores,
              ...(tiempoTurno === undefined ? {} : { tiempoTurno }),
            }),
          nombre,
        ),
      unirse: (codigo, nombre) => ingresarAvisando((id) => armarComando('sala.unirse', id, { codigo, nombre }), nombre),
      reconectar,
      async retomarSesion() {
        const sesion = almacen.leer();
        return sesion ? reconectar(sesion.token) : false;
      },
      ultimaSesion: () => almacen.leerUltima(),

      async salir() {
        if (get().conexion !== 'conectada') {
          reiniciar();
          return true;
        }
        if (!(await aceptado((id) => armarComando('sala.salir', id)))) return false;
        reiniciar();
        return true;
      },
      iniciar: () => aceptado((id) => armarComando('sala.iniciar', id)),
      apostar: (valor) => aceptado((id) => armarComando('juego.apostar', id, { valor })),
      jugarCarta: (idCarta) => aceptado((id) => armarComando('juego.jugarCarta', id, { idCarta })),
      retomarControl: () => aceptado((id) => armarComando('juego.retomarControl', id)),
      pausarResumen: (pausar) => aceptado((id) => armarComando('sala.pausarResumen', id, { pausar })),
      revancha: () => aceptado((id) => armarComando('juego.revancha', id)),
      descartarAviso: () => set({ aviso: null }),
      reiniciar,
    };
  });

  return tienda;
}
