/**
 * Protocolo de mensajes cliente ↔ servidor (docs/diseno-tecnico.md, sección 4).
 *
 * Transporte: Socket.IO. El cliente envía cada comando en el evento
 * `comando`; el servidor envía todo (respuestas, eventos y fotos) en el
 * evento `mensaje`. Todos los mensajes llevan el mismo sobre:
 *
 *   { v, tipo, idPedido?, seq?, datos }
 *
 * Todo lo que llega del cliente se valida con Zod antes de usarlo.
 */
import { z } from 'zod';
import { error, type CodigoError, type ErrorServidor } from './errores';

export const VERSION_PROTOCOLO = 1;

/** Nombre del evento de Socket.IO para comandos del cliente. */
export const CANAL_COMANDOS = 'comando';
/** Nombre del evento de Socket.IO para todo lo que envía el servidor. */
export const CANAL_MENSAJES = 'mensaje';

export const LARGO_MAXIMO_NOMBRE = 20;
export const LARGO_CODIGO_SALA = 8;
/** Alfabeto de los códigos de sala: sin 0/O, 1/I/L, para dictarlos sin confusión. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------------------
// Comandos del cliente
// ---------------------------------------------------------------------------

const nombre = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío')
  .max(LARGO_MAXIMO_NOMBRE, `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres`)
  .regex(/^[^\p{C}]+$/u, 'El nombre tiene caracteres no permitidos');

const codigoSala = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${ALFABETO_CODIGO}]{${LARGO_CODIGO_SALA}}$`), 'El código de sala no es válido');

const sinDatos = z.strictObject({}).optional();

const comandoSchema = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('sala.crear'),
    datos: z.strictObject({
      nombre,
      /** Cupo de la sala (4 a 7). El juego empieza con los presentes (4 a 7). */
      maxJugadores: z.int().min(4).max(7).optional(),
    }),
  }),
  z.strictObject({
    tipo: z.literal('sala.unirse'),
    datos: z.strictObject({ codigo: codigoSala, nombre }),
  }),
  z.strictObject({ tipo: z.literal('sala.salir'), datos: sinDatos }),
  z.strictObject({ tipo: z.literal('sala.iniciar'), datos: sinDatos }),
  z.strictObject({
    tipo: z.literal('sala.pausarResumen'),
    datos: z.strictObject({ pausar: z.boolean() }),
  }),
  z.strictObject({
    tipo: z.literal('juego.apostar'),
    // El rango (0..N) y que sea entero lo valida el motor, con su propio código de error.
    datos: z.strictObject({ valor: z.number() }),
  }),
  z.strictObject({
    tipo: z.literal('juego.jugarCarta'),
    datos: z.strictObject({ idCarta: z.string().min(1).max(20) }),
  }),
  z.strictObject({ tipo: z.literal('juego.revancha'), datos: sinDatos }),
  z.strictObject({ tipo: z.literal('ping'), datos: sinDatos }),
]);

export type Comando = z.infer<typeof comandoSchema>;
export type TipoComando = Comando['tipo'];
/** Comandos que se ejecutan dentro de una sala (todos menos crear, unirse y ping). */
export type ComandoDeSala = Exclude<Comando, { tipo: 'sala.crear' | 'sala.unirse' | 'ping' }>;

export interface PedidoValido {
  idPedido: string;
  comando: Comando;
}

export type LecturaPedido =
  | { ok: true; pedido: PedidoValido }
  | { ok: false; idPedido: string | null; error: ErrorServidor };

const sobreSchema = z.object({
  v: z.number(),
  tipo: z.string().max(40),
  idPedido: z.string().min(1).max(64),
  datos: z.unknown().optional(),
});

function explicar(problema: z.ZodError): string {
  const primero = problema.issues[0];
  if (!primero) return 'El mensaje no es válido';
  const ruta = primero.path.join('.');
  return ruta ? `${primero.message} (en "${ruta}")` : primero.message;
}

/** Lee y valida un comando recibido. Nunca lanza excepciones. */
export function leerPedido(crudo: unknown): LecturaPedido {
  const sobre = sobreSchema.safeParse(crudo);
  if (!sobre.success) {
    const idPedido =
      typeof crudo === 'object' && crudo !== null && typeof (crudo as { idPedido?: unknown }).idPedido === 'string'
        ? ((crudo as { idPedido: string }).idPedido.slice(0, 64) || null)
        : null;
    return { ok: false, idPedido, error: error('MENSAJE_INVALIDO', explicar(sobre.error)) };
  }
  const { v, tipo, idPedido, datos } = sobre.data;
  if (v !== VERSION_PROTOCOLO) {
    return {
      ok: false,
      idPedido,
      error: error('VERSION_NO_SOPORTADA', 'La versión del juego cambió: actualizá la página'),
    };
  }
  const comando = comandoSchema.safeParse(datos === undefined ? { tipo } : { tipo, datos });
  if (!comando.success) {
    return { ok: false, idPedido, error: error('MENSAJE_INVALIDO', explicar(comando.error)) };
  }
  return { ok: true, pedido: { idPedido, comando: comando.data } };
}

// ---------------------------------------------------------------------------
// Mensajes del servidor
// ---------------------------------------------------------------------------

/** Tipos de eventos numerados (con `seq`) que emite una sala. */
export type TipoEvento =
  // Sala
  | 'sala.jugadorEntro'
  | 'sala.jugadorSalio'
  | 'sala.anfitrionCambio'
  | 'sala.resumenPausado'
  | 'jugador.conexion'
  // Juego
  | 'juego.iniciado'
  | 'sorteo.cartasSacadas'
  | 'sorteo.resultado'
  | 'partida.iniciada'
  | 'partida.manoRepartida'
  | 'apuesta.turno'
  | 'apuesta.realizada'
  | 'baza.iniciada'
  | 'baza.turno'
  | 'baza.cartaJugada'
  | 'baza.resuelta'
  | 'partida.puntajes'
  | 'juego.terminado'
  | 'juego.abortado';

export type MensajeServidor =
  | { v: number; tipo: 'ok'; idPedido: string; datos: Record<string, unknown> }
  | { v: number; tipo: 'error'; idPedido: string | null; datos: ErrorServidor }
  | { v: number; tipo: TipoEvento; seq: number; datos: Record<string, unknown> }
  | { v: number; tipo: 'estado.foto'; seq: number; datos: Record<string, unknown> };

/** Respuesta a un comando: confirmación (con datos opcionales) o rechazo. */
export type Respuesta = { ok: true; datos: Record<string, unknown> } | { ok: false; error: ErrorServidor };

export function respuestaOk(datos: Record<string, unknown> = {}): Respuesta {
  return { ok: true, datos };
}

export function respuestaError(codigo: CodigoError, mensaje: string): Respuesta {
  return { ok: false, error: error(codigo, mensaje) };
}

export function mensajeRespuesta(idPedido: string, respuesta: Respuesta): MensajeServidor {
  return respuesta.ok
    ? { v: VERSION_PROTOCOLO, tipo: 'ok', idPedido, datos: respuesta.datos }
    : { v: VERSION_PROTOCOLO, tipo: 'error', idPedido, datos: respuesta.error };
}

export function mensajeError(idPedido: string | null, falla: ErrorServidor): MensajeServidor {
  return { v: VERSION_PROTOCOLO, tipo: 'error', idPedido, datos: falla };
}
