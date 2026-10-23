/**
 * Estado del cliente: la conexión con el servidor y lo que el jugador sabe de
 * su sala y su juego.
 *
 * El cliente no deduce nada importante: muestra lo que el servidor confirma.
 * Mantiene la última foto y le aplica los eventos con `aplicarMensaje` (del
 * paquete compartido). Si nota que perdió un evento, pide una foto nueva.
 *
 * Identidad (fase 6): antes de entrar a una sala hay que entrar con Google o
 * como invitado. El servidor devuelve una sesión firmada que se guarda en el
 * navegador; cada conexión nueva la presenta (`cuenta.reanudar`) antes de
 * cualquier otra cosa.
 *
 * Chat y expulsión (fase 7): los mensajes de chat llegan fuera de la secuencia
 * de eventos y se suman a la sala con el mismo `aplicarMensaje`. Si el
 * anfitrión saca a esta persona de la sala, la tienda vuelve al inicio.
 *
 * Reconexión (DP-14): si la conexión se corta, la tienda reintenta sola y
 * vuelve al asiento con `sala.reconectar` (el servidor sabe dónde está sentada
 * la persona); al recargar la página, también.
 */
import {
  CANAL_MENSAJES,
  ESTADO_CLIENTE_INICIAL,
  aplicarMensaje,
  armarComando,
  esEvento,
  type DatosCuenta,
  type EstadoCliente,
  type MensajeError,
  type MensajeOk,
  type MensajeServidor,
  type NivelBot,
} from '@tokinoto/protocolo';
import { io as socketIo, type Socket } from 'socket.io-client';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describirEvento, type LineaRegistro } from './registro';
import { almacenDelNavegador, type AlmacenSesion } from './sesion';

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
  /** Código de la sala en la que está (o estaba) esta pestaña: permite volver al asiento. */
  codigoSala: string | null;
  /** Con quién entró la persona (Google o invitado). null = todavía no entró. */
  cuenta: DatosCuenta | null;
  /** Hora del servidor menos la hora local, en ms (para las cuentas regresivas). */
  desfaseReloj: number;
  /** Hay un comando esperando respuesta. */
  ocupado: boolean;
  aviso: Aviso | null;
  registro: LineaRegistro[];
  /** Último mensaje de chat que la persona ya vio (id). Los de otros con id mayor cuentan como sin leer. */
  chatLeido: number;

  /** Entra con el token de identidad que dio el botón de Google. */
  entrarConGoogle(credencial: string): Promise<boolean>;
  entrarComoInvitado(nombre: string): Promise<boolean>;
  /** Cambia el nombre (se usa desde la próxima sala). */
  cambiarNombre(nombre: string): Promise<boolean>;
  /** Olvida la cuenta en este navegador. */
  cerrarSesion(): void;
  crearSala(): Promise<boolean>;
  /** Fase 8: crea una sala con vos y `cantidad` bots del nivel elegido, y empieza enseguida. */
  jugarContraBots(cantidad: number, nivel: NivelBot): Promise<boolean>;
  /** Anfitrión, en la sala de espera: suma un bot (fase 8). */
  agregarBot(nivel: NivelBot): Promise<boolean>;
  /** Anfitrión, en la sala de espera: quita un bot (fase 8). */
  quitarBot(idJugador: string): Promise<boolean>;
  /** Anfitrión, antes de iniciar: segundos por jugada (null = sin límite). */
  configurarTiempo(tiempoTurno: number | null): Promise<boolean>;
  /**
   * Si la persona tiene una partida sin terminar (lo confirma el servidor), su código.
   * Sin cuenta o sin conexión, null.
   */
  consultarUltima(): Promise<{ codigo: string } | null>;
  unirse(codigo: string): Promise<boolean>;
  /** Vuelve al asiento que la persona tiene en una sala. */
  reconectar(): Promise<boolean>;
  /** Al abrir la página: si esta pestaña estaba en una sala, vuelve a ella. */
  retomarSesion(): Promise<boolean>;
  salir(): Promise<boolean>;
  iniciar(): Promise<boolean>;
  apostar(valor: number): Promise<boolean>;
  jugarCarta(idCarta: string): Promise<boolean>;
  retomarControl(): Promise<boolean>;
  pausarResumen(pausar: boolean): Promise<boolean>;
  revancha(): Promise<boolean>;
  /** Anfitrión, en la sala de espera: saca a alguien de la sala (no puede volver). */
  expulsar(idJugador: string): Promise<boolean>;
  /** Manda un mensaje al chat de la sala. No bloquea los botones del juego mientras espera. */
  enviarChat(texto: string): Promise<boolean>;
  /** Marca como vistos todos los mensajes de chat recibidos hasta ahora. */
  marcarChatLeido(): void;
  descartarAviso(): void;
  /** Vuelve a la pantalla de inicio, cerrando la conexión y olvidando la sala (no la cuenta). */
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
  /** Avisa cada mensaje aplicado, con el estado antes y después (lo usa el sonido). */
  alMensaje?: (mensaje: MensajeServidor, previo: EstadoCliente, nuevo: EstadoCliente) => void;
}

