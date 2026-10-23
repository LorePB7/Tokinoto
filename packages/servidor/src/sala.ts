/**
 * Una sala de Tokinoto: lobby, juego en memoria y cola de acciones.
 *
 * Principios (docs/diseno-tecnico.md, 3.2):
 *  - Servidor autoritativo: el cliente manda intenciones; la sala decide con
 *    el motor de reglas. El jugador se identifica por su conexión, nunca por
 *    lo que diga el mensaje.
 *  - Una sala = un estado = una cola: todas las tareas (comandos, avances
 *    programados, desconexiones) se procesan de a una y en orden.
 *  - Eventos numerados (`seq`) y guardados en un registro.
 *  - El tiempo lo maneja el servidor: las pausas entre bazas y partidas, el
 *    tiempo límite de cada jugada y el piloto automático se programan con un
 *    reloj inyectable.
 *  - Ausencias (DP-12 a DP-14): el asiento nunca se elimina. Si un jugador se
 *    desconecta, abandona o deja vencer su tiempo 3 veces seguidas, el piloto
 *    automático juega por él. Con su token puede volver y recuperar el control.
 *
 * La sala no sabe nada de Socket.IO: recibe un `Destino` por jugador, al que
 * le entrega mensajes. Así se puede probar sin red.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  botChoice,
  createCryptoRng,
  createGame,
  currentTurn,
  decide,
  evolve,
  type Action,
  type GameState,
  type Rng,
} from '@tokinoto/reglas';
import {
  LIMITE_CHAT,
  MENSAJES_DE_CHAT_GUARDADOS,
  TIEMPO_TURNO_POR_DEFECTO_S,
  VENCIMIENTOS_PARA_PILOTO,
  VERSION_PROTOCOLO,
  desdeMotor,
  error,
  mensajeError,
  proyectarJuego,
  respuestaError,
  respuestaOk,
  type ComandoDeSala,
  type DatosEventos,
  type ErrorServidor,
  type EstadoSala,
  type MensajeDeChat,
  type MensajeEvento,
  type MensajeFoto,
  type MensajeServidor,
  type MotivoPiloto,
  type NivelBot,
  type Respuesta,
  type TipoEvento,
  type VistaSala,
} from '@tokinoto/protocolo';
import { eventoDeTurno, traducirEvento, type EventoSalida } from './eventos';
import type { Historial } from './guardador';
import { Limitador } from './limitador';
import { relojReal, type Reloj } from './reloj';

/** A dónde se le envían los mensajes a un jugador (su conexión). */
export interface Destino {
  enviar(mensaje: MensajeServidor): void;
  /** El anfitrión sacó al jugador de la sala (fase 7): la conexión deja de estar en ella. */
  alExpulsar?(): void;
}

export interface OpcionesSala {
  /** Cupo de la sala: de 4 a 7. Las salas del servidor usan siempre 7 (DP-11); las pruebas pueden usar menos. */
  maxJugadores: number;
  /** Tiempo que la baza resuelta queda a la vista antes de seguir (DP-23: ~3 s). */
  pausaBazaMs: number;
  /** Tiempo del resumen entre partidas (DP-23: ~10 s), salvo que el anfitrión pause. */
  pausaResumenMs: number;
  /** Tiempo por apuesta y por tirada (DP-13: 30 s). null = sin límite. */
  tiempoTurnoMs: number | null;
  /** Cuánto espera el piloto automático antes de jugar, para que la mesa se pueda seguir. */
  pausaPilotoMs: number;
  /** Cuánto espera un bot antes de jugar (fase 8), para que la mesa se siga a simple vista. */
  pausaBotMs: number;
  /** Si no queda nadie conectado con el juego en curso, cuánto se espera antes de abortarlo (DP-12). */
  esperaAbortoMs: number;
  /** En el lobby, cuánto se guarda el lugar de quien se desconecta (por ejemplo, al recargar la página). */
  graciaLobbyMs: number;
  reloj: Reloj;
  /** Fuente de azar de cada juego. Por defecto, criptográficamente segura. */
  crearAzar: () => Rng;
  /** Qué hacer ante un error inesperado del servidor (no de un jugador). */
  alError: (problema: unknown) => void;
  /** Dónde se guarda el historial de los juegos (DP-21). null = no se guarda. */
  historial: Historial | null;
}

export const OPCIONES_SALA_POR_DEFECTO: OpcionesSala = {
  maxJugadores: 7,
  pausaBazaMs: 3000,
  pausaResumenMs: 10000,
  tiempoTurnoMs: TIEMPO_TURNO_POR_DEFECTO_S * 1000,
  pausaPilotoMs: 1000,
  pausaBotMs: 1000,
  esperaAbortoMs: 3 * 60 * 1000,
  graciaLobbyMs: 15000,
  reloj: relojReal,
  crearAzar: createCryptoRng,
  alError: (problema) => console.error('[sala] error inesperado:', problema),
  historial: null,
};

/** Evento guardado en el registro de la sala, con su número. */
export type RegistroEvento = EventoSalida & { seq: number };

/** Con qué identidad entró un jugador (fase 6): se guarda en el historial. */
export interface PerfilJugador {
  cuentaId: string | null;
  invitado: boolean;
  /**
   * Clave de la persona (`g:<cuentaId>` o `i:<idInvitado>`). Con ella se
   * bloquea a quien el anfitrión expulsa (fase 7). null en algunas pruebas.
   */
  clave?: string | null;
}

interface Jugador {
  id: string;
  nombre: string;
  perfil: PerfilJugador;
  /** Secreto para recuperar el asiento al reconectar. Empieza con el código de la sala. */
  token: string;
  conectado: boolean;
  destino: Destino | null;
  /** Si el piloto automático juega por él, y por qué. */
  piloto: MotivoPiloto | null;
  /** Turnos seguidos en los que se le venció el tiempo. */
  vencimientos: number;
  /** En el lobby: quitarlo si no vuelve a tiempo. */
  cancelarSalida: (() => void) | null;
  /** Respuestas ya dadas, por idPedido: un reintento no se ejecuta dos veces. */
  pedidos: Map<string, Respuesta>;
  /** Ritmo de sus mensajes de chat (DP-22). */
  chat: Limitador;
  /**
   * Bot del servidor (fase 8): su nivel, o null si es una persona. Un bot no
   * tiene conexión ni sesión, no usa tiempo límite ni piloto automático, y no
   * cuenta como "alguien conectado": sin personas, la mesa se detiene y se aborta.
   */
  bot: NivelBot | null;
}

