import { parseArgs } from 'node:util';
import { BOT_LEVELS } from '@tokinoto/reglas';
import { jugarTorneo, type Participante } from './torneo';

/**
 * Torneo entre niveles de bot, para medir y ajustar su fuerza.
 *   npm run torneo -w @tokinoto/simulador -- --juegos 200 --jugadores todos --niveles facil,medio,dificil
 */
function main(): number {
  const { values } = parseArgs({
    options: {
      juegos: { type: 'string', default: '200' },
      jugadores: { type: 'string', default: 'todos' },
      semilla: { type: 'string', default: '1' },
      niveles: { type: 'string', default: BOT_LEVELS.join(',') },
    },
  });
  const participantes = values.niveles.split(',').map((x) => x.trim()) as Participante[];
  const validos = [...BOT_LEVELS, 'azar'];
  const juegos = Number(values.juegos);
  const jugadores = values.jugadores === 'todos' ? 'todos' : Number(values.jugadores);
  if (participantes.some((p) => !validos.includes(p)) || !Number.isInteger(juegos) || juegos < 1) {
    console.error(`Uso: --juegos N --jugadores 4..7|todos --niveles ${validos.join(',')}`);
    return 2;
  }
  if (jugadores !== 'todos' && (!Number.isInteger(jugadores) || jugadores < 4 || jugadores > 7)) {
    console.error('--jugadores debe ser de 4 a 7, o "todos"');
    return 2;
  }
  const r = jugarTorneo({ juegos, jugadores, semilla: Number(values.semilla), participantes });
  console.log(`Torneo: ${juegos} juegos, ${jugadores} jugadores (${(r.duracionMs / 1000).toFixed(1)} s)\n`);
  console.log('Nivel      Puntos por juego   Aciertos');
  for (const f of [...r.filas].sort((a, b) => b.puntosPorJuego - a.puntosPorJuego)) {
    console.log(`${f.participante.padEnd(10)} ${f.puntosPorJuego.toFixed(1).padStart(16)}   ${f.aciertos.toFixed(1).padStart(7)} %`);
  }
  if (r.fallos.length > 0) {
    console.error(`\n${r.fallos.length} juegos con violaciones. Primero:`, r.fallos[0]);
    return 1;
  }
  return 0;
}

process.exitCode = main();
