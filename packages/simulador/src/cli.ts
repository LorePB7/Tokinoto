import { AYUDA, leerArgumentos } from './argumentos';
import { ejecutarCorrida } from './corrida';
import { formatearInforme } from './informe';
import { narrarJuego } from './narracion';

function main(): number {
  let argumentos;
  try {
    argumentos = leerArgumentos(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Usá --ayuda para ver las opciones.');
    return 2;
  }
  if (argumentos.ayuda) {
    console.log(AYUDA);
    return 0;
  }

  const mostrarProgreso = process.stderr.isTTY && argumentos.juegos >= 100;
  const corrida = ejecutarCorrida({
    juegos: argumentos.juegos,
    jugadores: argumentos.jugadores,
    semilla: argumentos.semilla,
    verificar: argumentos.verificar,
    ...(mostrarProgreso
      ? { alAvanzar: (hechos: number) => process.stderr.write(`\r  ${hechos} / ${argumentos.juegos} juegos…`) }
      : {}),
  });
  if (mostrarProgreso) process.stderr.write('\r' + ' '.repeat(40) + '\r');

  if (argumentos.detalle && corrida.primerJuego) {
    console.log(narrarJuego(corrida.primerJuego).join('\n'));
    console.log('\n' + '─'.repeat(60) + '\n');
  }
  console.log(formatearInforme(corrida).join('\n'));
  return corrida.fallos.length === 0 ? 0 : 1;
}

process.exitCode = main();
