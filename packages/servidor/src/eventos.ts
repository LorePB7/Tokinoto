/**
 * Traducción de los eventos del motor de reglas a eventos del protocolo.
 *
 * Regla de oro (diseño técnico 3.4): ningún jugador recibe cartas que no
 * debe ver. Por eso un evento tiene datos públicos y, opcionalmente, datos
 * privados por jugador que reemplazan a los públicos solo para ese jugador.
 * Las cartas viajan como su identificador (por ejemplo "K-picas"); el
 * cliente obtiene el valor con el paquete compartido @tokinoto/reglas.
 */
import { forbiddenBetFor, totalScores, type GameEvent, type GameState, type Turn } from '@tokinoto/reglas';
import { repitenEnSorteo, type DatosEventos, type TipoEvento } from '@tokinoto/protocolo';

/** Evento listo para emitir: datos públicos y, opcionalmente, datos privados por jugador (clave: idJugador). */
export type EventoSalida = {
  [T in TipoEvento]: { tipo: T; datos: DatosEventos[T]; privados?: Map<string, DatosEventos[T]> };
}[TipoEvento];

/**
 * Traduce un evento del motor. `despues` es el estado inmediatamente
 * posterior a aplicar ese evento; `finResumen`, la hora en que termina el
 * resumen de la partida (la decide la sala).
 */
export function traducirEvento(evento: GameEvent, despues: GameState, finResumen: number | null = null): EventoSalida[] {
  switch (evento.type) {
    case 'JUEGO_INICIADO':
      return [
        {
          tipo: 'juego.iniciado',
          datos: {
            asientos: despues.players.map((jugador, asiento) => ({
              asiento,
              idJugador: jugador.id,
              nombre: jugador.name,
            })),
          },
        },
      ];

    case 'SORTEO_RONDA':
      // Las cartas del sorteo son públicas: todos las ven al sacarlas.
      return [
        {
          tipo: 'sorteo.cartasSacadas',
          datos: {
            sacadas: evento.draws.map((d) => ({ asiento: d.seat, carta: d.card.id })),
            repiten: repitenEnSorteo(evento.draws),
          },
        },
      ];

    case 'REPARTIDOR_DEFINIDO':
      return [{ tipo: 'sorteo.resultado', datos: { repartidor: evento.dealerSeat } }];

    case 'PARTIDA_INICIADA': {
      const cantidades = evento.hands.map((mano) => mano.length);
      const privados = new Map<string, DatosEventos['partida.manoRepartida']>();
      despues.players.forEach((jugador, asiento) => {
        privados.set(jugador.id, {
          cantidades,
          cartas: (evento.hands[asiento] ?? []).map((carta) => carta.id),
        });
      });
      return [
        {
          tipo: 'partida.iniciada',
          datos: {
            partida: evento.roundNumber,
            cartasPorJugador: evento.cardsPerPlayer,
            repartidor: evento.dealerSeat,
            pie: evento.dealerSeat, // el repartidor siempre es el Pié
            mano: evento.leadSeat,
          },
        },
        // Público: solo cuántas cartas tiene cada uno. Privado: además, las propias.
        { tipo: 'partida.manoRepartida', datos: { cantidades, cartas: [] }, privados },
      ];
    }

    case 'APUESTA_REALIZADA':
      return [
        {
          tipo: 'apuesta.realizada',
          datos: { asiento: evento.seat, valor: evento.value, porPiloto: evento.porPiloto === true },
        },
      ];

    case 'BAZA_INICIADA':
      return [{ tipo: 'baza.iniciada', datos: { baza: evento.trickNumber, mano: evento.leadSeat } }];

    case 'CARTA_JUGADA':
      return [
        {
          tipo: 'baza.cartaJugada',
          datos: { asiento: evento.seat, carta: evento.card.id, porPiloto: evento.porPiloto === true },
        },
      ];

    case 'BAZA_RESUELTA':
      return [
        {
          tipo: 'baza.resuelta',
          datos: {
            baza: evento.trickNumber,
            ganador: evento.winnerSeat,
            cartaGanadora: evento.winningCard.id,
            tieneFicha: evento.hasChip,
          },
        },
      ];

    case 'PARTIDA_PUNTUADA':
      return [
        {
          tipo: 'partida.puntajes',
          datos: {
            partida: evento.roundNumber,
            resultados: evento.results.map((r) => ({
              asiento: r.seat,
              apuesta: r.bet,
              bazasGanadas: r.tricksWon,
              puntos: r.points,
            })),
            totales: totalScores(despues),
            finResumen: finResumen ?? 0,
          },
        },
      ];

    case 'JUEGO_TERMINADO':
      return [
        {
          tipo: 'juego.terminado',
          datos: {
            ranking: evento.ranking.map((r) => ({ asiento: r.seat, total: r.total, puesto: r.position })),
          },
        },
      ];

    case 'JUEGO_ABORTADO':
      return [{ tipo: 'juego.abortado', datos: { motivo: evento.reason } }];

    default: {
      const imposible: never = evento;
      throw new Error(`Evento desconocido: ${JSON.stringify(imposible)}`);
    }
  }
}

/** Evento de turno: a quién le toca y, si es el Pié, qué valor no puede apostar. */
export function eventoDeTurno(estado: GameState, turno: Turn, fechaLimite: number | null): EventoSalida {
  if (turno.kind === 'bet') {
    return {
      tipo: 'apuesta.turno',
      datos: { asiento: turno.seat, valorProhibido: forbiddenBetFor(estado, turno.seat), fechaLimite },
    };
  }
  return {
    tipo: 'baza.turno',
    datos: { asiento: turno.seat, baza: estado.currentTrick?.number ?? 0, fechaLimite },
  };
}
