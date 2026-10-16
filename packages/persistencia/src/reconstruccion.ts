/**
 * Reconstrucción y verificación de un juego guardado.
 *
 * Con los eventos del motor se vuelve a armar el juego completo (`createGame`
 * más un `evolve` por evento) y se compara con lo que quedó guardado aparte
 * (puntajes, ranking, estado). Si algo no coincide, el historial se dañó.
 */
import { checkInvariants, createGame, evolve, type GameState } from '@tokinoto/reglas';
import type { EventoGuardado, JuegoGuardado, PuntajeGuardado, Repositorio } from './tipos';

export function reconstruirJuego(juego: JuegoGuardado, eventos: readonly EventoGuardado[]): GameState {
  const creado = createGame(
    juego.jugadores.map((j) => ({ id: j.idJugador, name: j.nombre })),
    juego.config,
  );
  if (!creado.ok) throw new Error(`No se pudo recrear el juego ${juego.id}: ${creado.error.message}`);
  let estado = creado.value;
  for (const { evento } of eventos) estado = evolve(estado, evento);
  return estado;
}

/** Devuelve los problemas encontrados (vacío = el historial es consistente). */
export function verificarJuegoGuardado(juego: JuegoGuardado, eventos: readonly EventoGuardado[]): string[] {
  const problemas: string[] = [];
  const faltan = eventos.some((e, i) => e.seq !== i);
  if (faltan) problemas.push('El registro de eventos tiene saltos o repetidos');

  let estado: GameState;
  try {
    estado = reconstruirJuego(juego, eventos);
  } catch (problema) {
    return [...problemas, `No se pudo reconstruir: ${problema instanceof Error ? problema.message : String(problema)}`];
  }
  for (const p of checkInvariants(estado)) problemas.push(`Invariante rota: ${p}`);

  const esperadoPorEstado = { EN_CURSO: null, TERMINADO: 'FINISHED', ABORTADO: 'ABORTED' } as const;
  const faseEsperada = esperadoPorEstado[juego.estado];
  if (faseEsperada === null ? estado.phase === 'FINISHED' || estado.phase === 'ABORTED' : estado.phase !== faseEsperada) {
    problemas.push(`El estado guardado (${juego.estado}) no coincide con la fase reconstruida (${estado.phase})`);
  }
  if (juego.estado === 'ABORTADO' && juego.motivoAborto !== estado.abortReason) {
    problemas.push('El motivo de aborto guardado no coincide con el reconstruido');
  }

  const reconstruidos: PuntajeGuardado[] = [];
  estado.roundScores.forEach((porPartida, asiento) => {
    porPartida.forEach((puntos, i) => {
      reconstruidos.push({ partida: i + 1, asiento, apuesta: -1, bazasGanadas: -1, puntos });
    });
  });
  const clave = (p: { partida: number; asiento: number }) => `${p.partida}/${p.asiento}`;
  const guardados = new Map(juego.puntajes.map((p) => [clave(p), p]));
  if (guardados.size !== reconstruidos.length) {
    problemas.push(`Hay ${guardados.size} puntajes guardados y ${reconstruidos.length} reconstruidos`);
  }
  for (const r of reconstruidos) {
    const g = guardados.get(clave(r));
    if (!g) problemas.push(`Falta el puntaje de la partida ${r.partida}, asiento ${r.asiento}`);
    else if (g.puntos !== r.puntos) {
      problemas.push(`Partida ${r.partida}, asiento ${r.asiento}: guardado ${g.puntos} puntos y reconstruido ${r.puntos}`);
    }
  }

  const rankingReconstruido = estado.ranking ?? [];
  if (rankingReconstruido.length !== juego.ranking.length) {
    problemas.push('El ranking guardado no tiene la misma cantidad de puestos que el reconstruido');
  } else {
    for (const r of rankingReconstruido) {
      const g = juego.ranking.find((x) => x.asiento === r.seat);
      if (!g || g.total !== r.total || g.puesto !== r.position) {
        problemas.push(`Ranking distinto para el asiento ${r.seat}`);
      }
    }
  }
  return problemas;
}

/** Lee el juego y su registro del repositorio y lo verifica. */
export async function verificarJuego(repositorio: Repositorio, id: string): Promise<string[]> {
  const juego = await repositorio.obtenerJuego(id);
  if (!juego) return [`No existe el juego ${id}`];
  return verificarJuegoGuardado(juego, await repositorio.eventosDe(id));
}