export type Tienda = StoreApi<EstadoTienda>;

let contadorDePedidos = 0;
function nuevoIdPedido(): string {
  contadorDePedidos++;
  return `${Date.now().toString(36)}-${contadorDePedidos}-${Math.random().toString(36).slice(2, 8)}`;
}

function crearSocketPorDefecto(url: string): Socket {
  // La reconexión la maneja la tienda (necesita presentar la sesión en cada intento).
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
      v: 0,
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

      if (mensaje.tipo === 'sala.expulsado') {
        // El anfitrión sacó a esta persona de la sala: vuelve al inicio, con la cuenta intacta.
        reiniciar();
        avisar('El anfitrión te sacó de la sala.');
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
      opciones.alMensaje?.(mensaje, previo, nuevo);

      if (nuevo.desincronizado && !esperandoFoto) pedirFoto();
    }

    /** Abre una conexión. `silencioso` evita el aviso al fallar (en los reintentos). */
    // Conexión en curso: si dos acciones piden conectar a la vez, comparten el mismo socket.
    let conexionEnCurso: Promise<boolean> | null = null;

    function conectar(silencioso = false): Promise<boolean> {
      if (socket?.connected) return Promise.resolve(true);
      if (conexionEnCurso) return conexionEnCurso;
      conexionEnCurso = abrirSocket(silencioso).finally(() => {
        conexionEnCurso = null;
      });
      return conexionEnCurso;
    }

    function abrirSocket(silencioso: boolean): Promise<boolean> {
      return new Promise<boolean>((resolver) => {
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
          if (get().seguimiento.sala && get().codigoSala) empezarReconexion();
          else set({ conexion: 'inactiva' });
        });
      }).then(async (conectado) => (conectado ? identificar() : false));
    }

    /** Guarda la cuenta que confirmó el servidor (sesión renovada y nombre actual). */
    function guardarCuenta(respuesta: MensajeOk): void {
      const sesion = String(respuesta.datos['sesion']);
      const cuenta = respuesta.datos['cuenta'] as DatosCuenta;
      almacen.guardarCuenta({ sesion, tipo: cuenta.tipo, nombre: cuenta.nombre });
      set({ cuenta: { tipo: cuenta.tipo, nombre: cuenta.nombre } });
    }

    /** Olvida la cuenta (la sesión venció o se cerró). */
    function olvidarCuenta(): void {
      almacen.borrarCuenta();
      set({ cuenta: null });
    }

    /**
     * Cada conexión nueva presenta la sesión guardada antes que nada. Si el
     * servidor la rechaza, se olvida (hay que volver a entrar). Devuelve si la
     * conexión sigue en pie.
     */
    async function identificar(): Promise<boolean> {
      const guardada = almacen.leerCuenta();
      if (!guardada) return true;
      const id = nuevoIdPedido();
      const respuesta = await enviar(id, armarComando('cuenta.reanudar', id, { sesion: guardada.sesion }));
      if (respuesta.tipo === 'ok') {
        guardarCuenta(respuesta);
      } else if (respuesta.datos.codigo === 'SESION_INVALIDA' || respuesta.datos.codigo === 'MENSAJE_INVALIDO') {
        olvidarCuenta();
        avisar('Tu sesión venció. Volvé a entrar.');
      } else if (respuesta.datos.codigo === 'VERSION_NO_SOPORTADA') {
        avisar(respuesta.datos.mensaje);
      }
      return socket?.connected ?? false;
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
      if (get().conexion !== 'reconectando' || !get().codigoSala) return;
      if (!(await conectar(true))) {
        if (get().conexion === 'reconectando') programarReintento();
        return;
      }
      const id = nuevoIdPedido();
      const respuesta = await enviar(id, armarComando('sala.reconectar', id));
      if (get().conexion !== 'reconectando') return;
      if (respuesta.tipo === 'ok') {
        set({ conexion: 'conectada' });
      } else if (respuesta.datos.codigo === 'EXPULSADO') {
        reiniciar();
        avisar('El anfitrión te sacó de la sala.');
      } else if (respuesta.datos.codigo === 'SESION_INVALIDA' || respuesta.datos.codigo === 'NO_IDENTIFICADO') {
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

    /** Entra a una sala (crear, unirse o reconectar) y recuerda en qué sala está esta pestaña. */
    async function ingresar(construir: (idPedido: string) => unknown): Promise<MensajeOk | MensajeError> {
      cancelarReintento();
      set({ conexion: 'conectando' });
      if (!(await conectar())) {
        set({ conexion: 'inactiva' });
        return errorLocal('', 'No se pudo conectar con el servidor');
      }
      const respuesta = await ejecutar(construir, false);
      if (respuesta.tipo === 'error') {
        if (respuesta.datos.codigo === 'NO_IDENTIFICADO') olvidarCuenta();
        if (!get().seguimiento.sala) cerrarConexion();
        set({ conexion: get().seguimiento.sala ? 'conectada' : 'inactiva' });
        return respuesta;
      }
      const codigo = String(respuesta.datos['codigo']);
      set({ conexion: 'conectada', idJugador: String(respuesta.datos['idJugador']), codigoSala: codigo });
      almacen.guardarSala(codigo);
      return respuesta;
    }

    async function ingresarAvisando(construir: (idPedido: string) => unknown): Promise<boolean> {
      const respuesta = await ingresar(construir);
      if (respuesta.tipo === 'error' && respuesta.idPedido !== '') avisar(respuesta.datos.mensaje);
      return respuesta.tipo === 'ok';
    }

    async function reconectar(): Promise<boolean> {
      const respuesta = await ingresar((id) => armarComando('sala.reconectar', id));
      if (respuesta.tipo === 'ok') return true;
      if (respuesta.datos.codigo === 'SESION_INVALIDA' || respuesta.datos.codigo === 'EXPULSADO') {
        almacen.borrarSala();
        set({ codigoSala: null });
        avisar(respuesta.datos.codigo === 'EXPULSADO' ? respuesta.datos.mensaje : 'Esa partida ya no existe.');
      } else if (respuesta.idPedido !== '') {
        avisar(respuesta.datos.mensaje);
      }
      return false;
    }

    /** Comandos de cuenta: conecta si hace falta, y guarda la cuenta si salió bien. */
    async function comandoDeCuenta(construir: (idPedido: string) => unknown): Promise<boolean> {
      set({ ocupado: true });
      if (!(await conectar())) {
        set({ ocupado: false });
        return false;
      }
      const respuesta = await ejecutar(construir);
      if (respuesta.tipo === 'ok') guardarCuenta(respuesta);
      // Sin sala, la conexión no queda abierta de más (la próxima acción conecta de nuevo).
      if (!get().seguimiento.sala && get().conexion === 'inactiva') cerrarConexion();
      return respuesta.tipo === 'ok';
    }

    function reiniciar(): void {
      cancelarReintento();
      cerrarConexion();
      almacen.borrarSala();
      set({
        conexion: 'inactiva',
        seguimiento: ESTADO_CLIENTE_INICIAL,
        idJugador: null,
        codigoSala: null,
        ocupado: false,
        registro: [],
        chatLeido: 0,
      });
    }

    let consultaEnCurso: Promise<{ codigo: string } | null> | null = null;

    async function consultarUltimaAhora(): Promise<{ codigo: string } | null> {
      // Si esta pestaña ya está entrando o volviendo a una sala (por ejemplo, al recargar), no se mete en el medio.
      if (!almacen.leerCuenta() || get().conexion !== 'inactiva' || get().seguimiento.sala) return null;
      if (!(await conectar(true))) return null;
      const id = nuevoIdPedido();
      const respuesta = await enviar(id, armarComando('sala.consultar', id));
      // Si no entró a una sala mientras tanto, no deja la conexión abierta de más.
      if (!get().seguimiento.sala && get().conexion !== 'conectando') cerrarConexion();
      if (respuesta.tipo === 'error' || respuesta.datos['vigente'] !== true) return null;
      return { codigo: String(respuesta.datos['codigo']) };
    }

    const aceptado = async (construir: (idPedido: string) => unknown): Promise<boolean> =>
      (await ejecutar(construir)).tipo === 'ok';

    const guardada = almacen.leerCuenta();
    return {
      conexion: 'inactiva',
      seguimiento: ESTADO_CLIENTE_INICIAL,
      idJugador: null,
      codigoSala: null,
      // Se muestra la cuenta guardada enseguida; el servidor la confirma al conectar.
      cuenta: guardada ? { tipo: guardada.tipo, nombre: guardada.nombre } : null,
      desfaseReloj: 0,
      ocupado: false,
      aviso: null,
      registro: [],
      chatLeido: 0,

      entrarConGoogle: (credencial) => comandoDeCuenta((id) => armarComando('cuenta.entrar', id, { credencial })),
      entrarComoInvitado: (nombre) => comandoDeCuenta((id) => armarComando('cuenta.entrarInvitado', id, { nombre })),
      cambiarNombre: (nombre) => comandoDeCuenta((id) => armarComando('cuenta.cambiarNombre', id, { nombre })),
      cerrarSesion() {
        reiniciar();
        olvidarCuenta();
      },
      crearSala: () => ingresarAvisando((id) => armarComando('sala.crear', id, {})),
      jugarContraBots: (cantidad, nivel) =>
        ingresarAvisando((id) => armarComando('sala.jugarContraBots', id, { cantidad, nivel })),
      agregarBot: (nivel) => aceptado((id) => armarComando('sala.agregarBot', id, { nivel })),
      quitarBot: (idJugador) => aceptado((id) => armarComando('sala.quitarBot', id, { idJugador })),
      configurarTiempo: (tiempoTurno) => aceptado((id) => armarComando('sala.configurar', id, { tiempoTurno })),
      consultarUltima() {
        // Una sola consulta a la vez (React monta dos veces en desarrollo): comparten la respuesta.
        consultaEnCurso ??= consultarUltimaAhora().finally(() => {
          consultaEnCurso = null;
        });
        return consultaEnCurso;
      },
      unirse: (codigo) => ingresarAvisando((id) => armarComando('sala.unirse', id, { codigo })),
      reconectar,
      async retomarSesion() {
        const codigo = almacen.leerSala();
        if (!codigo || !almacen.leerCuenta()) return false;
        set({ codigoSala: codigo });
        return reconectar();
      },

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
      expulsar: (idJugador) => aceptado((id) => armarComando('sala.expulsar', id, { idJugador })),
      async enviarChat(texto) {
        const id = nuevoIdPedido();
        const respuesta = await enviar(id, armarComando('chat.enviar', id, { texto }));
        if (respuesta.tipo === 'error') avisar(respuesta.datos.mensaje);
        return respuesta.tipo === 'ok';
      },
      marcarChatLeido() {
        const ultimo = get().seguimiento.sala?.chat.at(-1)?.id ?? 0;
        if (ultimo > get().chatLeido) set({ chatLeido: ultimo });
      },
      descartarAviso: () => set({ aviso: null }),
      reiniciar,
    };
  });

  return tienda;
}