/** Cuántas respuestas recuerda la sala por jugador para la idempotencia. */
export const PEDIDOS_RECORDADOS = 64;

function normalizarNombre(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}

/** Compara tokens sin filtrar información por el tiempo que tarda. */
function mismoToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const MOTIVO_ABORTO_SIN_JUGADORES = 'No quedó ningún jugador conectado';

export class Sala {
  readonly codigo: string;
  private readonly opciones: OpcionesSala;
  private readonly alVaciarse: (sala: Sala) => void;

  private jugadores: Jugador[] = [];
  private anfitrion: string | null = null;
  private juego: GameState | null = null;
  private azar: Rng | null = null;
  /** Azar de los bots (separado del reparto). */
  private azarBots: Rng | null = null;
  private resumenPausado = false;
  /** Identificador del juego en el historial, y cuántos eventos del motor lleva. */
  private juegoId: string | null = null;
  private eventosDelMotor = 0;

  private seq = 0;
  private readonly registro: RegistroEvento[] = [];

  /** Chat de la sala (DP-22): solo en memoria, se pierde al cerrarse la sala. */
  private chat: MensajeDeChat[] = [];
  private ultimoChat = 0;
  /** Expulsados (fase 7): por clave de persona, para que no vuelvan a entrar, y por token, para avisarles al reconectar. */
  private readonly bloqueados = new Set<string>();
  private readonly tokensExpulsados = new Set<string>();

  private readonly cola: (() => void)[] = [];
  private ocupada = false;
  private salida: { destino: Destino; mensaje: MensajeServidor }[] = [];

  private cancelarAvance: (() => void) | null = null;
  private cancelarTurnoProgramado: (() => void) | null = null;
  private cancelarAborto: (() => void) | null = null;
  /** Cambia con cada turno: invalida temporizadores de turnos anteriores. */
  private numeroTurno = 0;
  /** Hora límite del turno en curso (null si no hay o si no tiene límite). */
  private fechaLimite: number | null = null;
  /** Cambia con cada juego nuevo: invalida avances programados del juego anterior. */
  private generacion = 0;
  private cerrada = false;

  constructor(codigo: string, opciones: Partial<OpcionesSala> = {}, alVaciarse: (sala: Sala) => void = () => {}) {
    this.codigo = codigo;
    this.opciones = { ...OPCIONES_SALA_POR_DEFECTO, ...opciones };
    this.alVaciarse = alVaciarse;
    const cupo = this.opciones.maxJugadores;
    if (!Number.isInteger(cupo) || cupo < 4 || cupo > 7) {
      throw new Error(`El cupo de la sala debe ser de 4 a 7 jugadores (recibí ${cupo})`);
    }
  }

  // -------------------------------------------------------------------------
  // Consultas (para el gestor y las pruebas)
  // -------------------------------------------------------------------------

  get estado(): EstadoSala {
    if (!this.juego) return 'ESPERANDO';
    return this.juego.phase === 'FINISHED' || this.juego.phase === 'ABORTED' ? 'TERMINADO' : 'JUGANDO';
  }

  get estaCerrada(): boolean {
    return this.cerrada;
  }

  get idAnfitrion(): string | null {
    return this.anfitrion;
  }

  get cantidadJugadores(): number {
    return this.jugadores.length;
  }

  get ultimoSeq(): number {
    return this.seq;
  }

  /** Estado completo del juego. PRIVADO: nunca se envía tal cual a un cliente. */
  get estadoDelJuego(): GameState | null {
    return this.juego;
  }

  get eventos(): readonly RegistroEvento[] {
    return this.registro;
  }

  get resumenEnPausa(): boolean {
    return this.resumenPausado;
  }

  // -------------------------------------------------------------------------
  // Entradas: todas pasan por la cola
  // -------------------------------------------------------------------------

  /** Agrega un jugador al lobby. Responde con el código, su id y su token secreto. */
  unirse(
    nombre: string,
    destino: Destino,
    responder: (respuesta: Respuesta) => void,
    perfil: PerfilJugador = { cuentaId: null, invitado: false },
  ): void {
    this.encolar(() => {
      const respuesta = this.intentar(() => this.agregarJugador(nombre, destino, perfil));
      responder(respuesta);
      if (respuesta.ok) {
        const jugador = this.buscar(respuesta.datos['idJugador'] as string);
        if (jugador) this.enviarA(jugador, this.foto(jugador));
      }
    });
  }

  /** Ejecuta un comando de un jugador de la sala. */
  comando(
    idJugador: string,
    idPedido: string,
    comando: ComandoDeSala,
    responder: (respuesta: Respuesta) => void,
    destino?: Destino,
  ): void {
    this.encolar(() => {
      const jugador = this.buscar(idJugador);
      if (!jugador) {
        responder(respuestaError('NO_PERTENECE_A_SALA', 'No formás parte de esta sala'));
        return;
      }
      if (destino !== undefined && jugador.destino !== destino) {
        responder(respuestaError('SESION_REEMPLAZADA', 'Entraste a esta sala desde otra pestaña'));
        return;
      }
      const anterior = jugador.pedidos.get(idPedido);
      if (anterior) {
        responder(anterior);
        return;
      }
      const respuesta = this.intentar(() => this.ejecutar(jugador, comando));
      jugador.pedidos.set(idPedido, respuesta);
      if (jugador.pedidos.size > PEDIDOS_RECORDADOS) {
        const masViejo = jugador.pedidos.keys().next().value;
        if (masViejo !== undefined) jugador.pedidos.delete(masViejo);
      }
      responder(respuesta);
    });
  }

