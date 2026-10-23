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
import { BOT_LEVELS, type BotLevel } from '@tokinoto/reglas';
import { error, type CodigoError, type ErrorServidor } from './errores';
import type { VistaSala } from './vista';

/** v2 (fase 6): hay que identificarse (Google o invitado) antes de entrar a una sala. */
export const VERSION_PROTOCOLO = 2;

/** Nombre del evento de Socket.IO para comandos del cliente. */
export const CANAL_COMANDOS = 'comando';
/** Nombre del evento de Socket.IO para todo lo que envía el servidor. */
export const CANAL_MENSAJES = 'mensaje';

export const LARGO_MAXIMO_NOMBRE = 20;
export const LARGO_CODIGO_SALA = 8;
/** Alfabeto de los códigos de sala: sin 0/O, 1/I/L, para dictarlos sin confusión. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Tiempo por jugada (DP-13): por defecto 30 s; la sala puede elegir otro o ninguno. */
export const TIEMPO_TURNO_POR_DEFECTO_S = 30;
export const TIEMPO_TURNO_MINIMO_S = 10;
export const TIEMPO_TURNO_MAXIMO_S = 120;
/** Vencimientos seguidos tras los cuales el piloto automático toma el asiento (DP-13). */
export const VENCIMIENTOS_PARA_PILOTO = 3;

/** Chat de sala (DP-22, fase 7): largo máximo de un mensaje. */
export const LARGO_MAXIMO_CHAT = 200;
/** Cuántos mensajes de chat guarda la sala (en memoria) y recibe quien entra o vuelve. */
export const MENSAJES_DE_CHAT_GUARDADOS = 50;
/** Ritmo del chat por jugador: una ráfaga corta y después un mensaje por segundo. */
export const LIMITE_CHAT = { capacidad: 3, porSegundo: 1 } as const;

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

/**
 * Texto de chat: de 1 a 200 caracteres, una sola línea. Se rechazan los
 * caracteres de control y los que invierten la dirección del texto (servirían
 * para disfrazar un mensaje). Los emojis compuestos sí se aceptan.
 */
const textoChat = z
  .string()
  .trim()
  .min(1, 'El mensaje está vacío')
  .max(LARGO_MAXIMO_CHAT, `El mensaje puede tener hasta ${LARGO_MAXIMO_CHAT} caracteres`)
  .regex(/^[^\p{Cc}\u202A-\u202E\u2066-\u2069]+$/u, 'El mensaje tiene caracteres no permitidos');

/** Niveles de bot (fase 8). */
export type NivelBot = BotLevel;
export const NIVELES_BOT: readonly NivelBot[] = BOT_LEVELS;
/** Jugar contra bots: vos y de 3 a 6 bots (la mesa es de 4 a 7). */
export const BOTS_MINIMO = 3;
export const BOTS_MAXIMO = 6;

const nivelBot = z.enum(['facil', 'medio', 'dificil']);

/** Largo máximo de una sesión firmada por el servidor. */
export const LARGO_MAXIMO_SESION = 512;

