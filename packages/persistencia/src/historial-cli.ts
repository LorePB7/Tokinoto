/**
 * Consulta del historial desde la terminal (solo lectura).
 *
 *   DATABASE_URL=postgres://... npm run historial -w @tokinoto/persistencia -- listar [--sala CODIGO] [--limite 20]
 *   ... -- ver <idJuego>
 *   ... -- verificar <idJuego | todos>
 */
import { parseArgs } from 'node:util';
import { abrirRepositorioPostgres } from './conexion';
import { verificarJuego } from './reconstruccion';

const AYUDA = `Historial de Tokinoto (necesita DATABASE_URL)

  listar [--sala CODIGO] [--limite N]   Juegos guardados, del más nuevo al más viejo
  ver <idJuego>                         Puntajes y ranking de un juego
  verificar <idJuego | todos>           Reconstruye el juego desde sus eventos y lo compara con lo guardado`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { sala: { type: 'string' }, limite: { type: 'string', default: '20' } },
});
const [comando, argumento] = positionals;
const url = process.env['DATABASE_URL'];
if (!comando || !url) {
  console.log(AYUDA);
  process.exit(comando ? 1 : 0);
}

const repo = await abrirRepositorioPostgres(url, { maxConexiones: 1 });
let codigoSalida = 0;
try {
  if (comando === 'listar') {
    const juegos = await repo.listarJuegos({
      limite: Number(values.limite),
      ...(values.sala === undefined ? {} : { sala: values.sala }),
    });
    for (const j of juegos) {
      const motivo = j.motivoAborto ? ` (${j.motivoAborto})` : '';
      console.log(`${j.id}  ${j.sala}  ${j.estado}${motivo}  ${j.cantidadJugadores} jugadores  ${j.iniciadoEn.toISOString()}`);
    }
    if (juegos.length === 0) console.log('No hay juegos guardados.');
  } else if (comando === 'ver' && argumento) {
    const juego = await repo.obtenerJuego(argumento);
    if (!juego) throw new Error(`No existe el juego ${argumento}`);
    console.log(`Juego ${juego.id} - sala ${juego.sala} - ${juego.estado}${juego.motivoAborto ? ` (${juego.motivoAborto})` : ''}`);
    for (const r of juego.ranking) {
      const nombre = juego.jugadores.find((j) => j.asiento === r.asiento)?.nombre ?? `Asiento ${r.asiento}`;
      console.log(`  ${r.puesto}. ${nombre}: ${r.total} puntos`);
    }
    const partidas = new Set(juego.puntajes.map((p) => p.partida)).size;
    console.log(`  Partidas puntuadas: ${partidas} de ${juego.totalPartidas}`);
  } else if (comando === 'verificar' && argumento) {
    const ids = argumento === 'todos' ? (await repo.listarJuegos({ limite: 100_000 })).map((j) => j.id) : [argumento];
    for (const id of ids) {
      const problemas = await verificarJuego(repo, id);
      if (problemas.length > 0) codigoSalida = 1;
      console.log(`${problemas.length === 0 ? 'OK ' : 'MAL'} ${id}${problemas.map((p) => `\n     - ${p}`).join('')}`);
    }
  } else {
    console.log(AYUDA);
    codigoSalida = 1;
  }
} catch (problema) {
  console.error(problema instanceof Error ? problema.message : problema);
  codigoSalida = 1;
} finally {
  await repo.cerrar();
}
process.exit(codigoSalida);