  /**
   * Un jugador vuelve con su token (DP-14): recupera su asiento, recibe la
   * foto completa y, si el piloto automático jugaba por él, retoma el control.
   * Si estaba conectado desde otra pestaña, esa conexión queda reemplazada.
   */
  /** Dice si el token tiene un lugar en esta sala con el juego sin terminar (para "volver a tu partida"). */
  consultar(token: string, responder: (respuesta: Respuesta) => void): void {
    this.encolar(() => {
      const jugador = this.cerrada ? undefined : this.jugadores.find((j) => mismoToken(j.token, token));
      const vigente = Boolean(jugador) && this.estado !== 'TERMINADO';
      responder(respuestaOk(vigente ? { vigente, codigo: this.codigo, estado: this.estado } : { vigente }));
    });
  }

  /**
   * ¿Ese token ocupa todavía un lugar que impide entrar a otra sala? Sí, salvo
   * que la sala esté cerrada o terminada, o que el jugador haya abandonado el
   * juego a propósito (el piloto sigue por él). Lectura directa, sin la cola.
   */
  ocupaLugar(token: string): boolean {
    if (this.cerrada || this.estado === 'TERMINADO') return false;
    const jugador = this.jugadores.find((j) => mismoToken(j.token, token));
    return jugador !== undefined && jugador.piloto !== 'abandono';
  }

  /** ¿Ese token sigue teniendo asiento en la sala (aunque el juego haya terminado)? */
  tieneAsiento(token: string): boolean {
    return !this.cerrada && this.jugadores.some((j) => mismoToken(j.token, token));
  }

  reconectar(token: string, destino: Destino, responder: (respuesta: Respuesta) => void): void {
    this.encolar(() => {
      const jugador = this.cerrada ? undefined : this.jugadores.find((j) => mismoToken(j.token, token));
      if (!jugador) {
        responder(
          !this.cerrada && this.tokensExpulsados.has(token)
            ? respuestaError('EXPULSADO', 'El anfitrión te sacó de esta sala')
            : respuestaError('SESION_INVALIDA', 'Tu lugar en esa sala ya no existe'),
        );
        return;
      }
      const anterior = jugador.destino;
      if (anterior && anterior !== destino) {
        this.salida.push({
          destino: anterior,
          mensaje: mensajeError(null, error('SESION_REEMPLAZADA', 'Entraste a esta sala desde otra pestaña')),
        });
      }
      jugador.destino = destino;
      jugador.cancelarSalida?.();
      jugador.cancelarSalida = null;
      const volvio = !jugador.conectado;
      const nadieHabia = !this.hayConectados();
      jugador.conectado = true;
      this.cancelarAbortoProgramado();
      responder(respuestaOk({ codigo: this.codigo, idJugador: jugador.id, token: jugador.token }));

      // Los demás se enteran por eventos; él, por la foto (que ya los incluye).
      if (volvio) {
        this.emitir('jugador.conexion', { idJugador: jugador.id, asiento: this.asientoDe(jugador), conectado: true }, jugador.id);
      }
      const teniaPiloto = jugador.piloto !== null;
      if (teniaPiloto) this.cambiarPiloto(jugador, null, jugador.id, false);
      if (this.anfitrion === null) this.cambiarAnfitrion(jugador, jugador.id);
      this.enviarA(jugador, this.foto(jugador));

      // Si le tocaba (o la mesa estaba parada porque no había nadie), el turno arranca de nuevo.
      if ((teniaPiloto && this.esSuTurno(jugador)) || nadieHabia) this.reiniciarTurnoSiHay();
    });
  }

  /** La conexión del jugador se cortó. Si se indica `destino`, solo cuenta si es su conexión actual. */
  desconectar(idJugador: string, destino?: Destino): void {
    this.encolar(() => {
      const jugador = this.buscar(idJugador);
      if (!jugador || (destino !== undefined && jugador.destino !== destino)) return;
      if (this.juego) this.marcarDesconectado(jugador, 'desconexion');
      else this.desconectarEnLobby(jugador);
    });
  }

  /** Mensajes de chat guardados (para las pruebas). */
  get mensajesDeChat(): readonly MensajeDeChat[] {
    return this.chat;
  }

  /** Cierra la sala: cancela lo programado, deja de enviar mensajes y borra el chat (DP-22). */
  cerrar(): void {
    this.cerrada = true;
    this.chat = [];
    this.cancelarAvanceProgramado();
    this.cancelarTurno();
    this.cancelarAbortoProgramado();
    for (const jugador of this.jugadores) {
      jugador.destino = null;
      jugador.cancelarSalida?.();
      jugador.cancelarSalida = null;
    }
  }

  // -------------------------------------------------------------------------
  // Cola de tareas
  // -------------------------------------------------------------------------

  private encolar(tarea: () => void): void {
    this.cola.push(tarea);
    if (this.ocupada) return;
    this.ocupada = true;
    try {
      for (let siguiente = this.cola.shift(); siguiente; siguiente = this.cola.shift()) {
        try {
          siguiente();
        } catch (problema) {
          this.opciones.alError(problema);
        }
        this.vaciarSalida();
      }
    } finally {
      this.ocupada = false;
    }
  }

  private vaciarSalida(): void {
    const pendientes = this.salida;
    this.salida = [];
    for (const { destino, mensaje } of pendientes) {
      try {
        destino.enviar(mensaje);
      } catch (problema) {
        this.opciones.alError(problema);
      }
    }
  }

