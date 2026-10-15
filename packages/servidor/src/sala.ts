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
 *  - El tiempo lo maneja el servidor: las pausas entre bazas y partidas se
 *    programan con un reloj inyectable.
 *
 * La sala no sabe nada de Socket.IO: recibe un `Destino` por jugador, al que
 * le entrega mensajes. Así se puede probar sin red.
 */
import { randomBytes, randomUUID } from 'node:crypto';
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
import { desdeMotor, type ErrorServidor } from './errores';
import { eventoDeTurno, traducirEvento } from './eventos';
import {
  VERSION_PROTOCOLO,
  respuestaError,
  respuestaOk,
  type ComandoDeSala,
  type MensajeServidor,
  type Respuesta,
  type TipoEvento,
} from './protocolo';
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
  reloj: relojReal,
  crearAzar: createCryptoRng,
  alError: (problema) => console.error('[sala] error inesperado:', problema),
};

/** ESPERANDO = lobby; JUGANDO = juego en curso; TERMINADO = juego terminado o abortado. */
export type EstadoSala = 'ESPERANDO' | 'JUGANDO' | 'TERMINADO';

export interface RegistroEvento {
  seq: number;
  tipo: TipoEvento;
  datos: Record<string, unknown>;
  privados?: Map<string, Record<string, unknown>>;
}

interface Jugador {
  id: string;
  nombre: string;
  /** Secreto para recuperar el asiento al reconectar (etapa 6). */
  token: string;
  conectado: boolean;
  destino: Destino | null;
  /** Respuestas ya dadas, por idPedido: un reintento no se ejecuta dos veces. */
  pedidos: Map<string, Respuesta>;
}

/** Cuántas respuestas recuerda la sala por jugador para la idempotencia. */
export const PEDIDOS_RECORDADOS = 64;

