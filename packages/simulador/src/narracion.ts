import type { Card, RankingEntry } from '@tokinoto/reglas';
import { textoCarta } from './formato';
import type { ResultadoJuego } from './juego';

/**
 * Cuenta un juego completo en líneas de texto legibles: sorteo, manos,
 * apuestas, cada baza, puntajes por partida y ranking final.
 * Muestra TODAS las cartas (es una herramienta de desarrollo, no de juego).
 */
export function narrarJuego(juego: ResultadoJuego): string[] {
  const nombres = juego.inicial?.players.map((jugador) => jugador.name) ?? [];
  const nombre = (asiento: number): string => nombres[asiento] ?? `Asiento ${asiento}`;
  const lineas: string[] = [];
  const acumulado: number[] = nombres.map(() => 0);

  let repartidor = -1;
  let apuestas: { asiento: number; valor: number }[] = [];
  let tiradas: { asiento: number; carta: Card }[] = [];
  let mano = -1;
  let cartasPorJugador = 0;
  let vueltaSorteo = 0;

  lineas.push(`Juego de ${juego.jugadores} jugadores · semilla ${juego.semilla}`);

  for (const evento of juego.eventos) {
    switch (evento.type) {
      case 'SORTEO_RONDA': {
        vueltaSorteo++;
        const sacadas = evento.draws.map((s) => `${nombre(s.seat)} ${textoCarta(s.card)}`).join(' · ');
        lineas.push(`Sorteo del repartidor, vuelta ${vueltaSorteo}: ${sacadas}`);
        break;
      }
      case 'REPARTIDOR_DEFINIDO':
        lineas.push(`Empieza repartiendo ${nombre(evento.dealerSeat)}`);
        break;
      case 'PARTIDA_INICIADA': {
        repartidor = evento.dealerSeat;
        cartasPorJugador = evento.cardsPerPlayer;
        apuestas = [];
        lineas.push('');
        lineas.push(
          `── Partida ${evento.roundNumber} · ${evento.cardsPerPlayer} ${evento.cardsPerPlayer === 1 ? 'carta' : 'cartas'} por jugador · ` +
            `reparte ${nombre(evento.dealerSeat)} (Pié) · abre ${nombre(evento.leadSeat)}`,
        );
        evento.hands.forEach((cartas, asiento) => {
          lineas.push(`   ${nombre(asiento)}: ${cartas.map(textoCarta).join(' ')}`);
        });
        break;
      }
      case 'APUESTA_REALIZADA':
        apuestas.push({ asiento: evento.seat, valor: evento.value });
        break;
      case 'BAZA_INICIADA':
        mano = evento.leadSeat;
        tiradas = [];
        if (evento.trickNumber === 1) {
          const detalle = apuestas
            .map((a) => `${nombre(a.asiento)} ${a.valor}${a.asiento === repartidor ? ' (Pié)' : ''}`)
            .join(' · ');
          lineas.push(`   Apuestas: ${detalle}`);
        }
        break;
      case 'CARTA_JUGADA':
        tiradas.push({ asiento: evento.seat, carta: evento.card });
        break;
      case 'BAZA_RESUELTA': {
        const jugadas = tiradas.map((t) => `${nombre(t.asiento)} ${textoCarta(t.carta)}`).join(' · ');
        lineas.push(
          `   Baza ${evento.trickNumber}/${cartasPorJugador} (abre ${nombre(mano)}): ${jugadas} → ` +
            `gana ${nombre(evento.winnerSeat)} con ${textoCarta(evento.winningCard)}` +
            (evento.hasChip ? ' (con ficha)' : ' (sin ficha)'),
        );
        break;
      }
      case 'PARTIDA_PUNTUADA': {
        const resultados = evento.results.map((r) => {
          acumulado[r.seat] = (acumulado[r.seat] ?? 0) + r.points;
          return `${nombre(r.seat)} apostó ${r.bet}, ganó ${r.tricksWon} → ${r.points}`;
        });
        lineas.push(`   Puntos: ${resultados.join(' | ')}`);
        lineas.push(`   Acumulado: ${acumulado.map((total, asiento) => `${nombre(asiento)} ${total}`).join(' · ')}`);
        break;
      }
      case 'JUEGO_TERMINADO':
        lineas.push('');
        lineas.push('══ Ranking final');
        lineas.push(...narrarRanking(evento.ranking, nombre));
        break;
      default:
        break;
    }
  }

  if (juego.violaciones.length > 0) {
    lineas.push('');
    lineas.push('✘ Violaciones detectadas:');
    for (const violacion of juego.violaciones) lineas.push(`   - ${violacion}`);
  }
  return lineas;
}

function narrarRanking(ranking: readonly RankingEntry[], nombre: (asiento: number) => string): string[] {
  const compartidos = new Set(
    ranking.filter((a) => ranking.filter((b) => b.position === a.position).length > 1).map((a) => a.position),
  );
  return ranking.map(
    (entrada) =>
      `   ${entrada.position}.º ${nombre(entrada.seat)}: ${entrada.total} puntos` +
      (compartidos.has(entrada.position) ? ' (puesto compartido)' : ''),
  );
}