const comandoSchema = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('cuenta.entrar'),
    /** Token de identidad que entregó el botón de Google (un JWT). Lo verifica el servidor. */
    datos: z.strictObject({ credencial: z.string().min(10).max(4096) }),
  }),
  z.strictObject({
    tipo: z.literal('cuenta.entrarInvitado'),
    datos: z.strictObject({ nombre }),
  }),
  z.strictObject({
    tipo: z.literal('cuenta.reanudar'),
    /** Sesión que el servidor entregó al entrar. */
    datos: z.strictObject({ sesion: z.string().min(10).max(LARGO_MAXIMO_SESION) }),
  }),
  z.strictObject({
    tipo: z.literal('cuenta.cambiarNombre'),
    /** Solo fuera de una sala: el nombre nuevo se usa desde la próxima sala. */
    datos: z.strictObject({ nombre }),
  }),
  z.strictObject({
    tipo: z.literal('sala.crear'),
    /** El nombre sale de la cuenta o del invitado (fase 6). */
    datos: z.strictObject({
      /**
       * Obsoleto (DP-11): la sala ya no tiene cupo elegible; entran hasta 7 y el anfitrión inicia con 4 a 7.
       * Se acepta y se ignora, para no romper pestañas con una versión vieja del cliente.
       */
      maxJugadores: z.int().min(4).max(7).optional(),
      /** Segundos por apuesta y por tirada; null = sin límite. Por defecto, 30. */
      tiempoTurno: z.int().min(TIEMPO_TURNO_MINIMO_S).max(TIEMPO_TURNO_MAXIMO_S).nullable().optional(),
    }),
  }),
  z.strictObject({
    tipo: z.literal('sala.jugarContraBots'),
    /** Crea una sala con vos y de 3 a 6 bots del mismo nivel, y la inicia sola (fase 8). */
    datos: z.strictObject({
      cantidad: z.int().min(BOTS_MINIMO).max(BOTS_MAXIMO),
      nivel: nivelBot,
      /** Segundos por jugada; null = sin límite (por defecto, sin límite: no hay nadie esperando). */
      tiempoTurno: z.int().min(TIEMPO_TURNO_MINIMO_S).max(TIEMPO_TURNO_MAXIMO_S).nullable().optional(),
    }),
  }),
  z.strictObject({
    tipo: z.literal('sala.unirse'),
    datos: z.strictObject({ codigo: codigoSala }),
  }),
  z.strictObject({
    tipo: z.literal('sala.reconectar'),
    /** Vuelve al asiento que la persona identificada tiene en una sala. */
    datos: sinDatos,
  }),
  z.strictObject({
    tipo: z.literal('sala.consultar'),
    /** ¿La persona identificada tiene un lugar vigente en alguna sala? Para ofrecer "volver a tu partida". */
    datos: sinDatos,
  }),
  z.strictObject({
    tipo: z.literal('sala.configurar'),
    /** Solo el anfitrión, antes de iniciar. Segundos por jugada; null = sin límite. */
    datos: z.strictObject({
      tiempoTurno: z.int().min(TIEMPO_TURNO_MINIMO_S).max(TIEMPO_TURNO_MAXIMO_S).nullable(),
    }),
  }),
  z.strictObject({
    tipo: z.literal('sala.expulsar'),
    /** Solo el anfitrión, en la sala de espera, y nunca a sí mismo. La persona no puede volver a esa sala. */
    datos: z.strictObject({ idJugador: z.string().min(1).max(64) }),
  }),
  z.strictObject({
    tipo: z.literal('sala.agregarBot'),
    /** Solo el anfitrión, en la sala de espera (fase 8). El bot ocupa un lugar como una persona. */
    datos: z.strictObject({ nivel: nivelBot }),
  }),
  z.strictObject({
    tipo: z.literal('sala.quitarBot'),
    /** Solo el anfitrión, en la sala de espera (fase 8). */
    datos: z.strictObject({ idJugador: z.string().min(1).max(64) }),
  }),
  z.strictObject({
    tipo: z.literal('chat.enviar'),
    /** Mensaje para toda la sala. No se guarda en la base: vive mientras exista la sala. */
    datos: z.strictObject({ texto: textoChat }),
  }),
  z.strictObject({ tipo: z.literal('sala.salir'), datos: sinDatos }),
  z.strictObject({ tipo: z.literal('sala.iniciar'), datos: sinDatos }),
  z.strictObject({
    tipo: z.literal('juego.apostar'),
    // El rango (0..N) y que sea entero lo valida el motor, con su propio código de error.
    datos: z.strictObject({ valor: z.number() }),
  }),
  z.strictObject({
    tipo: z.literal('juego.jugarCarta'),
    datos: z.strictObject({ idCarta: z.string().min(1).max(20) }),
  }),
  z.strictObject({ tipo: z.literal('juego.retomarControl'), datos: sinDatos }),
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
/** Comandos de identidad (fase 6). */
export type ComandoDeCuenta = Extract<Comando, { tipo: `cuenta.${string}` }>;
/** Comandos que se ejecutan dentro de una sala (todos menos los de cuenta, crear, jugar contra bots, unirse, reconectar, consultar y ping). */
export type ComandoDeSala = Exclude<
  Comando,
  {
    tipo:
      | 'sala.crear'
      | 'sala.jugarContraBots'
      | 'sala.unirse'
      | 'sala.reconectar'
      | 'sala.consultar'
      | 'ping'
      | `cuenta.${string}`;
  }
>;

/** Lo que el servidor responde al identificarse: la sesión para volver y cómo se llama la persona. */
export interface DatosCuenta {
  tipo: 'google' | 'invitado';
  nombre: string;
}

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

/**
 * Por qué se activó el piloto automático: desconexión, tiempo vencido
 * (3 veces seguidas) o abandono (`sala.salir` con el juego en curso).
 */
export type MotivoPiloto = 'desconexion' | 'tiempo' | 'abandono';

/** Datos de cada evento numerado, por tipo. */
export interface DatosEventos {
  /** `bot`: el anfitrión sumó un bot de ese nivel (fase 8). */
  'sala.jugadorEntro': { idJugador: string; nombre: string; bot?: NivelBot };
  /** `expulsado`: lo sacó el anfitrión (fase 7). */
  'sala.jugadorSalio': { idJugador: string; expulsado?: boolean };
  'sala.anfitrionCambio': { anfitrion: string };
  /** El anfitrión cambió el tiempo por jugada (solo antes de iniciar). null = sin límite. */
  'sala.configuracion': { tiempoTurnoMs: number | null };
  'jugador.conexion': { idJugador: string; asiento: number; conectado: boolean };
  /** El piloto automático toma o deja un asiento. `motivo` es null al desactivarse. */
  'jugador.pilotoAutomatico': { idJugador: string; asiento: number; activado: boolean; motivo: MotivoPiloto | null };
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
  /** `finResumen`: hora del servidor en que termina el resumen y sigue el juego (DP-23: 6 s, sin pausa). */
  'partida.puntajes': { partida: number; resultados: ResultadoDePartida[]; totales: number[]; finResumen: number };
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

/** Un mensaje del chat de la sala (DP-22). */
export interface MensajeDeChat {
  /** Número creciente dentro de la sala: ordena los mensajes y evita duplicados. */
  id: number;
  idJugador: string;
  /** Nombre de quien lo mandó en ese momento (queda aunque después salga de la sala). */
  nombre: string;
  texto: string;
  /** Hora del servidor, en ms. */
  hora: number;
}

/**
 * Mensaje de chat. Va FUERA de la secuencia numerada de eventos (no lleva
 * `seq`): no se guarda en el registro ni en la base y no afecta la
 * reconstrucción de los juegos.
 */
export interface MensajeChat {
  v: number;
  tipo: 'chat.mensaje';
  datos: MensajeDeChat;
}

/** Aviso privado a quien el anfitrión sacó de la sala (fase 7). Tampoco lleva `seq`. */
export interface MensajeExpulsado {
  v: number;
  tipo: 'sala.expulsado';
  datos: { codigo: string };
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

export type MensajeServidor = MensajeOk | MensajeError | MensajeEvento | MensajeFoto | MensajeChat | MensajeExpulsado;

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
