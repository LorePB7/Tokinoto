/**
 * Protocolo de mensajes cliente ↔ servidor (docs/protocolo.md).
 *
 * Transporte: Socket.IO. El cliente envía cada comando en el evento
 * `comando`; el servidor envía todo (respuestas, eventos y fotos) en el
 * evento `mensaje`. Todos los mensajes llevan el mismo sobre:
 *
 *   { v, tipo, idPedido?, seq?, datos }
 *
 * Todo lo que llega del cliente se valida con Zod antes de usarlo.
 * Este paquete lo comparten el servidor y el cliente.
 */
import { z } from 'zod';
import { error, type CodigoError, type ErrorServidor } from './errores';
import type { VistaSala } from './vista';

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
  z.strictObject({
    tipo: z.literal('sync.pedir'),
    /** Último `seq` que el cliente procesó bien (informativo). */
    datos: z.strictObject({ ultimoSeq: z.int().min(0).optional() }).optional(),
  }),
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

/** Saca el idPedido de un mensaje cualquiera, si lo tiene (para responder aunque esté mal formado). */
export function idPedidoDe(crudo: unknown): string | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const id = (crudo as { idPedido?: unknown }).idPedido;
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 64) : null;
}

/** Lee y valida un comando recibido. Nunca lanza excepciones. */
export function leerPedido(crudo: unknown): LecturaPedido {
  const sobre = sobreSchema.safeParse(crudo);
  if (!sobre.success) {
    return { ok: false, idPedido: idPedidoDe(crudo), error: error('MENSAJE_INVALIDO', explicar(sobre.error)) };
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

/** Arma un comando listo para enviar (lo usa el cliente). */
export function armarComando<T extends TipoComando>(
  tipo: T,
  idPedido: string,
  datos?: Extract<Comando, { tipo: T }>['datos'],
): { v: number; tipo: T; idPedido: string; datos?: unknown } {
  return datos === undefined ? { v: VERSION_PROTOCOLO, tipo, idPedido } : { v: VERSION_PROTOCOLO, tipo, idPedido, datos };
}

// ---------------------------------------------------------------------------
// Eventos del servidor
// ---------------------------------------------------------------------------

export interface AsientoPublico {
  asiento: number;
  idJugador: string;
  nombre: string;
}

export interface CartaSacada {
  asiento: number;
  /** Identificador de carta, por ejemplo "K-picas" o "COMODIN". */
  carta: string;
}

export interface ResultadoDePartida {
  asiento: number;
  apuesta: number;
  bazasGanadas: number;
  puntos: number;
}

export interface PuestoEnRanking {
  asiento: number;
  total: number;
  /** Los empatados comparten puesto (podio compartido). */
  puesto: number;
}

/** Datos de cada evento numerado, por tipo. */
export interface DatosEventos {
  'sala.jugadorEntro': { idJugador: string; nombre: string };
  'sala.jugadorSalio': { idJugador: string };
  'sala.anfitrionCambio': { anfitrion: string };
  'sala.resumenPausado': { pausado: boolean };
  'jugador.conexion': { idJugador: string; asiento: number; conectado: boolean };
  'juego.iniciado': { asientos: AsientoPublico[] };
  'sorteo.cartasSacadas': { sacadas: CartaSacada[]; repiten: number[] };
  'sorteo.resultado': { repartidor: number };
  'partida.iniciada': { partida: number; cartasPorJugador: number; repartidor: number; pie: number; mano: number };
  /** Privado: cada jugador recibe `cartas` con solo las suyas. */
  'partida.manoRepartida': { cantidades: number[]; cartas: string[] };
  'apuesta.turno': { asiento: number; valorProhibido: number | null; fechaLimite: number | null };
  'apuesta.realizada': { asiento: number; valor: number; porPiloto: boolean };
  'baza.iniciada': { baza: number; mano: number };
  'baza.turno': { asiento: number; baza: number; fechaLimite: number | null };
  'baza.cartaJugada': { asiento: number; carta: string; porPiloto: boolean };
  'baza.resuelta': { baza: number; ganador: number; cartaGanadora: string; tieneFicha: boolean };
  'partida.puntajes': { partida: number; resultados: ResultadoDePartida[]; totales: number[] };
  'juego.terminado': { ranking: PuestoEnRanking[] };
  'juego.abortado': { motivo: string };
}

export type TipoEvento = keyof DatosEventos;

export type MensajeEvento = {
  [T in TipoEvento]: { v: number; tipo: T; seq: number; datos: DatosEventos[T] };
}[TipoEvento];

export interface MensajeFoto {
  v: number;
  tipo: 'estado.foto';
  /** Último evento que la foto ya incluye. */
  seq: number;
  datos: VistaSala;
}

export interface MensajeOk {
  v: number;
  tipo: 'ok';
  idPedido: string;
  datos: Record<string, unknown>;
}

export interface MensajeError {
  v: number;
  tipo: 'error';
  idPedido: string | null;
  datos: ErrorServidor;
}

export type MensajeServidor = MensajeOk | MensajeError | MensajeEvento | MensajeFoto;

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

export function esEvento(mensaje: MensajeServidor): mensaje is MensajeEvento {
  return 'seq' in mensaje && mensaje.tipo !== 'estado.foto';
}
