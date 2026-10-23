import { totalScores, type BotLevel } from '@tokinoto/reglas';
import { jugadoresDelJuego, type Fallo } from './corrida';
import { simularJuego } from './juego';

/** Un asiento lo ocupa un bot de un nivel o un jugador que tira al azar. */
export type Participante = BotLevel | 'azar';

export interface OpcionesTorneo {
  juegos: number;
  jugadores: number | 'todos';
  semilla: number;
  /**
   * Participantes que se reparten los asientos. En el juego número i, el
   * asiento s lo ocupa participantes[(s + i) % participantes.length], así
   * cada uno pasa por todas las posiciones de la mesa.
   */
  participantes: readonly Participante[];
  verificar?: boolean;
}

export interface FilaTorneo {
  participante: Participante;
  /** Asientos jugados (un asiento en un juego). */
  asientos: number;
  /** Promedio de puntos totales por juego. */
  puntosPorJuego: number;
  /** Porcentaje de partidas en las que acertó la apuesta. */
  aciertos: number;
}

export interface ResultadoTorneo {
  filas: FilaTorneo[];
  fallos: Fallo[];
  duracionMs: number;
}

/** Hace jugar a bots de distintos niveles entre sí y mide cuánto suma cada uno. */
export function jugarTorneo(opciones: OpcionesTorneo): ResultadoTorneo {
  const inicio = performance.now();
  const suma = new Map<Participante, { asientos: number; puntos: number; aciertos: number; partidas: number }>();
  const fallos: Fallo[] = [];
  const lista = opciones.participantes;

  for (let indice = 0; indice < opciones.juegos; indice++) {
    const jugadores = jugadoresDelJuego(opciones.jugadores, indice);
    const semilla = opciones.semilla + indice;
    const mesa = Array.from({ length: jugadores }, (_, s) => lista[(s + indice) % lista.length] as Participante);
    const juego = simularJuego({
      jugadores,
      semilla,
      verificar: opciones.verificar ?? false,
      niveles: mesa.map((p) => (p === 'azar' ? null : p)),
    });
    if (juego.violaciones.length > 0 || !juego.final) {
      fallos.push({ indice, jugadores, semilla, violaciones: juego.violaciones });
      continue;
    }
    const totales = totalScores(juego.final);
    mesa.forEach((p, s) => {
      const fila = suma.get(p) ?? { asientos: 0, puntos: 0, aciertos: 0, partidas: 0 };
      const porPartida = juego.final?.roundScores[s] ?? [];
      fila.asientos++;
      fila.puntos += totales[s] ?? 0;
      fila.aciertos += porPartida.filter((x) => x > 0).length;
      fila.partidas += porPartida.length;
      suma.set(p, fila);
    });
  }

  const filas = [...new Set(lista)].map((participante) => {
    const f = suma.get(participante) ?? { asientos: 0, puntos: 0, aciertos: 0, partidas: 0 };
    return {
      participante,
      asientos: f.asientos,
      puntosPorJuego: f.asientos ? f.puntos / f.asientos : 0,
      aciertos: f.partidas ? (100 * f.aciertos) / f.partidas : 0,
    };
  });
  return { filas, fallos, duracionMs: performance.now() - inicio };
}
