import { buildRanking } from '@tokinoto/reglas';
import type { VistaJuego } from '@tokinoto/protocolo';
import { segundosRestantes, useHoraServidor } from '../util/reloj';

/** Resultado de la partida que acaba de terminar. Avanza solo a los 6 s, con una cuenta regresiva (DP-23). */
export function Resumen({ juego }: { juego: VistaJuego }) {
  const ahora = useHoraServidor();
  if (juego.fase !== 'RESUMEN') return null;
  const segundos = juego.finResumen === null ? null : segundosRestantes(juego.finResumen, ahora);
  const ultima = juego.partida === juego.totalPartidas;
  // De mayor a menor total; los empatados comparten lugar.
  const filas = buildRanking(juego.puntajes);

  return (
    <section className="superposicion" aria-label="Resumen de la partida">
      <div className="hoja resumen">
        <h2>
          Terminó la partida {juego.partida} de {juego.totalPartidas}
        </h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Lugar</th>
              <th scope="col">Jugador</th>
              <th scope="col">Apostó</th>
              <th scope="col">Ganó</th>
              <th scope="col">Puntos</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const a = juego.asientos[fila.seat];
              if (!a) return null;
              const apuesta = juego.apuestas[a.asiento] ?? 0;
              const ganadas = juego.bazasGanadas[a.asiento] ?? 0;
              const puntos = juego.puntajes[a.asiento]?.[juego.partida - 1] ?? 0;
              const acerto = apuesta === ganadas;
              return (
                <tr key={a.asiento} className={a.asiento === juego.miAsiento ? 'yo' : ''}>
                  <td>{fila.position}</td>
                  <th scope="row">{a.nombre}</th>
                  <td>{apuesta}</td>
                  <td>{ganadas}</td>
                  <td className={acerto ? 'acierto' : 'fallo'}>{acerto ? `+${puntos}` : '0'}</td>
                  <td>{juego.totales[a.asiento] ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="nota cuenta-resumen">
          {ultima ? 'El resultado final se muestra en' : 'La próxima partida empieza en'}{' '}
          <strong role="timer" aria-label={segundos === null ? 'unos segundos' : `${segundos} segundos`}>
            {segundos ?? '…'}
          </strong>
        </p>
      </div>
    </section>
  );
}
