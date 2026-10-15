/**
 * Límite de frecuencia por conexión ("cubeta de fichas"): cada mensaje
 * consume una ficha y las fichas se reponen a ritmo constante. Permite
 * ráfagas cortas (hasta `capacidad`) pero no un flujo sostenido mayor que
 * `porSegundo`.
 */
export interface OpcionesLimite {
  capacidad: number;
  porSegundo: number;
}

export const LIMITE_POR_DEFECTO: OpcionesLimite = { capacidad: 20, porSegundo: 10 };

export class Limitador {
  private fichas: number;
  private ultimaRecarga: number;

  constructor(
    private readonly opciones: OpcionesLimite = LIMITE_POR_DEFECTO,
    private readonly ahora: () => number = Date.now,
  ) {
    this.fichas = opciones.capacidad;
    this.ultimaRecarga = ahora();
  }

  /** Consume una ficha. Devuelve false si se superó el límite. */
  tomar(): boolean {
    const momento = this.ahora();
    const transcurrido = Math.max(0, momento - this.ultimaRecarga) / 1000;
    this.fichas = Math.min(this.opciones.capacidad, this.fichas + transcurrido * this.opciones.porSegundo);
    this.ultimaRecarga = momento;
    if (this.fichas < 1) return false;
    this.fichas -= 1;
    return true;
  }
}
