/**
 * Gestor de salas: crea salas con código de invitación, las busca y las
 * olvida cuando quedan vacías.
 */
import { randomInt } from 'node:crypto';
import { ALFABETO_CODIGO, LARGO_CODIGO_SALA, respuestaError, type Respuesta } from '@tokinoto/protocolo';
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

export class GestorSalas {
  private readonly salas = new Map<string, Sala>();
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
    nombre: string,
    maxJugadores: number,
    destino: Destino,
    responder: AlResponderIngreso,
    tiempoTurno?: number | null,
  ): void {
    if (this.salas.size >= this.maxSalas) {
      responder(respuestaError('ERROR_INTERNO', 'El servidor no admite más salas en este momento'), null);
      return;
    }
    let codigo = generarCodigoSala();
    while (this.salas.has(codigo)) codigo = generarCodigoSala();

    const opciones: Partial<OpcionesSala> = { ...this.opcionesSala, maxJugadores };
    if (tiempoTurno !== undefined) opciones.tiempoTurnoMs = tiempoTurno === null ? null : tiempoTurno * 1000;
    const sala = new Sala(codigo, opciones, (vacia) => this.olvidar(vacia));
    this.salas.set(codigo, sala);
    sala.unirse(nombre, destino, (respuesta) => {
      if (!respuesta.ok) this.olvidar(sala); // no dejar salas vacías colgadas
      responder(respuesta, respuesta.ok ? sala : null);
    });
  }

  /** Suma un jugador a una sala existente. */
  unirse(codigo: string, nombre: string, destino: Destino, responder: AlResponderIngreso): void {
    const sala = this.buscar(codigo);
    if (!sala) {
      responder(respuestaError('SALA_NO_EXISTE', 'No existe una sala con ese código'), null);
      return;
    }
    sala.unirse(nombre, destino, (respuesta) => responder(respuesta, respuesta.ok ? sala : null));
  }

  /** Vuelve a una sala con el token de sesión (que empieza con el código de la sala). */
  reconectar(token: string, destino: Destino, responder: AlResponderIngreso): void {
    const sala = this.buscar(token.split('.')[0] ?? '');
    if (!sala) {
      responder(respuestaError('SESION_INVALIDA', 'Tu lugar en esa sala ya no existe'), null);
      return;
    }
    sala.reconectar(token, destino, (respuesta) => responder(respuesta, respuesta.ok ? sala : null));
  }

  /** Cierra todas las salas (al apagar el servidor). */
  cerrarTodas(): void {
    for (const sala of this.salas.values()) sala.cerrar();
    this.salas.clear();
  }

  private olvidar(sala: Sala): void {
    if (this.salas.get(sala.codigo) === sala) this.salas.delete(sala.codigo);
  }
}
