/**
 * Vistas por jugador (docs/diseno-tecnico.md, 3.4: "la regla de oro").
 *
 * `proyectarJuego(estado, jugador)` arma lo que ese jugador puede ver del
 * juego. El servidor nunca envía el estado completo: solo vistas.
 *
 * | Dato                          | Qué recibe el jugador                     |
 * |-------------------------------|-------------------------------------------|
 * | Su mano                       | Las cartas completas                      |
 * | Mano de los demás             | Solo la cantidad de cartas                |
 * | Cartas de la baza en curso    | Todas (son públicas)                      |
 * | Bazas ya cerradas             | Solo la carta ganadora y quién ganó       |
 * | Apuestas, bazas, puntajes     | Todos                                     |
 * | Mazo y cartas sobrantes       | Nada                                      |
 *
 * Esta función es la ÚNICA que lee las manos para armar lo que ve un
 * jugador, y solo lee la mano de ese jugador y la cantidad de las demás.
 */
import {
  currentTurn,
  forbiddenBetFor,
  highestDrawers,
  totalScores,
  type DrawEntry,
  type GameState,
  type Phase,
} from '@tokinoto/reglas';
import type { AsientoPublico, CartaSacada, MotivoPiloto, PuestoEnRanking } from './protocolo';

/** ESPERANDO = lobby; JUGANDO = juego en curso; TERMINADO = juego terminado o abortado. */
export type EstadoSala = 'ESPERANDO' | 'JUGANDO' | 'TERMINADO';

export interface JugadorDeSala {
  idJugador: string;
  nombre: string;
  conectado: boolean;
  /** Si el piloto automático juega por este jugador, y por qué (null si no). */
  piloto: MotivoPiloto | null;
}

/** Todo lo que un jugador sabe de su sala. Es el contenido de `estado.foto`. */
export interface VistaSala {
  codigo: string;
  estado: EstadoSala;
  /** idJugador de quien recibe la vista. */
  yo: string;
  anfitrion: string | null;
  maxJugadores: number;
  /** Tiempo por apuesta y por tirada, en ms; null = sin límite. */
  tiempoTurnoMs: number | null;
  resumenPausado: boolean;
  jugadores: JugadorDeSala[];
  /** Hora del servidor al armar la foto (para calcular la diferencia de relojes). */
  horaServidor: number;
  juego: VistaJuego | null;
}

/**
 * Fase visible del juego. SORTEO dura solo un instante (el servidor sortea
 * enseguida); BAZA_RESUELTA es la pausa de ~3 s y RESUMEN la de ~10 s.
 */
export type FaseVista = 'SORTEO' | 'APUESTAS' | 'TIRADAS' | 'BAZA_RESUELTA' | 'RESUMEN' | 'TERMINADO' | 'ABORTADO';

export type TurnoVista =
  | { tipo: 'apuesta'; asiento: number; valorProhibido: number | null; fechaLimite: number | null }
  | { tipo: 'carta'; asiento: number; fechaLimite: number | null };

export interface SorteoVista {
  sacadas: CartaSacada[];
  /** Asientos empatados con la carta más alta, que vuelven a sacar. */
  repiten: number[];
}

export interface BazaVista {
  baza: number;
  mano: number;
  tiradas: CartaSacada[];
  ganador: number | null;
}

export interface BazaCerrada {
  baza: number;
  ganador: number;
  cartaGanadora: string;
  tieneFicha: boolean;
}

export interface VistaJuego {
  fase: FaseVista;
  asientos: AsientoPublico[];
  miAsiento: number;
  sorteo: SorteoVista[];
  repartidor: number | null;
  partida: number;
  totalPartidas: number;
  cartasPorJugador: number;
  /** Quien abre la baza en curso (o la próxima). */
  mano: number | null;
  /** Solo las cartas propias. */
  miMano: string[];
  /** Cuántas cartas tiene cada asiento. */
  cantidades: number[];
  apuestas: (number | null)[];
  bazasGanadas: number[];
  /** La baza en curso, con todas sus cartas (públicas); también durante la pausa tras resolverse. */
  bazaActual: BazaVista | null;
  /** Bazas cerradas de la partida en curso: solo carta ganadora y ganador. */
  bazasCerradas: BazaCerrada[];
  /** Puntos de cada asiento en cada partida jugada: puntajes[asiento][partida - 1]. */
  puntajes: number[][];
  totales: number[];
  turno: TurnoVista | null;
  ranking: PuestoEnRanking[] | null;
  motivoAborto: string | null;
}