  /** Ejecuta una acción y convierte errores inesperados en ERROR_INTERNO. */
  private intentar(accion: () => Respuesta): Respuesta {
    try {
      return accion();
    } catch (problema) {
      this.opciones.alError(problema);
      return respuestaError('ERROR_INTERNO', 'Ocurrió un error inesperado en el servidor');
    }
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  private agregarJugador(nombre: string, destino: Destino, perfil: PerfilJugador): Respuesta {
    if (this.cerrada) return respuestaError('SALA_NO_EXISTE', 'La sala ya no existe');
    if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'El juego de esta sala ya empezó');
    if (this.jugadores.length >= this.opciones.maxJugadores) {
      return respuestaError('SALA_LLENA', `La sala está completa (${this.opciones.maxJugadores} jugadores)`);
    }
    if (perfil.clave && this.bloqueados.has(perfil.clave)) {
      return respuestaError('EXPULSADO', 'El anfitrión te sacó de esta sala: no podés volver a entrar');
    }
    const nombreLimpio = nombre.trim();
    if (this.jugadores.some((j) => normalizarNombre(j.nombre) === normalizarNombre(nombreLimpio))) {
      return respuestaError('NOMBRE_EN_USO', `Ya hay un jugador llamado "${nombreLimpio}" en la sala`);
    }

    const jugador: Jugador = {
      id: randomUUID(),
      nombre: nombreLimpio,
      perfil: { ...perfil },
      token: `${this.codigo}.${randomBytes(24).toString('base64url')}`,
      conectado: true,
      destino,
      piloto: null,
      vencimientos: 0,
      cancelarSalida: null,
      pedidos: new Map(),
      chat: new Limitador(LIMITE_CHAT, () => this.opciones.reloj.ahora()),
      bot: null,
    };
    this.jugadores.push(jugador);
    if (this.anfitrion === null) this.anfitrion = jugador.id;

    // Los demás reciben el evento; el que entra recibe una foto (que ya lo incluye).
    this.emitir('sala.jugadorEntro', { idJugador: jugador.id, nombre: jugador.nombre }, jugador.id);
    return respuestaOk({ codigo: this.codigo, idJugador: jugador.id, token: jugador.token });
  }

  private quitarDelLobby(jugador: Jugador, expulsado = false): void {
    jugador.cancelarSalida?.();
    jugador.cancelarSalida = null;
    this.jugadores = this.jugadores.filter((j) => j !== jugador);
    jugador.destino = null;
    this.emitir('sala.jugadorSalio', expulsado ? { idJugador: jugador.id, expulsado } : { idJugador: jugador.id });
    if (this.anfitrion === jugador.id) {
      const personas = this.jugadores.filter((j) => j.bot === null);
      this.cambiarAnfitrion(personas.find((j) => j.conectado) ?? personas[0] ?? null);
    }
    // Una sala sin personas se cierra, aunque queden bots (fase 8).
    if (!this.jugadores.some((j) => j.bot === null)) this.vaciar();
  }

  /**
   * En el lobby, quien se desconecta conserva su lugar un rato (por si recarga
   * la página). Si no vuelve a tiempo, sale de la sala.
   */
  private desconectarEnLobby(jugador: Jugador): void {
    const gracia = this.opciones.graciaLobbyMs;
    if (gracia <= 0) {
      this.quitarDelLobby(jugador);
      return;
    }
    if (!jugador.conectado) return;
    jugador.conectado = false;
    jugador.destino = null;
    this.emitir('jugador.conexion', { idJugador: jugador.id, asiento: this.asientoDe(jugador), conectado: false });
    jugador.cancelarSalida = this.opciones.reloj.programar(gracia, () => {
      this.encolar(() => {
        jugador.cancelarSalida = null;
        if (this.cerrada || this.juego || jugador.conectado || !this.jugadores.includes(jugador)) return;
        this.quitarDelLobby(jugador);
      });
    });
  }

  /**
   * Con el juego empezado, el asiento se conserva. Si el juego sigue en curso,
   * el piloto automático juega por él (DP-12). `abandono` es salir a propósito.
   */
  private marcarDesconectado(jugador: Jugador, motivo: 'desconexion' | 'abandono'): void {
    if (!jugador.conectado && motivo === 'desconexion') return;
    if (jugador.conectado) {
      jugador.conectado = false;
      jugador.destino = null;
      this.emitir('jugador.conexion', { idJugador: jugador.id, asiento: this.asientoDe(jugador), conectado: false });
    }
    jugador.destino = null;
    if (this.anfitrion === jugador.id) {
      this.cambiarAnfitrion(this.jugadores.find((j) => j.conectado && j.bot === null) ?? null);
    }
    if (this.juegoEnCurso) this.cambiarPiloto(jugador, motivo);
    if (!this.hayConectados()) {
      // Nadie puede ver la mesa: el piloto no juega y, si nadie vuelve, se aborta (DP-12).
      if (this.juegoEnCurso) this.programarAborto();
      else this.vaciar();
    }
  }

  private cambiarAnfitrion(nuevo: Jugador | null, excluir?: string): void {
    this.anfitrion = nuevo?.id ?? null;
    if (nuevo) this.emitir('sala.anfitrionCambio', { anfitrion: nuevo.id }, excluir);
  }

  private asientoDe(jugador: Jugador): number {
    return this.jugadores.indexOf(jugador);
  }

  /** ¿Hay alguna PERSONA conectada? Los bots no cuentan (fase 8). */
  private hayConectados(): boolean {
    return this.jugadores.some((j) => j.conectado && j.bot === null);
  }

  private get juegoEnCurso(): boolean {
    return this.juego !== null && this.juego.phase !== 'FINISHED' && this.juego.phase !== 'ABORTED';
  }

  private esSuTurno(jugador: Jugador): boolean {
    if (!this.juego) return false;
    const turno = currentTurn(this.juego);
    return turno !== null && this.juego.players[turno.seat]?.id === jugador.id;
  }

  // -------------------------------------------------------------------------
  // Piloto automático y tiempo límite (DP-12, DP-12b, DP-13)
  // -------------------------------------------------------------------------

  /**
   * Activa (con un motivo) o desactiva (con null) el piloto de un jugador y lo
   * avisa. Si le toca a él, el turno arranca de nuevo con el control que corresponda.
   */
  private cambiarPiloto(jugador: Jugador, motivo: MotivoPiloto | null, excluir?: string, reiniciar = true): void {
    if (jugador.piloto === motivo) return;
    jugador.piloto = motivo;
    if (motivo === null) jugador.vencimientos = 0;
    this.emitir(
      'jugador.pilotoAutomatico',
      { idJugador: jugador.id, asiento: this.asientoDe(jugador), activado: motivo !== null, motivo },
      excluir,
    );
    if (reiniciar && this.esSuTurno(jugador)) this.reiniciarTurnoSiHay();
  }

