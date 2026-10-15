import { winnersOf } from '@tokinoto/reglas';
import type { ResultadoJuego } from './juego';

export interface AciertosPorTamano {
  aciertos: number;
  total: number;
}

export interface Estadisticas {
  juegos: number;
  acciones: number;
  partidas: number;
  /** Puntajes individuales evaluados (jugadores x partidas). */
  puntajes: number;
  aciertosExactos: number;
  porTamano: Record<number, AciertosPorTamano>;
  /** Partidas en las que el Pié tuvo un valor prohibido dentro de 0..N. */
  pieConRestriccion: number;
  bazas: number;
  bazasGanadasPorElMano: number;
  bazasGanadasPorElComodin: number;
  juegosConSorteoRepetido: number;
  podiosCompartidos: number;
  puntajeGanador: { suma: number; min: number; max: number };
}

export function estadisticasVacias(): Estadisticas {
  return {
    juegos: 0,
    acciones: 0,
    partidas: 0,
    puntajes: 0,
    aciertosExactos: 0,
    porTamano: {},
    pieConRestriccion: 0,
    bazas: 0,
    bazasGanadasPorElMano: 0,
    bazasGanadasPorElComodin: 0,
    juegosConSorteoRepetido: 0,
    podiosCompartidos: 0,
    puntajeGanador: { suma: 0, min: Number.POSITIVE_INFINITY, max: 0 },
  };
}

/** Estadísticas de un único juego, calculadas a partir de sus eventos. */
export function estadisticasDe(juego: ResultadoJuego): Estadisticas {
  const e = estadisticasVacias();
  e.juegos = 1;
  e.acciones = juego.pasos;

  let repartidor = -1;
  let cartas = 0;
  let apuestas: number[] = [];
  let mano = -1;
  let vueltasSorteo = 0;

  for (const evento of juego.eventos) {
    switch (evento.type) {
      case 'SORTEO_RONDA':
        vueltasSorteo++;
        break;
      case 'PARTIDA_INICIADA':
        repartidor = evento.dealerSeat;
        cartas = evento.cardsPerPlayer;
        apuestas = [];
        break;
      case 'APUESTA_REALIZADA': {
        if (evento.seat === repartidor) {
          const prohibido = cartas - apuestas.reduce((acc, apuesta) => acc + apuesta, 0);
          if (prohibido >= 0 && prohibido <= cartas) e.pieConRestriccion++;
        }
        apuestas.push(evento.value);
        break;
      }
      case 'BAZA_INICIADA':
        mano = evento.leadSeat;
        break;
      case 'BAZA_RESUELTA':
        e.bazas++;
        if (evento.winnerSeat === mano) e.bazasGanadasPorElMano++;
        if (evento.winningCard.isJoker) e.bazasGanadasPorElComodin++;
        break;
      case 'PARTIDA_PUNTUADA': {
        e.partidas++;
        const tamano = (e.porTamano[cartas] ??= { aciertos: 0, total: 0 });
        for (const resultado of evento.results) {
          e.puntajes++;
          tamano.total++;
          if (resultado.points > 0) {
            e.aciertosExactos++;
            tamano.aciertos++;
          }
        }
        break;
      }
      case 'JUEGO_TERMINADO': {
        const ganadores = winnersOf(evento.ranking);
        if (ganadores.length > 1) e.podiosCompartidos++;
        const total = ganadores[0]?.total ?? 0;
        e.puntajeGanador = { suma: total, min: total, max: total };
        break;
      }
      default:
        break;
    }
  }
  if (vueltasSorteo > 1) e.juegosConSorteoRepetido = 1;
  return e;
}

/** Suma dos estadísticas (para acumular los resultados de muchos juegos). */
export function sumarEstadisticas(a: Estadisticas, b: Estadisticas): Estadisticas {
  const porTamano: Record<number, AciertosPorTamano> = {};
  for (const fuente of [a.porTamano, b.porTamano]) {
    for (const [tamano, valores] of Object.entries(fuente)) {
      const actual = (porTamano[Number(tamano)] ??= { aciertos: 0, total: 0 });
      actual.aciertos += valores.aciertos;
      actual.total += valores.total;
    }
  }
  return {
    juegos: a.juegos + b.juegos,
    acciones: a.acciones + b.acciones,
    partidas: a.partidas + b.partidas,
    puntajes: a.puntajes + b.puntajes,
    aciertosExactos: a.aciertosExactos + b.aciertosExactos,
    porTamano,
    pieConRestriccion: a.pieConRestriccion + b.pieConRestriccion,
    bazas: a.bazas + b.bazas,
    bazasGanadasPorElMano: a.bazasGanadasPorElMano + b.bazasGanadasPorElMano,
    bazasGanadasPorElComodin: a.bazasGanadasPorElComodin + b.bazasGanadasPorElComodin,
    juegosConSorteoRepetido: a.juegosConSorteoRepetido + b.juegosConSorteoRepetido,
    podiosCompartidos: a.podiosCompartidos + b.podiosCompartidos,
    puntajeGanador: {
      suma: a.puntajeGanador.suma + b.puntajeGanador.suma,
      min: Math.min(a.puntajeGanador.min, b.puntajeGanador.min),
      max: Math.max(a.puntajeGanador.max, b.puntajeGanador.max),
    },
  };
}
