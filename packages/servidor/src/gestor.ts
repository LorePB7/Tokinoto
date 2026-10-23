/**
 * Gestor de salas: crea salas con código de invitación, las busca y las
 * olvida cuando quedan vacías.
 */
import { randomInt } from 'node:crypto';
import {
  ALFABETO_CODIGO,
  LARGO_CODIGO_SALA,
  respuestaError,
  respuestaOk,
  type NivelBot,
  type Respuesta,
} from '@tokinoto/protocolo';
import type { Identidad } from './cuentas';
import { Sala, type Destino, type OpcionesSala } from './sala';

export interface OpcionesGestor {
  /** Opciones comunes a todas las salas (pausas, reloj, azar...). */
  sala?: Partial<OpcionesSala>;
  /** Límite de salas simultáneas, para proteger al servidor. */
  maxSalas?: number;
}

/** Respuesta junto con la sala en la que quedó el jugador (si salió bien). */
export type AlResponderIngreso = (respuesta: Respuesta, sala: Sala | null) => void;

/**
 * Código de sala no adivinable: 8 caracteres de un alfabeto de 31
 * (unos 40 bits de azar criptográfico).
 */
export function generarCodigoSala(): string {
  let codigo = '';
  for (let i = 0; i < LARGO_CODIGO_SALA; i++) {
    codigo += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  }
  return codigo;
}

/** Lugar que una persona (identidad) tiene en una sala: la sala y el token del asiento. */
interface Lugar {
  sala: Sala;
  token: string;
}

/** Saca el token interno del asiento de la respuesta: el cliente vuelve con su sesión, no con él. */
function sinToken(respuesta: Respuesta): Respuesta {
  if (!respuesta.ok || !('token' in respuesta.datos)) return respuesta;
  const { token: _token, ...datos } = respuesta.datos;
  return respuestaOk(datos);
}

export class GestorSalas {
  private readonly salas = new Map<string, Sala>();
  /** Dónde está sentada cada persona, por clave de identidad (una sala activa a la vez). */
  private readonly lugares = new Map<string, Lugar>();
  private readonly opcionesSala: Partial<OpcionesSala>;
  private readonly maxSalas: number;

  constructor(opciones: OpcionesGestor = {}) {
    this.opcionesSala = opciones.sala ?? {};
    this.maxSalas = opciones.maxSalas ?? 1000;
  }

  get cantidad(): number {
    return this.salas.size;
  }

  buscar(codigo: string): Sala | undefined {
    return this.salas.get(codigo.trim().toUpperCase());
  }

  /**
   * Crea una sala; quien la crea es el primer jugador y el anfitrión.
   * `tiempoTurno` en segundos: undefined usa el de las opciones; null es sin límite.
   */
  crear(
    identidad: Identidad,
    destino: Destino,
    responder: AlResponderIngreso,
    tiempoTurno?: number | null,
  ): void {
    const ocupado = this.lugarOcupado(identidad, null);
    if (ocupado) {
      responder(ocupado, null);
      return;
    }
    if (this.salas.size >= this.maxSalas) {
      responder(respuestaError('ERROR_INTERNO', 'El servidor no admite más salas en este momento'), null);
      return;
    }
    let codigo = generarCodigoSala();
    while (this.salas.has(codigo)) codigo = generarCodigoSala();

    const opciones: Partial<OpcionesSala> = { ...this.opcionesSala };
    if (tiempoTurno !== undefined) opciones.tiempoTurnoMs = tiempoTurno === null ? null : tiempoTurno * 1000;
    const sala = new Sala(codigo, opciones, (vacia) => this.olvidar(vacia));
    this.salas.set(codigo, sala);
    this.sentar(sala, identidad, destino, (respuesta) => {
      if (!respuesta.ok) this.olvidar(sala); // no dejar salas vacías colgadas
      responder(respuesta, respuesta.ok ? sala : null);
    });
  }

  /**
   * Jugar contra bots (fase 8): crea una sala con la persona como anfitrión,
   * le suma `cantidad` bots del nivel elegido y la inicia sola. Por defecto,
   * sin límite de tiempo por jugada: no hay nadie más esperando.
   */
  jugarContraBots(
    identidad: Identidad,
    destino: Destino,
    responder: AlResponderIngreso,
    cantidad: number,
    nivel: NivelBot,
    tiempoTurno: number | null = null,
  ): void {
    this.crear(
      identidad,
      destino,
      (respuesta, sala) => {
        responder(respuesta, sala);
        if (!respuesta.ok || !sala) return;
        sala.iniciarContraBots(String(respuesta.datos['idJugador']), cantidad, nivel, (inicio) => {
          if (!inicio.ok) console.error('[sala] no se pudo empezar el juego contra bots:', inicio.error);
        });
      },
      tiempoTurno,
    );
  }

