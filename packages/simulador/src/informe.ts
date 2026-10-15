import type { ResultadoCorrida } from './corrida';
import { formatearDecimal, formatearEntero, formatearPorcentaje } from './formato';

const MAX_FALLOS_MOSTRADOS = 5;
const MAX_VIOLACIONES_POR_FALLO = 3;

export function comandoParaReproducir(jugadores: number, semilla: number): string {
  return `npm run simular -w @tokinoto/simulador -- --juegos 1 --jugadores ${jugadores} --semilla ${semilla} --detalle`;
}

/** Informe final de una corrida, en líneas de texto. */
export function formatearInforme(corrida: ResultadoCorrida): string[] {
  const { opciones, estadisticas: e, fallos } = corrida;
  const segundos = corrida.duracionMs / 1000;
  const lineas: string[] = [];

  const jugadores = opciones.jugadores === 'todos' ? '4 a 7' : String(opciones.jugadores);
  lineas.push(
    `Simulación de ${formatearEntero(opciones.juegos)} ${opciones.juegos === 1 ? 'juego' : 'juegos'} · ` +
      `jugadores: ${jugadores} · semilla inicial ${opciones.semilla} · ` +
      `invariantes tras cada acción: ${opciones.verificar ? 'sí' : 'no'}`,
  );
  lineas.push('');

  if (fallos.length === 0) {
    lineas.push(`✔ ${formatearEntero(e.juegos)} juegos completos sin ninguna violación de las reglas`);
  } else {
    lineas.push(
      `✘ ${formatearEntero(fallos.length)} de ${formatearEntero(opciones.juegos)} juegos violaron las reglas ` +
        `(${formatearEntero(e.juegos)} terminaron bien)`,
    );
  }
  const velocidad = segundos > 0 ? ` (${formatearDecimal(opciones.juegos / segundos)} juegos por segundo)` : '';
  lineas.push(
    `Tiempo: ${formatearDecimal(segundos)} s${velocidad} · ${formatearEntero(e.acciones)} acciones procesadas`,
  );

  if (e.juegos > 0) {
    lineas.push('');
    lineas.push('Qué pasó en los juegos completos (jugadas al azar: sirve para comprobar el motor, no para balancear el juego)');
    lineas.push(`  Partidas jugadas: ${formatearEntero(e.partidas)} · bazas resueltas: ${formatearEntero(e.bazas)}`);
    lineas.push(`  Aciertos exactos: ${formatearPorcentaje(e.aciertosExactos, e.puntajes)} de los puntajes individuales`);
    const tamanos = Object.keys(e.porTamano)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => `${n} ${n === 1 ? 'carta' : 'cartas'}: ${formatearPorcentaje(e.porTamano[n]!.aciertos, e.porTamano[n]!.total)}`);
    lineas.push(`    por tamaño de partida → ${tamanos.join(' · ')}`);
    lineas.push(`  El Pié tuvo un valor prohibido: ${formatearPorcentaje(e.pieConRestriccion, e.partidas)} de las partidas`);
    lineas.push(`  Bazas ganadas por el Mano: ${formatearPorcentaje(e.bazasGanadasPorElMano, e.bazas)}`);
    lineas.push(`  Bazas ganadas por el Comodín: ${formatearPorcentaje(e.bazasGanadasPorElComodin, e.bazas)}`);
    lineas.push(`  Sorteos del repartidor con repetición por empate: ${formatearPorcentaje(e.juegosConSorteoRepetido, e.juegos)} de los juegos`);
    lineas.push(`  Podios compartidos: ${formatearEntero(e.podiosCompartidos)} ${e.podiosCompartidos === 1 ? 'juego' : 'juegos'}`);
    lineas.push(
      `  Puntaje del ganador: promedio ${formatearDecimal(e.puntajeGanador.suma / e.juegos)} · ` +
        `mínimo ${e.puntajeGanador.min} · máximo ${e.puntajeGanador.max}`,
    );
  }

  if (fallos.length > 0) {
    lineas.push('');
    lineas.push(`Juegos con violaciones (primeros ${Math.min(fallos.length, MAX_FALLOS_MOSTRADOS)}):`);
    for (const fallo of fallos.slice(0, MAX_FALLOS_MOSTRADOS)) {
      lineas.push(`  Juego ${fallo.indice + 1} · ${fallo.jugadores} jugadores · semilla ${fallo.semilla}`);
      for (const violacion of fallo.violaciones.slice(0, MAX_VIOLACIONES_POR_FALLO)) {
        lineas.push(`    - ${violacion}`);
      }
      lineas.push(`    Para reproducirlo: ${comandoParaReproducir(fallo.jugadores, fallo.semilla)}`);
    }
  }
  return lineas;
}