  private reiniciarTurnoSiHay(): void {
    const fase = this.juego?.phase;
    if (fase === 'BETTING' || fase === 'PLAYING') this.iniciarTurno();
  }

  /**
   * Avisa de quién es el turno y programa lo que corresponda: el tiempo límite
   * si juega una persona, o la jugada del piloto si no.
   */
  private iniciarTurno(): void {
    this.cancelarTurno();
    const juego = this.juego;
    if (!juego) return;
    const turno = currentTurn(juego);
    if (!turno) return;
    const jugador = this.buscar(juego.players[turno.seat]?.id ?? '');
    if (!jugador) throw new Error(`No hay jugador en el asiento ${turno.seat}`);
    const numero = ++this.numeroTurno;

    const nivel = jugador.bot;
    if (nivel) {
      this.emitirSalida(eventoDeTurno(juego, turno, null));
      // Sin personas conectadas la mesa no sigue: los bots solos no terminan el juego.
      if (this.hayConectados()) {
        this.programarTurno(this.opciones.pausaBotMs, numero, () => this.jugarBot(jugador, nivel));
      }
      return;
    }

    if (jugador.piloto) {
      this.emitirSalida(eventoDeTurno(juego, turno, null));
      // Sin nadie conectado, la mesa espera (y, si nadie vuelve, se aborta).
      if (this.hayConectados()) {
        this.programarTurno(this.opciones.pausaPilotoMs, numero, () =>
          this.aplicarDelServidor({ type: 'PILOTO_AUTOMATICO', playerId: jugador.id }),
        );
      }
      return;
    }

    const tiempo = this.opciones.tiempoTurnoMs;
    this.fechaLimite = tiempo === null ? null : this.opciones.reloj.ahora() + tiempo;
    this.emitirSalida(eventoDeTurno(juego, turno, this.fechaLimite));
    if (tiempo !== null) this.programarTurno(tiempo, numero, () => this.vencerTurno(jugador));
  }

  /**
   * Juega un bot (fase 8). Decide con `botChoice`, que solo mira su mano y lo
   * público. Si por un error la jugada no fuera válida, juega el piloto.
   */
  private jugarBot(jugador: Jugador, nivel: NivelBot): void {
    const juego = this.juego;
    const turno = juego ? currentTurn(juego) : null;
    if (!juego || !turno || juego.players[turno.seat]?.id !== jugador.id) return;
    // Si la última persona se fue mientras el bot "pensaba", espera a que alguien vuelva.
    if (!this.hayConectados()) return;
    const azar = (this.azarBots ??= this.opciones.crearAzar());
    const eleccion = botChoice(juego, turno.seat, nivel, azar);
    const accion: Action | null =
      eleccion?.type === 'APOSTAR'
        ? { type: 'APOSTAR', playerId: jugador.id, value: eleccion.value }
        : eleccion?.type === 'JUGAR_CARTA'
          ? { type: 'JUGAR_CARTA', playerId: jugador.id, cardId: eleccion.cardId }
          : null;
    const problema = accion ? this.aplicar(accion) : error('ERROR_INTERNO', 'El bot no decidió');
    if (problema) {
      this.opciones.alError(new Error(`El bot ${jugador.nombre} no pudo jugar: ${problema.codigo} ${problema.mensaje}`));
      this.aplicarDelServidor({ type: 'PILOTO_AUTOMATICO', playerId: jugador.id });
    }
  }

  /** Se le venció el tiempo: el piloto juega esta vez; tras 3 seguidas, toma el asiento. */
  private vencerTurno(jugador: Jugador): void {
    jugador.vencimientos++;
    if (jugador.vencimientos >= VENCIMIENTOS_PARA_PILOTO) this.cambiarPiloto(jugador, 'tiempo', undefined, false);
    this.aplicarDelServidor({ type: 'PILOTO_AUTOMATICO', playerId: jugador.id });
  }

  private programarTurno(ms: number, numero: number, tarea: () => void): void {
    this.cancelarTurnoProgramado = this.opciones.reloj.programar(ms, () => {
      this.encolar(() => {
        if (this.cerrada || numero !== this.numeroTurno) return;
        this.cancelarTurnoProgramado = null;
        tarea();
      });
    });
  }

  private cancelarTurno(): void {
    this.cancelarTurnoProgramado?.();
    this.cancelarTurnoProgramado = null;
    this.fechaLimite = null;
  }

  private programarAborto(): void {
    if (this.cancelarAborto) return;
    this.cancelarAborto = this.opciones.reloj.programar(this.opciones.esperaAbortoMs, () => {
      this.encolar(() => {
        this.cancelarAborto = null;
        if (this.cerrada || this.hayConectados()) return;
        if (this.juegoEnCurso) {
          this.cancelarAvanceProgramado();
          this.cancelarTurno();
          this.aplicarDelServidor({ type: 'ABORTAR_JUEGO', reason: MOTIVO_ABORTO_SIN_JUGADORES });
        }
        this.vaciar();
      });
    });
  }

  private cancelarAbortoProgramado(): void {
    this.cancelarAborto?.();
    this.cancelarAborto = null;
  }

  private vaciar(): void {
    if (this.cerrada) return;
    this.cerrar();
    this.alVaciarse(this);
  }

  // -------------------------------------------------------------------------
  // Comandos
  // -------------------------------------------------------------------------

