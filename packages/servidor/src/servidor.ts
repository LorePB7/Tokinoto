/**
 * Servidor HTTP + Socket.IO. Conecta cada conexión con el gestor de salas.
 *
 * Seguridad básica (diseño técnico 3.9): todo mensaje se valida con Zod,
 * hay límite de frecuencia y de tamaño por conexión, se verifica el origen
 * y la identidad del jugador sale de la conexión, nunca del mensaje.
 */
import { createServer, type IncomingMessage, type Server as ServidorHttp } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import type { Cuentas, Repositorio } from '@tokinoto/persistencia';
import { Sesiones, cuentasEnMemoria, limpiarNombre, type Identidad, type VerificadorGoogle } from './cuentas';
import { cabecerasDeSeguridad, crearAtenderEstaticos } from './estaticos';
import { GestorSalas, type OpcionesGestor } from './gestor';
import { GuardadorHistorial, MOTIVO_ABORTO_REINICIO, type OpcionesGuardador } from './guardador';
import { LIMITE_POR_DEFECTO, Limitador, type OpcionesLimite } from './limitador';
import {
  CANAL_COMANDOS,
  CANAL_MENSAJES,
  error,
  idPedidoDe,
  leerPedido,
  mensajeError,
  mensajeRespuesta,
  respuestaError,
  respuestaOk,
  type ComandoDeCuenta,
  type MensajeServidor,
  type Respuesta,
} from '@tokinoto/protocolo';
import type { Destino, Sala } from './sala';

export interface OpcionesServidor extends OpcionesGestor {
  /** Orígenes (sitios web) que pueden conectarse. '*' acepta cualquiera (solo para desarrollo). */
  origenes?: readonly string[] | '*';
  limite?: OpcionesLimite;
  /** Tamaño máximo de un mensaje entrante, en bytes. */
  maxBytesMensaje?: number;
  /**
   * Dónde se guarda el historial de los juegos (DP-21). Sin esto no se guarda
   * nada. Quien lo pasa es dueño de la conexión y la cierra después de `cerrar()`.
   */
  repositorio?: Repositorio;
  /** Opciones del guardado (reintentos, aviso de errores). */
  guardador?: OpcionesGuardador;
  /**
   * Carpeta con el cliente web ya construido (`packages/cliente/dist`). Si se
   * pasa, el servidor también entrega la página del juego.
   */
  carpetaCliente?: string;
  /** Modo producción: agrega HSTS a las cabeceras de seguridad. */
  produccion?: boolean;
  /** Límite de conexiones simultáneas en todo el servidor, para no quedarse sin memoria. */
  maxConexiones?: number;
  /**
   * Verifica los tokens de Google (fase 6). null o sin definir: el ingreso con
   * Google no está disponible y solo se puede entrar como invitado.
   */
  verificadorGoogle?: VerificadorGoogle | null;
  /** Firma de las sesiones. Por defecto, un secreto al azar (se pierden al reiniciar). */
  sesiones?: Sesiones;
  /** Dónde viven las cuentas. Por defecto, el repositorio; sin él, en memoria. */
  cuentas?: Cuentas;
  /** Ingresos (Google o invitado) por conexión: ráfaga y ritmo sostenido. */
  limiteIngresos?: OpcionesLimite;
  /** Invitados nuevos en todo el servidor: ráfaga y ritmo sostenido. */
  limiteInvitados?: OpcionesLimite;
}

/** Por conexión: 5 ingresos seguidos y después uno cada 20 s. */
export const LIMITE_INGRESOS_POR_DEFECTO: OpcionesLimite = { capacidad: 5, porSegundo: 1 / 20 };
/** En todo el servidor: 30 invitados seguidos y después uno por segundo. */
export const LIMITE_INVITADOS_POR_DEFECTO: OpcionesLimite = { capacidad: 30, porSegundo: 1 };

/** Lo que cada conexión necesita para identificar a la persona. */
interface Identificacion {
  verificador: VerificadorGoogle | null;
  sesiones: Sesiones;
  cuentas: Cuentas;
  limiteIngresos: OpcionesLimite;
  invitados: Limitador;
}

export interface ServidorTokinoto {
  readonly http: ServidorHttp;
  readonly io: Server;
  readonly gestor: GestorSalas;
  /** Empieza a escuchar. Con puerto 0 elige uno libre. Devuelve el puerto. */
  escuchar(puerto?: number, host?: string): Promise<number>;
  cerrar(): Promise<void>;
}

