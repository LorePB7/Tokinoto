/**
 * Pruebas de la regla de oro: ninguna vista contiene cartas ajenas.
 * Se recorren miles de estados reales (juegos completos con jugadas al azar)
 * y, en cada uno, se arma la vista de cada jugador.
 */
import {
  apply,
  createGame,
  createSeededRng,
  currentTurn,
  forbiddenBetFor,
  getCardById,
  playableCards,
  totalScores,
  validBetsFor,
  type Action,
  type GameState,
  type Rng,
} from '@tokinoto/reglas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { proyectarJuego, repitenEnSorteo, type VistaJuego } from '../src/vista';

/** Todos los identificadores de carta que aparecen en un valor (búsqueda profunda). */
export function cartasEn(valor: unknown, encontradas: string[] = []): string[] {
  if (typeof valor === 'string') {
    if (getCardById(valor)) encontradas.push(valor);
  } else if (Array.isArray(valor)) {
    for (const item of valor) cartasEn(item, encontradas);
  } else if (typeof valor === 'object' && valor !== null) {
    for (const item of Object.values(valor)) cartasEn(item, encontradas);
  }
  return encontradas;
}

function elegir<T>(opciones: readonly T[], rng: Rng): T {
  const elegido = opciones[rng.nextInt(opciones.length)];
  if (elegido === undefined) throw new Error('Sin opciones');
  return elegido;
}

/** Recorre un juego completo con jugadas legales al azar y llama a `visitar` en cada estado. */
function recorrerJuego(jugadores: number, semilla: number, visitar: (estado: GameState) => void): GameState {
  const creado = createGame(Array.from({ length: jugadores }, (_, i) => ({ id: `j${i}`, name: `Jugador ${i + 1}` })));
  if (!creado.ok) throw new Error(creado.error.message);
  let estado = creado.value;
  const azarDelJuego = createSeededRng(semilla);
  const azarDeJugadas = createSeededRng(semilla + 7919);
  visitar(estado);
  while (estado.phase !== 'FINISHED') {
    const turno = currentTurn(estado);
    let accion: Action;
    if (estado.phase === 'READY_TO_START') accion = { type: 'INICIAR_JUEGO' };
    else if (estado.phase === 'DEALER_DRAW') accion = { type: 'SORTEAR_REPARTIDOR' };
    else if (!turno) accion = { type: 'AVANZAR' };
    else {
      const playerId = estado.players[turno.seat]!.id;
      accion =
        turno.kind === 'bet'
          ? { type: 'APOSTAR', playerId, value: elegir(validBetsFor(estado, turno.seat), azarDeJugadas) }
          : { type: 'JUGAR_CARTA', playerId, cardId: elegir(playableCards(estado, turno.seat), azarDeJugadas).id };
    }
    const resultado = apply(estado, accion, azarDelJuego);
    if (!resultado.ok) throw new Error(`${accion.type}: ${resultado.error.message}`);
    estado = resultado.state;
    visitar(estado);
  }
  return estado;
}

/** Cartas que cualquiera puede ver en este estado (sin contar el sorteo). */
function cartasPublicas(estado: GameState): Set<string> {
  const publicas = new Set<string>();
  for (const tirada of estado.currentTrick?.plays ?? []) publicas.add(tirada.card.id);
  for (const cerrada of estado.wonTricks) publicas.add(cerrada.winningCard.id);
  return publicas;
}

/** Comprueba la regla de oro para un jugador en un estado. Devuelve los problemas encontrados. */
function problemasDeVista(estado: GameState, asiento: number, vista: VistaJuego): string[] {
  const problemas: string[] = [];
  const propias = new Set((estado.hands[asiento] ?? []).map((c) => c.id));
  const publicas = cartasPublicas(estado);

  // El sorteo es público y se compara aparte: sus cartas vuelven al mazo y pueden repartirse después.
  const { sorteo, ...resto } = vista;
  for (const carta of cartasEn(resto)) {
    if (!propias.has(carta) && !publicas.has(carta)) problemas.push(`ve ${carta}, que no es suya ni pública`);
  }
  estado.hands.forEach((mano, otro) => {
    if (otro === asiento) return;
    const vistas = new Set(cartasEn(resto));
    for (const carta of mano) {
      if (vistas.has(carta.id)) problemas.push(`ve ${carta.id}, de la mano del asiento ${otro}`);
    }
  });
  const sorteoEsperado = estado.dealerDraw.map((vuelta) => ({
    sacadas: vuelta.draws.map((d) => ({ asiento: d.seat, carta: d.card.id })),
    repiten: repitenEnSorteo(vuelta.draws),
  }));
  if (JSON.stringify(sorteo) !== JSON.stringify(sorteoEsperado)) problemas.push('el sorteo no coincide');
  return problemas;
}