  private ejecutar(jugador: Jugador, comando: ComandoDeSala): Respuesta {
    switch (comando.tipo) {
      case 'sala.salir':
        // Con el juego en curso, el asiento queda y el piloto automático juega por él.
        if (this.juego) this.marcarDesconectado(jugador, this.juegoEnCurso ? 'abandono' : 'desconexion');
        else this.quitarDelLobby(jugador);
        return respuestaOk();

      case 'sala.expulsar':
        return this.expulsar(jugador, comando.datos.idJugador);

      case 'chat.enviar':
        return this.enviarChat(jugador, comando.datos.texto);

      case 'sala.agregarBot':
        return this.agregarBot(jugador, comando.datos.nivel);

      case 'sala.quitarBot':
        return this.quitarBot(jugador, comando.datos.idJugador);

      case 'juego.retomarControl':
        if (!this.juegoEnCurso) return respuestaError('ESTADO_INVALIDO', 'No hay un juego en curso');
        this.cambiarPiloto(jugador, null);
        return respuestaOk();

      case 'sala.iniciar': {
        const noAnfitrion = this.exigirAnfitrion(jugador);
        if (noAnfitrion) return noAnfitrion;
        if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'El juego ya empezó');
        return this.empezarJuego();
      }

      case 'sala.configurar': {
        const noAnfitrion = this.exigirAnfitrion(jugador);
        if (noAnfitrion) return noAnfitrion;
        if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'El tiempo por jugada se elige antes de empezar');
        const tiempo = comando.datos.tiempoTurno;
        const ms = tiempo === null ? null : tiempo * 1000;
        if (ms !== this.opciones.tiempoTurnoMs) {
          this.opciones.tiempoTurnoMs = ms;
          this.emitir('sala.configuracion', { tiempoTurnoMs: ms });
        }
        return respuestaOk();
      }

      case 'sala.pausarResumen': {
        const noAnfitrion = this.exigirAnfitrion(jugador);
        if (noAnfitrion) return noAnfitrion;
        if (!this.juego) return respuestaError('JUEGO_NO_INICIADO', 'El juego todavía no empezó');
        const pausar = comando.datos.pausar;
        if (pausar !== this.resumenPausado) {
          this.resumenPausado = pausar;
          this.emitir('sala.resumenPausado', { pausado: pausar });
          if (this.juego.phase === 'ROUND_SUMMARY') {
            if (pausar) this.cancelarAvanceProgramado();
            else this.programarAvance(this.opciones.pausaResumenMs);
          }
        }
        return respuestaOk();
      }

      case 'juego.apostar':
        return this.accionDeJugador(jugador, { type: 'APOSTAR', playerId: jugador.id, value: comando.datos.valor });

      case 'juego.jugarCarta':
        return this.accionDeJugador(jugador, { type: 'JUGAR_CARTA', playerId: jugador.id, cardId: comando.datos.idCarta });

      case 'sync.pedir':
        // La respuesta llega primero; enseguida, la foto completa.
        this.enviarA(jugador, this.foto(jugador));
        return respuestaOk();

      case 'juego.revancha': {
        const noAnfitrion = this.exigirAnfitrion(jugador);
        if (noAnfitrion) return noAnfitrion;
        if (!this.juego) return respuestaError('JUEGO_NO_INICIADO', 'El juego todavía no empezó');
        if (this.juego.phase !== 'FINISHED') {
          return respuestaError('ESTADO_INVALIDO', 'La revancha se puede pedir cuando termina el juego');
        }
        return this.empezarJuego();
      }