/** Las conexiones sin cabecera Origin (clientes que no son navegadores) se aceptan. */
export function origenPermitido(origenes: readonly string[] | '*', origen: string | undefined): boolean {
  if (origenes === '*' || origen === undefined) return true;
  return origenes.includes(origen);
}

export function crearServidor(opciones: OpcionesServidor = {}): ServidorTokinoto {
  const origenes = opciones.origenes ?? '*';
  const limite = opciones.limite ?? LIMITE_POR_DEFECTO;

  const seguridad = cabecerasDeSeguridad(opciones.produccion ?? false);
  const atenderEstaticos = opciones.carpetaCliente
    ? crearAtenderEstaticos(opciones.carpetaCliente, opciones.produccion ?? false)
    : null;
  const maxConexiones = opciones.maxConexiones ?? 300;

  const http = createServer((pedido, respuesta) => {
    if (pedido.url === '/salud') {
      respuesta.writeHead(200, { ...seguridad, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      respuesta.end('ok');
      return;
    }
    if (atenderEstaticos?.(pedido, respuesta)) return;
    respuesta.writeHead(404, { ...seguridad, 'content-type': 'text/plain; charset=utf-8' });
    respuesta.end('No encontrado');
  });

  const io = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: opciones.maxBytesMensaje ?? 16 * 1024,
    cors: { origin: origenes === '*' ? true : [...origenes] },
    // Se consulta solo al abrir una conexión nueva (no en cada mensaje).
    allowRequest: (pedido: IncomingMessage, decidir) =>
      decidir(null, origenPermitido(origenes, pedido.headers.origin) && io.engine.clientsCount < maxConexiones),
  });

  const guardador = opciones.repositorio ? new GuardadorHistorial(opciones.repositorio, opciones.guardador) : null;
  const gestor = new GestorSalas(
    guardador ? { ...opciones, sala: { ...opciones.sala, historial: guardador } } : opciones,
  );
  const identificacion: Identificacion = {
    verificador: opciones.verificadorGoogle ?? null,
    sesiones: opciones.sesiones ?? Sesiones.efimeras(),
    cuentas: opciones.cuentas ?? opciones.repositorio ?? cuentasEnMemoria(),
    limiteIngresos: opciones.limiteIngresos ?? LIMITE_INGRESOS_POR_DEFECTO,
    invitados: new Limitador(opciones.limiteInvitados ?? LIMITE_INVITADOS_POR_DEFECTO),
  };
  io.on('connection', (socket) => atenderConexion(socket, gestor, limite, identificacion));

  return {
    http,
    io,
    gestor,
    escuchar(puerto = 0, host) {
      return new Promise((resolver, rechazar) => {
        http.once('error', rechazar);
        http.listen(puerto, host, () => {
          http.off('error', rechazar);
          resolver((http.address() as AddressInfo).port);
        });
      });
    },
    async cerrar() {
      gestor.cerrarTodas();
      await new Promise<void>((resolver) => {
        void io.close(() => resolver());
      });
      if (guardador && opciones.repositorio) {
        // Al apagar no se retoman juegos en curso (DT-05): quedan abortados en el historial.
        await guardador.vaciar();
        try {
          await opciones.repositorio.abortarEnCurso(MOTIVO_ABORTO_REINICIO, new Date());
        } catch (problema) {
          console.error('[historial] no se pudieron cerrar los juegos en curso:', problema);
        }
      }
    },
  };
}

/** Cuántas respuestas a sala.crear / sala.unirse se recuerdan por conexión. */
const INGRESOS_RECORDADOS = 16;