const FASES: Record<Phase, FaseVista> = {
  READY_TO_START: 'SORTEO',
  DEALER_DRAW: 'SORTEO',
  BETTING: 'APUESTAS',
  PLAYING: 'TIRADAS',
  TRICK_RESOLUTION: 'BAZA_RESUELTA',
  ROUND_SUMMARY: 'RESUMEN',
  FINISHED: 'TERMINADO',
  ABORTED: 'ABORTADO',
};

/** Empatados con la carta más alta en una vuelta del sorteo (vacío si no hubo empate). */
export function repitenEnSorteo(sacadas: readonly DrawEntry[]): number[] {
  const masAltos = highestDrawers(sacadas);
  return masAltos.length > 1 ? masAltos : [];
}

/**
 * Arma la vista del juego para un jugador. `fechaLimite` es la del turno en
 * curso, si la hay (la maneja la sala).
 */
export function proyectarJuego(juego: GameState, idJugador: string, fechaLimite: number | null = null): VistaJuego {
  const miAsiento = juego.players.findIndex((jugador) => jugador.id === idJugador);
  if (miAsiento < 0) throw new Error('El jugador no participa de este juego');

  const turno = currentTurn(juego);
  let turnoVista: TurnoVista | null = null;
  if (turno?.kind === 'bet') {
    turnoVista = {
      tipo: 'apuesta',
      asiento: turno.seat,
      valorProhibido: forbiddenBetFor(juego, turno.seat),
      fechaLimite,
    };
  } else if (turno?.kind === 'card') {
    turnoVista = { tipo: 'carta', asiento: turno.seat, fechaLimite };
  }

  const baza = juego.currentTrick;
  return {
    fase: FASES[juego.phase],
    asientos: juego.players.map((jugador, asiento) => ({ asiento, idJugador: jugador.id, nombre: jugador.name })),
    miAsiento,
    sorteo: juego.dealerDraw.map((vuelta) => ({
      sacadas: vuelta.draws.map((d) => ({ asiento: d.seat, carta: d.card.id })),
      repiten: repitenEnSorteo(vuelta.draws),
    })),
    repartidor: juego.dealerSeat,
    partida: juego.roundNumber,
    totalPartidas: juego.config.cardsPerRound.length,
    cartasPorJugador: juego.cardsPerPlayer,
    mano: juego.leadSeat,
    miMano: (juego.hands[miAsiento] ?? []).map((carta) => carta.id),
    cantidades: juego.hands.map((mano) => mano.length),
    apuestas: [...juego.bets],
    bazasGanadas: [...juego.tricksWon],
    bazaActual: baza
      ? {
          baza: baza.number,
          mano: baza.leadSeat,
          tiradas: baza.plays.map((tirada) => ({ asiento: tirada.seat, carta: tirada.card.id })),
          ganador: baza.winnerSeat,
        }
      : null,
    bazasCerradas: juego.wonTricks.map((cerrada) => ({
      baza: cerrada.trickNumber,
      ganador: cerrada.winnerSeat,
      cartaGanadora: cerrada.winningCard.id,
      tieneFicha: cerrada.hasChip,
    })),
    puntajes: juego.roundScores.map((puntos) => [...puntos]),
    totales: totalScores(juego),
    turno: turnoVista,
    ranking: juego.ranking ? juego.ranking.map((r) => ({ asiento: r.seat, total: r.total, puesto: r.position })) : null,
    motivoAborto: juego.abortReason,
  };
}
