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
  type MensajeEvento,
  type MensajeFoto,
  type MensajeServidor,
  type MotivoPiloto,
  type Respuesta,
  type TipoEvento,
  type VistaSala,
} from '@tokinoto/protocolo';
import { eventoDeTurno, traducirEvento, type EventoSalida } from './eventos';
import { relojReal, type Reloj } from './reloj';

/** A dónde se le envían los mensajes a un jugador (su conexión). */
export interface Destino {
  enviar(mensaje: MensajeServidor): void;
}

export interface OpcionesSala {
  /** Cupo de la sala: de 4 a 7. */
  maxJugadores: number;
  /** Tiempo que la baza resuelta queda a la vista antes de seguir (DP-23: ~3 s). */
  pausaBazaMs: number;
  /** Tiempo del resumen entre partidas (DP-23: ~10 s), salvo que el anfitrión pause. */
  pausaResumenMs: number;
  /** Tiempo por apuesta y por tirada (DP-13: 30 s). null = sin límite. */
  tiempoTurnoMs: number | null;
  /** Cuánto espera el piloto automático antes de jugar, para que la mesa se pueda seguir. */
  pausaPilotoMs: number;
  /** Si no queda nadie conectado con el juego en curso, cuánto se espera antes de abortarlo (DP-12). */
  esperaAbortoMs: number;
  /** En el lobby, cuánto se guarda el lugar de quien se desconecta (por ejemplo, al recargar la página). */
  graciaLobbyMs: number;
  reloj: Reloj;
  /** Fuente de azar de cada juego. Por defecto, criptográficamente segura. */
  crearAzar: () => Rng;
  /** Qué hacer ante un error inesperado del servidor (no de un jugador). */
  alError: (problema: unknown) => void;
}

export const OPCIONES_SALA_POR_DEFECTO: OpcionesSala = {
  maxJugadores: 7,
  pausaBazaMs: 3000,
  pausaResumenMs: 10000,
  tiempoTurnoMs: TIEMPO_TURNO_POR_DEFECTO_S * 1000,
  pausaPilotoMs: 1000,
  esperaAbortoMs: 3 * 60 * 1000,
  graciaLobbyMs: 15000,
  reloj: relojReal,
  crearAzar: createCryptoRng,
  alError: (problema) => console.error('[sala] error inesperado:', problema),
};

/** Evento guardado en el registro de la sala, con su número. */
export type RegistroEvento = EventoSalida & { seq: number };

interface Jugador {
  id: string;
  nombre: string;
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
  private resumenPausado = false;

  private seq = 0;
  private readonly registro: RegistroEvento[] = [];

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
  unirse(nombre: string, destino: Destino, responder: (respuesta: Respuesta) => void): void {
    this.encolar(() => {
      const respuesta = this.intentar(() => this.agregarJugador(nombre, destino));
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
  reconectar(token: string, destino: Destino, responder: (respuesta: Respuesta) => void): void {
    this.encolar(() => {
      const jugador = this.cerrada ? undefined : this.jugadores.find((j) => mismoToken(j.token, token));
      if (!jugador) {
        responder(respuestaError('SESION_INVALIDA', 'Tu lugar en esa sala ya no existe'));
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

  /** Cierra la sala: cancela lo programado y deja de enviar mensajes. */
  cerrar(): void {
    this.cerrada = true;
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

  private agregarJugador(nombre: string, destino: Destino): Respuesta {
    if (this.cerrada) return respuestaError('SALA_NO_EXISTE', 'La sala ya no existe');
    if (this.juego) return respuestaError('JUEGO_YA_INICIADO', 'El juego de esta sala ya empezó');
    if (this.jugadores.length >= this.opciones.maxJugadores) {
      return respuestaError('SALA_LLENA', `La sala está completa (${this.opciones.maxJugadores} jugadores)`);
    }
    const nombreLimpio = nombre.trim();
    if (this.jugadores.some((j) => normalizarNombre(j.nombre) === normalizarNombre(nombreLimpio))) {
      return respuestaError('NOMBRE_EN_USO', `Ya hay un jugador llamado "${nombreLimpio}" en la sala`);
    }

    const jugador: Jugador = {
      id: randomUUID(),
      nombre: nombreLimpio,
      token: `${this.codigo}.${randomBytes(24).toString('base64url')}`,
      conectado: true,
      destino,
      piloto: null,
      vencimientos: 0,
      cancelarSalida: null,
      pedidos: new Map(),
    };
    this.jugadores.push(jugador);
    if (this.anfitrion === null) this.anfitrion = jugador.id;

    // Los demás reciben el evento; el que entra recibe una foto (que ya lo incluye).
    this.emitir('sala.jugadorEntro', { idJugador: jugador.id, nombre: jugador.nombre }, jugador.id);
    return respuestaOk({ codigo: this.codigo, idJugador: jugador.id, token: jugador.token });
  }

  private quitarDelLobby(jugador: Jugador): void {
    jugador.cancelarSalida?.();
    jugador.cancelarSalida = null;
    this.jugadores = this.jugadores.filter((j) => j !== jugador);
    jugador.destino = null;
    this.emitir('sala.jugadorSalio', { idJugador: jugador.id });
    if (this.anfitrion === jugador.id) {
      this.cambiarAnfitrion(this.jugadores.find((j) => j.conectado) ?? this.jugadores[0] ?? null);
    }
    if (this.jugadores.length === 0) this.vaciar();
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
    if (this.anfitrion === jugador.id) this.cambiarAnfitrion(this.jugadores.find((j) => j.conectado) ?? null);
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

  private hayConectados(): boolean {
    return this.jugadores.some((j) => j.conectado);
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
      for (const salida of traducirEvento(evento, this.juego)) this.emitirSalida(salida);
    }
    this.despuesDeCambiar();
    return null;
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
      })),
      horaServidor: this.opciones.reloj.ahora(),
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