function atenderConexion(socket: Socket, gestor: GestorSalas, limite: OpcionesLimite, id: Identificacion): void {
  /** Sala y jugador de esta conexión. Se fija solo al crear o unirse con éxito. */
  let vinculo: { sala: Sala; idJugador: string } | null = null;
  /** Quién es la persona de esta conexión (fase 6). Hace falta para entrar a una sala. */
  let identidad: Identidad | null = null;
  /** Los comandos de cuenta esperan a la base o a Google: se procesan de a uno. */
  let cadenaCuenta: Promise<void> = Promise.resolve();
  const ingresosCuenta = new Limitador(id.limiteIngresos);
  const ingresos = new Map<string, Respuesta>();
  const limitador = new Limitador(limite);

  const enviar = (mensaje: MensajeServidor): void => {
    socket.emit(CANAL_MENSAJES, mensaje);
  };
  const destino: Destino = {
    enviar,
    // El anfitrión lo sacó de la sala (fase 7): esta conexión queda sin sala, pero identificada.
    alExpulsar: () => {
      vinculo = null;
    },
  };

  // Cuenta todo lo que llega (también nombres de evento desconocidos, que se ignoran).
  socket.onAny((canal: unknown, crudo: unknown) => {
    if (!limitador.tomar()) {
      enviar(mensajeError(idPedidoDe(crudo), error('DEMASIADOS_MENSAJES', 'Estás enviando mensajes demasiado rápido')));
      return;
    }
    if (canal === CANAL_COMANDOS) procesar(crudo);
  });

  socket.on('disconnect', () => {
    if (vinculo) vinculo.sala.desconectar(vinculo.idJugador, destino);
    vinculo = null;
  });

  function recordar(idPedido: string, respuesta: Respuesta): void {
    ingresos.set(idPedido, respuesta);
    if (ingresos.size > INGRESOS_RECORDADOS) {
      const masViejo = ingresos.keys().next().value;
      if (masViejo !== undefined) ingresos.delete(masViejo);
    }
  }

  /** Respuesta de un ingreso: la sesión para volver y cómo se llama la persona. */
  function identificada(nueva: Identidad, sesion: string): Respuesta {
    identidad = nueva;
    return respuestaOk({ sesion, cuenta: { tipo: nueva.tipo, nombre: nueva.nombre } });
  }

  async function atenderCuenta(comando: ComandoDeCuenta): Promise<Respuesta> {
    const esIngreso = comando.tipo === 'cuenta.entrar' || comando.tipo === 'cuenta.entrarInvitado';
    // Con una sala abierta no se cambia de persona ni de nombre (reanudar la misma sesión sí).
    if (vinculo && comando.tipo !== 'cuenta.reanudar') {
      return respuestaError('YA_ESTAS_EN_UNA_SALA', 'Salí de la sala para cambiar de cuenta o de nombre');
    }
    if (esIngreso && !ingresosCuenta.tomar()) {
      return respuestaError('DEMASIADOS_MENSAJES', 'Demasiados intentos de entrar. Esperá un rato.');
    }

    switch (comando.tipo) {
      case 'cuenta.entrar': {
        if (!id.verificador) {
          return respuestaError('LOGIN_NO_DISPONIBLE', 'El ingreso con Google no está disponible. Entrá como invitado.');
        }
        let perfil;
        try {
          perfil = await id.verificador(comando.datos.credencial);
        } catch {
          return respuestaError('CREDENCIAL_INVALIDA', 'No se pudo verificar tu cuenta de Google. Probá de nuevo.');
        }
        const cuenta = await id.cuentas.cuentaDeGoogle(perfil.sub, limpiarNombre(perfil.nombre), new Date());
        return identificada(
          { tipo: 'google', clave: `g:${cuenta.id}`, nombre: cuenta.nombre, cuentaId: cuenta.id },
          id.sesiones.deCuenta(cuenta.id),
        );
      }

      case 'cuenta.entrarInvitado': {
        if (!id.invitados.tomar()) {
          return respuestaError('DEMASIADOS_MENSAJES', 'Hay muchos ingresos como invitado ahora. Probá en un momento.');
        }
        const nuevo = id.sesiones.nuevoInvitado(comando.datos.nombre);
        return identificada(nuevo.identidad, nuevo.sesion);
      }

      case 'cuenta.reanudar': {
        const datos = id.sesiones.leer(comando.datos.sesion);
        if (!datos) return respuestaError('SESION_INVALIDA', 'Tu sesión venció. Volvé a entrar.');
        let nueva: Identidad;
        let sesion: string;
        if (datos.t === 'g') {
          const cuenta = await id.cuentas.obtenerCuenta(datos.c);
          if (!cuenta) return respuestaError('SESION_INVALIDA', 'Tu cuenta ya no existe. Volvé a entrar.');
          nueva = { tipo: 'google', clave: `g:${cuenta.id}`, nombre: cuenta.nombre, cuentaId: cuenta.id };
          sesion = id.sesiones.deCuenta(cuenta.id);
        } else {
          nueva = { tipo: 'invitado', clave: `i:${datos.i}`, nombre: datos.n, cuentaId: null };
          sesion = id.sesiones.deInvitado(datos.i, datos.n);
        }
        if (vinculo && identidad?.clave !== nueva.clave) {
          return respuestaError('YA_ESTAS_EN_UNA_SALA', 'Salí de la sala para cambiar de cuenta');
        }
        return identificada(nueva, sesion);
      }

      case 'cuenta.cambiarNombre': {
        const actual = identidad;
        if (!actual) return respuestaError('NO_IDENTIFICADO', 'Primero entrá con Google o como invitado');
        const nombre = limpiarNombre(comando.datos.nombre);
        if (actual.tipo === 'invitado') {
          const idInvitado = actual.clave.slice(2);
          return identificada({ ...actual, nombre }, id.sesiones.deInvitado(idInvitado, nombre));
        }
        const cuenta = await id.cuentas.cambiarNombreCuenta(actual.cuentaId!, nombre);
        if (!cuenta) return respuestaError('SESION_INVALIDA', 'Tu cuenta ya no existe. Volvé a entrar.');
        return identificada({ ...actual, nombre: cuenta.nombre }, id.sesiones.deCuenta(cuenta.id));
      }
    }
  }

  function procesar(crudo: unknown): void {
    const lectura = leerPedido(crudo);
    if (!lectura.ok) {
      enviar(mensajeError(lectura.idPedido, lectura.error));
      return;
    }
    const { idPedido, comando } = lectura.pedido;
    const responder = (respuesta: Respuesta): void => enviar(mensajeRespuesta(idPedido, respuesta));

    switch (comando.tipo) {
      case 'ping':
        responder(respuestaOk({ horaServidor: Date.now() }));
        return;

      case 'cuenta.entrar':
      case 'cuenta.entrarInvitado':
      case 'cuenta.reanudar':
      case 'cuenta.cambiarNombre': {
        const anterior = ingresos.get(idPedido);
        if (anterior) {
          responder(anterior);
          return;
        }
        cadenaCuenta = cadenaCuenta.then(async () => {
          let respuesta: Respuesta;
          try {
            respuesta = await atenderCuenta(comando);
          } catch (problema) {
            console.error('[cuenta] error inesperado:', problema);
            respuesta = respuestaError('ERROR_INTERNO', 'No se pudo entrar. Probá de nuevo en un momento.');
          }
          recordar(idPedido, respuesta);
          if (socket.connected) responder(respuesta);
        });
        return;
      }

      case 'sala.consultar':
        // No hace falta estar en una sala: solo dice si la persona tiene un lugar en pie.
        if (!identidad) {
          responder(respuestaOk({ vigente: false }));
          return;
        }
        gestor.consultar(identidad, responder);
        return;

      case 'sala.abandonar':
        // Desde el inicio: deja la partida que tenía, sin volver a entrar.
        if (!identidad) {
          responder(respuestaOk());
          return;
        }
        gestor.abandonar(identidad, responder);
        return;

      case 'sala.crear':
      case 'sala.jugarContraBots':
      case 'sala.unirse':
      case 'sala.reconectar': {
        const anterior = ingresos.get(idPedido);
        if (anterior) {
          responder(anterior);
          return;
        }
        if (vinculo) {
          responder(respuestaError('YA_ESTAS_EN_UNA_SALA', 'Ya estás en una sala'));
          return;
        }
        const quien = identidad;
        if (!quien) {
          responder(respuestaError('NO_IDENTIFICADO', 'Primero entrá con Google o como invitado'));
          return;
        }
        const alResponder = (respuesta: Respuesta, sala: Sala | null): void => {
          recordar(idPedido, respuesta);
          if (respuesta.ok && sala) vinculo = { sala, idJugador: respuesta.datos['idJugador'] as string };
          responder(respuesta);
        };
        if (comando.tipo === 'sala.crear') {
          // `maxJugadores` ya no se usa (DP-11): toda sala admite hasta 7.
          gestor.crear(quien, destino, alResponder, comando.datos.tiempoTurno);
        } else if (comando.tipo === 'sala.jugarContraBots') {
          const { cantidad, nivel, tiempoTurno } = comando.datos;
          gestor.jugarContraBots(quien, destino, alResponder, cantidad, nivel, tiempoTurno ?? null);
        } else if (comando.tipo === 'sala.unirse') {
          gestor.unirse(comando.datos.codigo, quien, destino, alResponder);
        } else {
          gestor.reconectar(quien, destino, alResponder);
        }
        return;
      }

      default: {
        const actual = vinculo;
        if (!actual) {
          responder(respuestaError('NO_PERTENECE_A_SALA', 'Primero tenés que crear una sala o unirte a una'));
          return;
        }
        actual.sala.comando(
          actual.idJugador,
          idPedido,
          comando,
          (respuesta) => {
            const reemplazada = !respuesta.ok && respuesta.error.codigo === 'SESION_REEMPLAZADA';
            if (((comando.tipo === 'sala.salir' && respuesta.ok) || reemplazada) && vinculo === actual) vinculo = null;
            responder(respuesta);
          },
          destino,
        );
      }
    }
  }
}
