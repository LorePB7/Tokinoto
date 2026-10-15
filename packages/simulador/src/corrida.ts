import { estadisticasDe, estadisticasVacias, sumarEstadisticas, type Estadisticas } from './estadisticas';
import { simularJuego, type ResultadoJuego } from './juego';

export interface OpcionesCorrida {
  juegos: number;
  jugadores: number | 'todos';
  semilla: number;
  verificar: boolean;
  /** Se llama de vez en cuando con la cantidad de juegos ya simulados. */
  alAvanzar?: (hechos: number) => void;
}

export interface Fallo {
  indice: number;
  jugadores: number;
  semilla: number;
  violaciones: string[];
}

export interface ResultadoCorrida {
  opciones: Omit<OpcionesCorrida, 'alAvanzar'>;
  /** Estadísticas de los juegos que terminaron sin violaciones. */
  estadisticas: Estadisticas;
  fallos: Fallo[];
  duracionMs: number;
  /** El primer juego completo, para poder narrarlo. */
  primerJuego: ResultadoJuego | null;
}

/** Cantidad de jugadores del juego número `indice` (alterna de 4 a 7 con "todos"). */
export function jugadoresDelJuego(jugadores: number | 'todos', indice: number): number {
  return jugadores === 'todos' ? 4 + (indice % 4) : jugadores;
}

/** Simula muchos juegos seguidos. El juego número i usa la semilla `semilla + i`. */
export function ejecutarCorrida(opciones: OpcionesCorrida): ResultadoCorrida {
  const inicio = performance.now();
  let estadisticas = estadisticasVacias();
  const fallos: Fallo[] = [];
  let primerJuego: ResultadoJuego | null = null;
  const paso = Math.max(1, Math.floor(opciones.juegos / 20));

  for (let indice = 0; indice < opciones.juegos; indice++) {
    const jugadores = jugadoresDelJuego(opciones.jugadores, indice);
    const semilla = opciones.semilla + indice;
    const juego = simularJuego({ jugadores, semilla, verificar: opciones.verificar });
    if (indice === 0) primerJuego = juego;

    if (juego.violaciones.length > 0) {
      fallos.push({ indice, jugadores, semilla, violaciones: juego.violaciones });
    } else {
      estadisticas = sumarEstadisticas(estadisticas, estadisticasDe(juego));
    }
    if ((indice + 1) % paso === 0) opciones.alAvanzar?.(indice + 1);
  }

  const { alAvanzar: _alAvanzar, ...opcionesSinCallback } = opciones;
  return {
    opciones: opcionesSinCallback,
    estadisticas,
    fallos,
    duracionMs: performance.now() - inicio,
    primerJuego,
  };
}