describe('proyectarJuego: la regla de oro', () => {
  it('en cada estado de juegos completos, nadie ve cartas ajenas (propiedad)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 7 }), fc.integer({ min: 1, max: 2 ** 30 }), (jugadores, semilla) => {
        let estados = 0;
        recorrerJuego(jugadores, semilla, (estado) => {
          estados++;
          estado.players.forEach((jugador, asiento) => {
            const vista = proyectarJuego(estado, jugador.id);
            expect(problemasDeVista(estado, asiento, vista)).toEqual([]);
          });
        });
        expect(estados).toBeGreaterThan(200);
      }),
      { numRuns: 25 },
    );
  });

  it('muestra la mano propia completa y de los demás solo la cantidad', () => {
    recorrerJuego(5, 11, (estado) => {
      estado.players.forEach((jugador, asiento) => {
        const vista = proyectarJuego(estado, jugador.id);
        expect(vista.miAsiento).toBe(asiento);
        expect(vista.miMano).toEqual((estado.hands[asiento] ?? []).map((c) => c.id));
        expect(vista.cantidades).toEqual(estado.hands.map((m) => m.length));
      });
    });
  });

  it('refleja los datos públicos: apuestas, bazas, puntajes, turno y ranking', () => {
    const final = recorrerJuego(6, 23, (estado) => {
      const vista = proyectarJuego(estado, estado.players[2]!.id);
      expect(vista.apuestas).toEqual(estado.bets);
      expect(vista.bazasGanadas).toEqual(estado.tricksWon);
      expect(vista.totales).toEqual(totalScores(estado));
      expect(vista.partida).toBe(estado.roundNumber);
      expect(vista.cartasPorJugador).toBe(estado.cardsPerPlayer);
      expect(vista.repartidor).toBe(estado.dealerSeat);
      expect(vista.bazasCerradas.map((b) => b.cartaGanadora)).toEqual(estado.wonTricks.map((b) => b.winningCard.id));
      const turno = currentTurn(estado);
      if (!turno) expect(vista.turno).toBeNull();
      else if (turno.kind === 'bet') {
        expect(vista.turno).toEqual({
          tipo: 'apuesta',
          asiento: turno.seat,
          valorProhibido: forbiddenBetFor(estado, turno.seat),
          fechaLimite: null,
        });
      } else expect(vista.turno).toEqual({ tipo: 'carta', asiento: turno.seat, fechaLimite: null });
    });
    const vista = proyectarJuego(final, 'j0');
    expect(vista.fase).toBe('TERMINADO');
    expect(vista.ranking).toHaveLength(6);
    expect(vista.puntajes.every((p) => p.length === 14)).toBe(true);
  });

  it('pasa por todas las fases visibles', () => {
    const fases = new Set<string>();
    recorrerJuego(4, 3, (estado) => fases.add(proyectarJuego(estado, 'j0').fase));
    expect([...fases].sort()).toEqual(['APUESTAS', 'BAZA_RESUELTA', 'RESUMEN', 'SORTEO', 'TERMINADO', 'TIRADAS']);
  });

  it('no modifica el estado ni comparte referencias con él', () => {
    recorrerJuego(4, 5, (estado) => {
      if (estado.phase !== 'PLAYING') return;
      const copia = structuredClone(estado);
      const vista = proyectarJuego(estado, 'j1');
      vista.apuestas[0] = 99;
      vista.miMano.pop();
      vista.puntajes[0]?.push(99);
      vista.bazaActual?.tiradas.pop();
      expect(estado).toEqual(copia);
    });
  });

  it('falla si el jugador no participa', () => {
    const creado = createGame(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })));
    if (!creado.ok) throw new Error('no se creó');
    expect(() => proyectarJuego(creado.value, 'intruso')).toThrow(/no participa/);
  });

  it('la vista abortada muestra el motivo y no tiene turno', () => {
    const creado = createGame(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })));
    if (!creado.ok) throw new Error('no se creó');
    const rng = createSeededRng(1);
    let estado = creado.value;
    for (const accion of [{ type: 'INICIAR_JUEGO' }, { type: 'SORTEAR_REPARTIDOR' }] as const) {
      const r = apply(estado, accion, rng);
      if (!r.ok) throw new Error(r.error.message);
      estado = r.state;
    }
    const abortado = apply(estado, { type: 'ABORTAR_JUEGO', reason: 'Prueba' }, rng);
    if (!abortado.ok) throw new Error(abortado.error.message);
    const vista = proyectarJuego(abortado.state, 'a');
    expect(vista).toMatchObject({ fase: 'ABORTADO', motivoAborto: 'Prueba', turno: null });
  });
});
