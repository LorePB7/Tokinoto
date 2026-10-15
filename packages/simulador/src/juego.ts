import { isDeepStrictEqual } from 'node:util';
import {
  apply,
  checkInvariants,
  createGame,
  createSeededRng,
  currentTurn,
  replay,
  validBetsFor,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerInfo,
} from '@tokinoto/reglas';

/** Tope de acciones por juego; si se supera hay un bucle en el motor. */
const MAX_PASOS = 20_000;
const BAZAS_POR_JUEGO = 56;
const PARTIDAS_POR_JUEGO = 14;

export interface OpcionesJuego {
  jugadores: number;
  semilla: number;
  /** Chequea los invariantes después de cada acción (más lento, más seguro). */
  verificar?: boolean;
}

export interface ResultadoJuego {
  jugadores: number;
  semilla: number;
  inicial: GameState | null;
  final: GameState | null;
  eventos: GameEvent[];
  pasos: number;
  /** Vacío si el motor se comportó bien en todo el juego. */
  violaciones: string[];
}

/**
 * Juega un juego completo con apuestas y cartas elegidas al azar, siempre
 * legales. Cualquier acción legal que el motor rechace, o cualquier
 * invariante que se rompa, queda registrado como violación y detiene el juego.
 * Nunca lanza excepciones por un fallo del motor.
 */
export function simularJuego(opciones: OpcionesJuego): ResultadoJuego {
  const verificar = opciones.verificar ?? true;
  const azarMotor = createSeededRng(opciones.semilla);
  const azarJugadas = createSeededRng((opciones.semilla ^ 0x9e3779b9) >>> 0);
  const violaciones: string[] = [];
  const eventos: GameEvent[] = [];

  const jugadores: PlayerInfo[] = Array.from({ length: opciones.jugadores }, (_, i) => ({
    id: `j${i}`,
    name: `Jugador ${i + 1}`,
  }));
  const creado = createGame(jugadores);
  if (!creado.ok) {
    return {
      jugadores: opciones.jugadores,
      semilla: opciones.semilla,
      inicial: null,
      final: null,
      eventos,
      pasos: 0,
      violaciones: [`No se pudo crear el juego: ${creado.error.code} - ${creado.error.message}`],
    };
  }

  const inicial = creado.value;
  let estado = inicial;
  let pasos = 0;

  /** Ejecuta una acción. Devuelve false si hubo una violación. */
  const ejecutar = (accion: Action): boolean => {
    const resultado = apply(estado, accion, azarMotor);
    if (!resultado.ok) {
      violaciones.push(
        `El motor rechazó una acción legal (${accion.type}) en la fase ${estado.phase}: ` +
          `${resultado.error.code} - ${resultado.error.message}`,
      );
      return false;
    }
    estado = resultado.state;
    eventos.push(...resultado.events);
    pasos++;
    if (verificar) {
      const problemas = checkInvariants(estado);
      if (problemas.length > 0) {
        for (const problema of problemas) {
          violaciones.push(`Tras ${accion.type} (paso ${pasos}, partida ${estado.roundNumber}): ${problema}`);
        }
        return false;
      }
    }
    return true;
  };

  const nombreDe = (asiento: number): string => estado.players[asiento]?.id ?? '';

  if (ejecutar({ type: 'INICIAR_JUEGO' })) {
    while (estado.phase !== 'FINISHED' && violaciones.length === 0) {
      if (pasos > MAX_PASOS) {
        violaciones.push(`El juego no termina después de ${MAX_PASOS} acciones (posible bucle)`);
        break;
      }
      let accion: Action | null = null;
      switch (estado.phase) {
        case 'DEALER_DRAW':
          accion = { type: 'SORTEAR_REPARTIDOR' };
          break;
        case 'BETTING': {
          const turno = currentTurn(estado);
          if (!turno) break;
          const validas = validBetsFor(estado, turno.seat);
          const value = validas[azarJugadas.nextInt(validas.length)];
          if (value === undefined) {
            violaciones.push(`Sin apuestas válidas para el asiento ${turno.seat}`);
            break;
          }
          accion = { type: 'APOSTAR', playerId: nombreDe(turno.seat), value };
          break;
        }
        case 'PLAYING': {
          const turno = currentTurn(estado);
          if (!turno) break;
          const mano = estado.hands[turno.seat] ?? [];
          const carta = mano[azarJugadas.nextInt(Math.max(mano.length, 1))];
          if (!carta) {
            violaciones.push(`Mano vacía en el turno del asiento ${turno.seat}`);
            break;
          }
          accion = { type: 'JUGAR_CARTA', playerId: nombreDe(turno.seat), cardId: carta.id };
          break;
        }
        case 'TRICK_RESOLUTION':
        case 'ROUND_SUMMARY':
          accion = { type: 'AVANZAR' };
          break;
        default:
          violaciones.push(`Fase inesperada: ${estado.phase}`);
      }
      if (accion === null) {
        if (violaciones.length === 0) violaciones.push(`Sin turno en la fase ${estado.phase}`);
        break;
      }
      if (!ejecutar(accion)) break;
    }
  }

  if (violaciones.length === 0 && verificar) {
    verificarJuegoCompleto(inicial, estado, eventos, violaciones);
  }

  return {
    jugadores: opciones.jugadores,
    semilla: opciones.semilla,
    inicial,
    final: estado,
    eventos,
    pasos,
    violaciones,
  };
}

/** Chequeos que solo se pueden hacer con el juego terminado. */
function verificarJuegoCompleto(
  inicial: GameState,
  final: GameState,
  eventos: readonly GameEvent[],
  violaciones: string[],
): void {
  const contar = (tipo: GameEvent['type']): number => eventos.filter((e) => e.type === tipo).length;
  if (contar('BAZA_RESUELTA') !== BAZAS_POR_JUEGO) {
    violaciones.push(`Se resolvieron ${contar('BAZA_RESUELTA')} bazas y deberían ser ${BAZAS_POR_JUEGO}`);
  }
  if (contar('PARTIDA_PUNTUADA') !== PARTIDAS_POR_JUEGO) {
    violaciones.push(`Se puntuaron ${contar('PARTIDA_PUNTUADA')} partidas y deberían ser ${PARTIDAS_POR_JUEGO}`);
  }
  if (!isDeepStrictEqual(replay(inicial, eventos), final)) {
    violaciones.push('El estado reconstruido desde los eventos no coincide con el estado final');
  }
}