function normalizarNombre(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}

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
  comando(idJugador: string, idPedido: string, comando: ComandoDeSala, responder: (respuesta: Respuesta) => void): void {
    this.encolar(() => {
      const jugador = this.buscar(idJugador);
      if (!jugador) {
        responder(respuestaError('NO_PERTENECE_A_SALA', 'No formás parte de esta sala'));
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

  /** La conexión del jugador se cortó. */
  desconectar(idJugador: string): void {
    this.encolar(() => {
      const jugador = this.buscar(idJugador);
      if (!jugador) return;
      if (this.juego) this.marcarDesconectado(jugador);
      else this.quitarDelLobby(jugador);
    });
  }

  /** Cierra la sala: cancela lo programado y deja de enviar mensajes. */
  cerrar(): void {
    this.cerrada = true;
    this.cancelarAvanceProgramado();
    for (const jugador of this.jugadores) jugador.destino = null;
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
      token: randomBytes(24).toString('base64url'),
      conectado: true,
      destino,
      pedidos: new Map(),
    };
    this.jugadores.push(jugador);
    if (this.anfitrion === null) this.anfitrion = jugador.id;

    // Los demás reciben el evento; el que entra recibe una foto (que ya lo incluye).
    this.emitir('sala.jugadorEntro', { idJugador: jugador.id, nombre: jugador.nombre }, undefined, jugador.id);
    return respuestaOk({ codigo: this.codigo, idJugador: jugador.id, token: jugador.token });
  }

  private quitarDelLobby(jugador: Jugador): void {
    this.jugadores = this.jugadores.filter((j) => j !== jugador);
    jugador.destino = null;
    this.emitir('sala.jugadorSalio', { idJugador: jugador.id });
    if (this.anfitrion === jugador.id) this.cambiarAnfitrion(this.jugadores[0] ?? null);
    if (this.jugadores.length === 0) this.vaciar();
  }

  private marcarDesconectado(jugador: Jugador): void {
    if (!jugador.conectado) return;
    jugador.conectado = false;
    jugador.destino = null;
    this.emitir('jugador.conexion', {
      idJugador: jugador.id,
      asiento: this.jugadores.indexOf(jugador),
      conectado: false,
    });
    if (this.anfitrion === jugador.id) this.cambiarAnfitrion(this.jugadores.find((j) => j.conectado) ?? null);
    // Etapa 6: piloto automático y espera configurable antes de abortar.
    // Por ahora, sin nadie conectado no hay quien pueda volver: se cierra la sala.
    if (!this.jugadores.some((j) => j.conectado)) this.vaciar();
  }

  private cambiarAnfitrion(nuevo: Jugador | null): void {
    this.anfitrion = nuevo?.id ?? null;
    if (nuevo) this.emitir('sala.anfitrionCambio', { anfitrion: nuevo.id });
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
        if (this.estado === 'JUGANDO') {
          return respuestaError('JUEGO_YA_INICIADO', 'No se puede salir de la sala con el juego en curso');
        }
        if (this.juego) this.marcarDesconectado(jugador);
        else this.quitarDelLobby(jugador);
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
        return this.accionDeJugador({ type: 'APOSTAR', playerId: jugador.id, value: comando.datos.valor });

      case 'juego.jugarCarta':
        return this.accionDeJugador({ type: 'JUGAR_CARTA', playerId: jugador.id, cardId: comando.datos.idCarta });

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

  private accionDeJugador(accion: Action): Respuesta {
    if (!this.juego) return respuestaError('JUEGO_NO_INICIADO', 'El juego todavía no empezó');
    const problema = this.aplicar(accion);
    return problema ? { ok: false, error: problema } : respuestaOk();
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
    this.juego = creado.value;
    this.azar = this.opciones.crearAzar();
    this.resumenPausado = false;
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
      for (const salida of traducirEvento(evento, this.juego)) {
        this.emitir(salida.tipo, salida.datos, salida.privados);
      }
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
      case 'PLAYING': {
        const turno = currentTurn(juego);
        // Etapa 6: fecha límite del turno y piloto automático.
        if (turno) {
          const evento = eventoDeTurno(juego, turno, null);
          this.emitir(evento.tipo, evento.datos);
        }
        return;
      }
      case 'TRICK_RESOLUTION':
        this.programarAvance(this.opciones.pausaBazaMs);
        return;
      case 'ROUND_SUMMARY':
        if (!this.resumenPausado) this.programarAvance(this.opciones.pausaResumenMs);
        return;
      default:
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
  private emitir(
    tipo: TipoEvento,
    datos: Record<string, unknown>,
    privados?: Map<string, Record<string, unknown>>,
    excluir?: string,
  ): void {
    this.seq++;
    const registro: RegistroEvento = { seq: this.seq, tipo, datos };
    if (privados) registro.privados = privados;
    this.registro.push(registro);
    for (const jugador of this.jugadores) {
      if (jugador.id === excluir) continue;
      this.enviarA(jugador, {
        v: VERSION_PROTOCOLO,
        tipo,
        seq: this.seq,
        datos: privados?.get(jugador.id) ?? datos,
      });
    }
  }

  private enviarA(jugador: Jugador, mensaje: MensajeServidor): void {
    if (this.cerrada || !jugador.conectado || !jugador.destino) return;
    this.salida.push({ destino: jugador.destino, mensaje });
  }

  /**
   * Foto del estado para un jugador. En esta etapa cubre la sala (lobby);
   * la vista del juego en curso llega con el proyector de vistas (etapa 4).
   */
  private foto(jugador: Jugador): MensajeServidor {
    return {
      v: VERSION_PROTOCOLO,
      tipo: 'estado.foto',
      seq: this.seq,
      datos: {
        codigo: this.codigo,
        estado: this.estado,
        yo: jugador.id,
        anfitrion: this.anfitrion,
        maxJugadores: this.opciones.maxJugadores,
        jugadores: this.jugadores.map((j) => ({ idJugador: j.id, nombre: j.nombre, conectado: j.conectado })),
        horaServidor: this.opciones.reloj.ahora(),
      },
    };
  }
}
