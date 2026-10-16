/**
 * Guardado del historial (DP-21) sin frenar el juego.
 *
 * La sala le avisa de cada juego nuevo y de cada evento del motor, y sigue
 * sin esperar. El guardador los escribe en la base en orden, de a lotes, y
 * reintenta si la base falla. Si no logra guardar algo, avisa del error y
 * el juego sigue igual: la partida en curso nunca depende de la base.
 */
import type { GameEvent } from '@tokinoto/reglas';
import type { DatosJuego, Repositorio } from '@tokinoto/persistencia';

/** Motivo con el que se cierran los juegos que un reinicio del servidor dejó a medias (DT-05). */
export const MOTIVO_ABORTO_REINICIO = 'Reinicio del servidor';

/** Lo que la sala necesita saber del historial. */
export interface Historial {
  juegoNuevo(datos: Omit<DatosJuego, 'iniciadoEn'>): void;
  /** `seq` cuenta los eventos del motor dentro del juego, desde 0. */
  evento(juegoId: string, seq: number, evento: GameEvent): void;
}

export interface OpcionesGuardador {
  /** Hora que se guarda como inicio y cierre del juego. */
  ahora?: () => Date;
  alError?: (problema: unknown) => void;
  /** Milisegundos de espera antes de cada reintento; su cantidad es la de reintentos. */
  esperas?: readonly number[];
  dormir?: (ms: number) => Promise<void>;
}

export class GuardadorHistorial implements Historial {
  private readonly ahora: () => Date;
  private readonly alError: (problema: unknown) => void;
  private readonly esperas: readonly number[];
  private readonly dormir: (ms: number) => Promise<void>;

  private cadena: Promise<void> = Promise.resolve();
  private pendientes = 0;
  private readonly lotes = new Map<string, { seq: number; evento: GameEvent }[]>();
  private envioProgramado = false;
  /** Juegos que no se pudieron abrir: no se intenta guardar el resto. */
  private readonly perdidos = new Set<string>();

  constructor(
    private readonly repositorio: Repositorio,
    opciones: OpcionesGuardador = {},
  ) {
    this.ahora = opciones.ahora ?? (() => new Date());
    this.alError = opciones.alError ?? ((problema) => console.error('[historial] no se pudo guardar:', problema));
    this.esperas = opciones.esperas ?? [200, 1000, 3000];
    this.dormir = opciones.dormir ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms)));
  }

  juegoNuevo(datos: Omit<DatosJuego, 'iniciadoEn'>): void {
    const iniciadoEn = this.ahora();
    this.encolar(datos.id, true, () => this.repositorio.abrirJuego({ ...datos, iniciadoEn }));
  }

  evento(juegoId: string, seq: number, evento: GameEvent): void {
    let lote = this.lotes.get(juegoId);
    if (!lote) this.lotes.set(juegoId, (lote = []));
    lote.push({ seq, evento });
    if (this.envioProgramado) return;
    this.envioProgramado = true;
    // Todos los eventos que produce una misma acción viajan juntos.
    queueMicrotask(() => this.enviarLotes());
  }

  /** Espera a que todo lo pendiente quede guardado (o haya fallado definitivamente). */
  async vaciar(): Promise<void> {
    this.enviarLotes();
    while (this.pendientes > 0) await this.cadena;
  }

  private enviarLotes(): void {
    this.envioProgramado = false;
    const cuando = this.ahora();
    for (const [juegoId, lote] of this.lotes) {
      this.encolar(juegoId, false, () => this.repositorio.agregarEventos(juegoId, lote, cuando));
    }
    this.lotes.clear();
  }

  private encolar(juegoId: string, abre: boolean, escribir: () => Promise<void>): void {
    this.pendientes++;
    this.cadena = this.cadena.then(async () => {
      try {
        if (this.perdidos.has(juegoId)) return;
        await this.conReintentos(escribir);
      } catch (problema) {
        if (abre) this.perdidos.add(juegoId);
        this.avisar(problema);
      } finally {
        this.pendientes--;
      }
    });
  }

  private async conReintentos(escribir: () => Promise<void>): Promise<void> {
    for (let intento = 0; ; intento++) {
      try {
        return await escribir();
      } catch (problema) {
        const espera = this.esperas[intento];
        if (espera === undefined) throw problema;
        await this.dormir(espera);
      }
    }
  }

  private avisar(problema: unknown): void {
    try {
      this.alError(problema);
    } catch {
      // El aviso de un error nunca debe romper el guardado de lo que sigue.
    }
  }
}