      default: {
        const imposible: never = comando;
        throw new Error(`Comando desconocido: ${JSON.stringify(imposible)}`);
      }
    }
  }

  /**
   * El anfitrión saca a alguien de la sala de espera (fase 7). La persona queda
   * bloqueada en esta sala mientras exista: no puede volver a entrar.
   */
  private expulsar(anfitrion: Jugador, idJugador: string): Respuesta {
    const noAnfitrion = this.exigirAnfitrion(anfitrion);
    if (noAnfitrion) return noAnfitrion;
    if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'Solo se puede sacar a alguien antes de empezar el juego');
    const expulsado = this.buscar(idJugador);
    if (!expulsado) return respuestaError('NO_PERTENECE_A_SALA', 'Ese jugador ya no está en la sala');
    if (expulsado === anfitrion) return respuestaError('ESTADO_INVALIDO', 'No podés sacarte a vos mismo de la sala');
    // "Expulsar" a un bot es quitarlo (fase 8): no hay nadie a quien bloquear.
    if (expulsado.bot) return this.quitarBot(anfitrion, idJugador);

    if (expulsado.perfil.clave) this.bloqueados.add(expulsado.perfil.clave);
    this.tokensExpulsados.add(expulsado.token);
    const destino = expulsado.destino;
    // Primero el aviso privado (con su conexión todavía en la sala); después sale como cualquiera.
    this.enviarA(expulsado, { v: VERSION_PROTOCOLO, tipo: 'sala.expulsado', datos: { codigo: this.codigo } });
    this.quitarDelLobby(expulsado, true);
    destino?.alExpulsar?.();
    return respuestaOk();
  }

  /** El anfitrión suma un bot en la sala de espera (fase 8). Cuenta para el mínimo de 4 y el tope de 7. */
  private agregarBot(anfitrion: Jugador, nivel: NivelBot): Respuesta {
    const noAnfitrion = this.exigirAnfitrion(anfitrion);
    if (noAnfitrion) return noAnfitrion;
    if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'Los bots se agregan antes de empezar el juego');
    if (this.jugadores.length >= this.opciones.maxJugadores) {
      return respuestaError('SALA_LLENA', `La sala está completa (${this.opciones.maxJugadores} jugadores)`);
    }
    const bot = this.crearBot(nivel);
    this.jugadores.push(bot);
    this.emitir('sala.jugadorEntro', { idJugador: bot.id, nombre: bot.nombre, bot: nivel });
    return respuestaOk({ idJugador: bot.id });
  }

  /** El anfitrión saca un bot de la sala de espera (fase 8). */
  private quitarBot(anfitrion: Jugador, idJugador: string): Respuesta {
    const noAnfitrion = this.exigirAnfitrion(anfitrion);
    if (noAnfitrion) return noAnfitrion;
    if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'Los bots se quitan antes de empezar el juego');
    const bot = this.buscar(idJugador);
    if (!bot) return respuestaError('NO_PERTENECE_A_SALA', 'Ese jugador ya no está en la sala');
    if (!bot.bot) return respuestaError('ESTADO_INVALIDO', 'Ese jugador no es un bot');
    this.quitarDelLobby(bot);
    return respuestaOk();
  }

  /** Un bot nuevo: "Bot 1", "Bot 2"... con el primer número libre. Sin conexión, sesión ni cuenta. */
  private crearBot(nivel: NivelBot): Jugador {
    const usados = new Set(this.jugadores.map((j) => normalizarNombre(j.nombre)));
    let numero = 1;
    while (usados.has(normalizarNombre(`Bot ${numero}`))) numero++;
    return {
      id: randomUUID(),
      nombre: `Bot ${numero}`,
      perfil: { cuentaId: null, invitado: false, clave: null },
      // Nunca se entrega a nadie: un bot no reconecta.
      token: `${this.codigo}.${randomBytes(24).toString('base64url')}`,
      conectado: true,
      destino: null,
      piloto: null,
      vencimientos: 0,
      cancelarSalida: null,
      pedidos: new Map(),
      chat: new Limitador(LIMITE_CHAT, () => this.opciones.reloj.ahora()),
      bot: nivel,
    };
  }

  /**
   * Jugar contra bots (fase 8): suma `cantidad` bots del nivel elegido y
   * empieza el juego. Lo usa el gestor justo después de crear la sala.
   */
  iniciarContraBots(idAnfitrion: string, cantidad: number, nivel: NivelBot, responder: (respuesta: Respuesta) => void): void {
    this.encolar(() => {
      const respuesta = this.intentar(() => {
        const anfitrion = this.buscar(idAnfitrion);
        if (!anfitrion) return respuestaError('NO_PERTENECE_A_SALA', 'No formás parte de esta sala');
        for (let i = 0; i < cantidad; i++) {
          const sumado = this.agregarBot(anfitrion, nivel);
          if (!sumado.ok) return sumado;
        }
        return this.empezarJuego();
      });
      responder(respuesta);
    });
  }

  /** Mensaje de chat para toda la sala (DP-22). Fuera de la secuencia de eventos y sin guardarse en la base. */
  private enviarChat(jugador: Jugador, texto: string): Respuesta {
    if (!jugador.chat.tomar()) {
      return respuestaError('DEMASIADOS_MENSAJES', 'Esperá un momento antes de mandar otro mensaje');
    }
    const mensaje: MensajeDeChat = {
      id: ++this.ultimoChat,
      idJugador: jugador.id,
      nombre: jugador.nombre,
      texto,
      hora: this.opciones.reloj.ahora(),
    };
    this.chat.push(mensaje);
    if (this.chat.length > MENSAJES_DE_CHAT_GUARDADOS) this.chat = this.chat.slice(-MENSAJES_DE_CHAT_GUARDADOS);
    for (const destinatario of this.jugadores) {
      this.enviarA(destinatario, { v: VERSION_PROTOCOLO, tipo: 'chat.mensaje', datos: { ...mensaje } });
    }
    return respuestaOk({ id: mensaje.id });
  }

  private exigirAnfitrion(jugador: Jugador): Respuesta | null {
    return this.anfitrion === jugador.id
      ? null
      : respuestaError('NO_ES_ANFITRION', 'Solo el anfitrión de la sala puede hacer esto');
  }

  private accionDeJugador(jugador: Jugador, accion: Action): Respuesta {
    if (!this.juego) return respuestaError('JUEGO_NO_INICIADO', 'El juego todavía no empezó');
    const problema = this.aplicar(accion);
    if (problema) return { ok: false, error: problema };
    // Jugó a tiempo: se reinicia la cuenta de vencimientos y, si el piloto lo cubría, retoma el control.
    jugador.vencimientos = 0;
    if (jugador.piloto && jugador.conectado) this.cambiarPiloto(jugador, null);
    return respuestaOk();
  }

  // -------------------------------------------------------------------------
  // Juego
  // -------------------------------------------------------------------------

  /** Empieza un juego nuevo con los jugadores de la sala (también para la revancha). */
  private empezarJuego(): Respuesta {
    const creado = createGame(this.jugadores.map((j) => ({ id: j.id, name: j.nombre })));
    if (!creado.ok) {
      const { codigo, mensaje } = desdeMotor(creado.error.code, creado.error.message);
      return respuestaError(codigo, mensaje);
    }
    this.cancelarAvanceProgramado();
    this.generacion++;
    if (this.resumenPausado) {
      // Cada juego empieza sin pausa; se avisa para que los clientes lo sepan.
      this.resumenPausado = false;
      this.emitir('sala.resumenPausado', { pausado: false });
    }
    // Cada juego empieza sin vencimientos; el piloto sigue solo para quien no está conectado.
    for (const jugador of this.jugadores) {
      jugador.vencimientos = 0;
      const motivo = jugador.conectado ? null : (jugador.piloto ?? 'desconexion');
      if (jugador.piloto !== motivo) {
        jugador.piloto = motivo;
        this.emitir('jugador.pilotoAutomatico', {
          idJugador: jugador.id,
          asiento: this.asientoDe(jugador),
          activado: motivo !== null,
          motivo,
        });
      }
    }
    this.juego = creado.value;
    this.azar = this.opciones.crearAzar();
    this.azarBots = this.opciones.crearAzar();
    // Un juego con bots se guarda solo si alguna persona entró con su cuenta:
    // de los invitados no se guarda nada (fase 8).
    const conBots = this.jugadores.some((j) => j.bot !== null);
    const conCuenta = this.jugadores.some((j) => j.bot === null && j.perfil.cuentaId !== null);
    const juegoId = conBots && !conCuenta ? null : randomUUID();
    this.juegoId = juegoId;
    this.eventosDelMotor = 0;
    if (juegoId) this.guardar(() =>
      this.opciones.historial?.juegoNuevo({
        id: juegoId,
        sala: this.codigo,
        jugadores: creado.value.players.map((j) => {
          const jugador = this.buscar(j.id);
          const perfil = jugador?.perfil;
          return {
            idJugador: j.id,
            nombre: j.name,
            cuentaId: perfil?.cuentaId ?? null,
            invitado: perfil?.invitado ?? false,
            bot: jugador?.bot ?? null,
          };
        }),
        config: creado.value.config,
      }),
    );
    this.aplicarDelServidor({ type: 'INICIAR_JUEGO' });
    return respuestaOk();
  }

  /**
   * Valida la acción con el motor; si es válida, aplica cada evento, lo
   * emite traducido y sigue con lo que corresponda (turno, pausas, sorteo).
   */
  private aplicar(accion: Action): ErrorServidor | null {
    if (!this.juego || !this.azar) throw new Error('No hay un juego en curso');
    const decision = decide(this.juego, accion, this.azar);
    if (!decision.ok) return desdeMotor(decision.error.code, decision.error.message);

    for (const evento of decision.value) {
      this.juego = evolve(this.juego, evento);
      const juegoId = this.juegoId;
      if (juegoId) this.guardar(() => this.opciones.historial?.evento(juegoId, this.eventosDelMotor++, evento));
      for (const salida of traducirEvento(evento, this.juego)) this.emitirSalida(salida);
    }
    this.despuesDeCambiar();
    return null;
  }

  /** El historial nunca debe afectar al juego: cualquier falla se informa y se sigue. */
  private guardar(tarea: () => void): void {
    try {
      tarea();
    } catch (problema) {
      this.opciones.alError(problema);
    }
  }

  /** Acciones que dispara el propio servidor: si el motor las rechaza, es un error del servidor. */
  private aplicarDelServidor(accion: Action): void {
    const problema = this.aplicar(accion);
    if (problema) throw new Error(`El servidor no pudo aplicar ${accion.type}: ${problema.codigo} ${problema.mensaje}`);
  }

  private despuesDeCambiar(): void {
    const juego = this.juego;
    if (!juego) return;
    switch (juego.phase) {
      case 'DEALER_DRAW':
        this.aplicarDelServidor({ type: 'SORTEAR_REPARTIDOR' });
        return;
      case 'BETTING':
      case 'PLAYING':
        this.iniciarTurno();
        return;
      case 'TRICK_RESOLUTION':
        this.cancelarTurno();
        this.programarAvance(this.opciones.pausaBazaMs);
        return;
      case 'ROUND_SUMMARY':
        this.cancelarTurno();
        if (!this.resumenPausado) this.programarAvance(this.opciones.pausaResumenMs);
        return;
      default:
        this.cancelarTurno();
        return;
    }
  }

  private programarAvance(ms: number): void {
    this.cancelarAvanceProgramado();
    const generacion = this.generacion;
    this.cancelarAvance = this.opciones.reloj.programar(ms, () => {
      this.encolar(() => {
        if (this.cerrada || generacion !== this.generacion) return;
        this.cancelarAvance = null;
        const fase = this.juego?.phase;
        if (fase === 'TRICK_RESOLUTION' || (fase === 'ROUND_SUMMARY' && !this.resumenPausado)) {
          this.aplicarDelServidor({ type: 'AVANZAR' });
        }
      });
    });
  }

  private cancelarAvanceProgramado(): void {
    this.cancelarAvance?.();
    this.cancelarAvance = null;
  }

  // -------------------------------------------------------------------------
  // Mensajes salientes
  // -------------------------------------------------------------------------

  private buscar(idJugador: string): Jugador | undefined {
    return this.jugadores.find((j) => j.id === idJugador);
  }

  /**
   * Registra un evento con el siguiente `seq` y lo envía a los jugadores
   * conectados. Quien tenga datos privados recibe esos en lugar de los públicos.
   */
  private emitir<T extends TipoEvento>(tipo: T, datos: DatosEventos[T], excluir?: string): void {
    this.emitirSalida({ tipo, datos } as EventoSalida, excluir);
  }

  private emitirSalida(salida: EventoSalida, excluir?: string): void {
    this.seq++;
    this.registro.push({ ...salida, seq: this.seq } as RegistroEvento);
    const privados = salida.privados as Map<string, unknown> | undefined;
    for (const jugador of this.jugadores) {
      if (jugador.id === excluir) continue;
      this.enviarA(jugador, {
        v: VERSION_PROTOCOLO,
        tipo: salida.tipo,
        seq: this.seq,
        datos: privados?.get(jugador.id) ?? salida.datos,
      } as MensajeEvento);
    }
  }

  private enviarA(jugador: Jugador, mensaje: MensajeServidor): void {
    if (this.cerrada || !jugador.conectado || !jugador.destino) return;
    this.salida.push({ destino: jugador.destino, mensaje });
  }

  /** Todo lo que un jugador puede saber de la sala, con la vista del juego si hay uno. */
  vistaPara(idJugador: string): VistaSala | null {
    const jugador = this.buscar(idJugador);
    if (!jugador) return null;
    return {
      codigo: this.codigo,
      estado: this.estado,
      yo: jugador.id,
      anfitrion: this.anfitrion,
      maxJugadores: this.opciones.maxJugadores,
      tiempoTurnoMs: this.opciones.tiempoTurnoMs,
      resumenPausado: this.resumenPausado,
      jugadores: this.jugadores.map((j) => ({
        idJugador: j.id,
        nombre: j.nombre,
        conectado: j.conectado,
        piloto: j.piloto,
        bot: j.bot,
      })),
      horaServidor: this.opciones.reloj.ahora(),
      chat: this.chat.map((m) => ({ ...m })),
      juego: this.juego ? proyectarJuego(this.juego, jugador.id, this.fechaLimite) : null,
    };
  }

  /** Foto del estado para un jugador: su vista y el último `seq` que incluye. */
  private foto(jugador: Jugador): MensajeFoto {
    const vista = this.vistaPara(jugador.id);
    if (!vista) throw new Error('El jugador no está en la sala');
    return { v: VERSION_PROTOCOLO, tipo: 'estado.foto', seq: this.seq, datos: vista };
  }
}