  /**
   * Suma a la persona a una sala existente. Si ya tenía lugar en esa misma sala
   * (otra pestaña, otro dispositivo), vuelve a su asiento en vez de ocupar otro.
   */
  unirse(codigo: string, identidad: Identidad, destino: Destino, responder: AlResponderIngreso): void {
    const sala = this.buscar(codigo);
    if (!sala) {
      responder(respuestaError('SALA_NO_EXISTE', 'No existe una sala con ese código'), null);
      return;
    }
    const lugar = this.lugarVigente(identidad.clave);
    if (lugar?.sala === sala && sala.tieneAsiento(lugar.token)) {
      this.reconectar(identidad, destino, responder);
      return;
    }
    const ocupado = this.lugarOcupado(identidad, sala);
    if (ocupado) {
      responder(ocupado, null);
      return;
    }
    this.sentar(sala, identidad, destino, (respuesta) => responder(respuesta, respuesta.ok ? sala : null));
  }

  /** Vuelve al asiento que la persona tiene en una sala (DP-14). */
  reconectar(identidad: Identidad, destino: Destino, responder: AlResponderIngreso): void {
    const lugar = this.lugarVigente(identidad.clave);
    if (!lugar) {
      responder(respuestaError('SESION_INVALIDA', 'Tu lugar en esa sala ya no existe'), null);
      return;
    }
    lugar.sala.reconectar(lugar.token, destino, (respuesta) => {
      if (!respuesta.ok && (respuesta.error.codigo === 'SESION_INVALIDA' || respuesta.error.codigo === 'EXPULSADO')) {
        this.lugares.delete(identidad.clave);
      }
      responder(sinToken(respuesta), respuesta.ok ? lugar.sala : null);
    });
  }

  /**
   * ¿La persona tiene un lugar vigente? Vigente = la sala existe, sigue sentada
   * en ella y el juego no terminó. No conecta a nadie: solo responde.
   */
  consultar(identidad: Identidad, responder: (respuesta: Respuesta) => void): void {
    const lugar = this.lugarVigente(identidad.clave);
    if (!lugar) {
      responder(respuestaOk({ vigente: false }));
      return;
    }
    lugar.sala.consultar(lugar.token, responder);
  }

  /**
   * Deja, desde el inicio, la sala en la que la persona tiene lugar (como
   * `sala.salir`, sin volver a entrar). Si no tiene ninguna, no hace nada.
   */
  abandonar(identidad: Identidad, responder: (respuesta: Respuesta) => void): void {
    const lugar = this.lugarVigente(identidad.clave);
    if (!lugar) {
      responder(respuestaOk());
      return;
    }
    lugar.sala.abandonar(lugar.token, responder);
  }

  /** Cierra todas las salas (al apagar el servidor). */
  cerrarTodas(): void {
    for (const sala of this.salas.values()) sala.cerrar();
    this.salas.clear();
    this.lugares.clear();
  }

  private sentar(sala: Sala, identidad: Identidad, destino: Destino, responder: (respuesta: Respuesta) => void): void {
    sala.unirse(
      identidad.nombre,
      destino,
      (respuesta) => {
        if (respuesta.ok) this.lugares.set(identidad.clave, { sala, token: String(respuesta.datos['token']) });
        responder(sinToken(respuesta));
      },
      { cuentaId: identidad.cuentaId, invitado: identidad.tipo === 'invitado', clave: identidad.clave },
    );
  }

  /** El lugar de la persona, si la sala sigue abierta. Los lugares de salas cerradas se olvidan. */
  private lugarVigente(clave: string): Lugar | null {
    const lugar = this.lugares.get(clave);
    if (!lugar) return null;
    if (lugar.sala.estaCerrada || this.salas.get(lugar.sala.codigo) !== lugar.sala) {
      this.lugares.delete(clave);
      return null;
    }
    return lugar;
  }

  /** Una persona puede estar en una sola sala activa a la vez. */
  private lugarOcupado(identidad: Identidad, destinoSala: Sala | null): Respuesta | null {
    const lugar = this.lugarVigente(identidad.clave);
    if (!lugar || lugar.sala === destinoSala || !lugar.sala.ocupaLugar(lugar.token)) return null;
    return respuestaError(
      'YA_ESTAS_EN_UNA_SALA',
      `Ya estás en la sala ${lugar.sala.codigo}. Volvé a esa partida o abandonala para entrar a otra.`,
    );
  }

  private olvidar(sala: Sala): void {
    if (this.salas.get(sala.codigo) === sala) this.salas.delete(sala.codigo);
    for (const [clave, lugar] of this.lugares) if (lugar.sala === sala) this.lugares.delete(clave);
  }
}
