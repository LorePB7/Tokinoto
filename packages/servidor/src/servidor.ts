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
import { error } from './errores';
import { GestorSalas, type OpcionesGestor } from './gestor';
import { LIMITE_POR_DEFECTO, Limitador, type OpcionesLimite } from './limitador';
import {
  CANAL_COMANDOS,
  CANAL_MENSAJES,
  leerPedido,
  mensajeError,
  mensajeRespuesta,
  respuestaError,
  respuestaOk,
  type MensajeServidor,
  type Respuesta,
} from './protocolo';
import type { Destino, Sala } from './sala';

export interface OpcionesServidor extends OpcionesGestor {
  /** Orígenes (sitios web) que pueden conectarse. '*' acepta cualquiera (solo para desarrollo). */
  origenes?: readonly string[] | '*';
  limite?: OpcionesLimite;
  /** Tamaño máximo de un mensaje entrante, en bytes. */
  maxBytesMensaje?: number;
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

  const http = createServer((pedido, respuesta) => {
    if (pedido.url === '/salud') {
      respuesta.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      respuesta.end('ok');
      return;
    }
    respuesta.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    respuesta.end('No encontrado');
  });

  const io = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: opciones.maxBytesMensaje ?? 16 * 1024,
    cors: { origin: origenes === '*' ? true : [...origenes] },
    allowRequest: (pedido: IncomingMessage, decidir) => decidir(null, origenPermitido(origenes, pedido.headers.origin)),
  });

  const gestor = new GestorSalas(opciones);
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
    cerrar() {
      gestor.cerrarTodas();
      return new Promise((resolver) => {
        void io.close(() => resolver());
      });
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
      const idPedido =
        typeof crudo === 'object' && crudo !== null && typeof (crudo as { idPedido?: unknown }).idPedido === 'string'
          ? (crudo as { idPedido: string }).idPedido.slice(0, 64)
          : null;
      enviar(mensajeError(idPedido, error('DEMASIADOS_MENSAJES', 'Estás enviando mensajes demasiado rápido')));
      return;
    }
    if (canal === CANAL_COMANDOS) procesar(crudo);
  });

  socket.on('disconnect', () => {
    if (vinculo) vinculo.sala.desconectar(vinculo.idJugador);
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
      case 'sala.unirse': {
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
          gestor.crear(comando.datos.nombre, comando.datos.maxJugadores ?? 7, destino, alResponder);
        } else {
          gestor.unirse(comando.datos.codigo, comando.datos.nombre, destino, alResponder);
        }
        return;
      }

      default: {
        const actual = vinculo;
        if (!actual) {
          responder(respuestaError('NO_PERTENECE_A_SALA', 'Primero tenés que crear una sala o unirte a una'));
          return;
        }
        actual.sala.comando(actual.idJugador, idPedido, comando, (respuesta) => {
          if (comando.tipo === 'sala.salir' && respuesta.ok && vinculo === actual) vinculo = null;
          responder(respuesta);
        });
      }
    }
  }
}
