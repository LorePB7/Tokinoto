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
import type { Repositorio } from '@tokinoto/persistencia';
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
  io.on('connection', (socket) => atenderConexion(socket, gestor, limite));

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

function atenderConexion(socket: Socket, gestor: GestorSalas, limite: OpcionesLimite): void {
  /** Sala y jugador de esta conexión. Se fija solo al crear o unirse con éxito. */
  let vinculo: { sala: Sala; idJugador: string } | null = null;
  const ingresos = new Map<string, Respuesta>();
  const limitador = new Limitador(limite);

  const enviar = (mensaje: MensajeServidor): void => {
    socket.emit(CANAL_MENSAJES, mensaje);
  };
  const destino: Destino = { enviar };

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

      case 'sala.crear':
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
        const alResponder = (respuesta: Respuesta, sala: Sala | null): void => {
          ingresos.set(idPedido, respuesta);
          if (ingresos.size > INGRESOS_RECORDADOS) {
            const masViejo = ingresos.keys().next().value;
            if (masViejo !== undefined) ingresos.delete(masViejo);
          }
          if (respuesta.ok && sala) vinculo = { sala, idJugador: respuesta.datos['idJugador'] as string };
          responder(respuesta);
        };
        if (comando.tipo === 'sala.crear') {
          const { nombre, maxJugadores, tiempoTurno } = comando.datos;
          gestor.crear(nombre, maxJugadores ?? 7, destino, alResponder, tiempoTurno);
        } else if (comando.tipo === 'sala.unirse') {
          gestor.unirse(comando.datos.codigo, comando.datos.nombre, destino, alResponder);
        } else {
          gestor.reconectar(comando.datos.token, destino, alResponder);
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
