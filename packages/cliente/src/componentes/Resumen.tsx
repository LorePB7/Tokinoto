import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { useTienda } from '../estado/contexto';

/** Resultado de la partida que acaba de terminar. Avanza solo, salvo que el anfitrión lo pause. */
export function Resumen({ sala, juego }: { sala: VistaSala; juego: VistaJuego }) {
  const pausarResumen = useTienda((s) => s.pausarResumen);
  const ocupado = useTienda((s) => s.ocupado);
  if (juego.fase !== 'RESUMEN') return null;
  const soyAnfitrion = sala.anfitrion === sala.yo;
  const ultima = juego.partida === juego.totalPartidas;

  return (
    <section className="superposicion" aria-label="Resumen de la partida">
      <div className="hoja resumen">
        <h2>
          Terminó la partida {juego.partida} de {juego.totalPartidas}
        </h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              <th scope="col">Apostó</th>
              <th scope="col">Ganó</th>
              <th scope="col">Puntos</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {juego.asientos.map((a) => {
              const apuesta = juego.apuestas[a.asiento] ?? 0;
              const ganadas = juego.bazasGanadas[a.asiento] ?? 0;
              const puntos = juego.puntajes[a.asiento]?.[juego.partida - 1] ?? 0;
              const acerto = apuesta === ganadas;
              return (
                <tr key={a.asiento} className={a.asiento === juego.miAsiento ? 'yo' : ''}>
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
        <p className="nota">
          {sala.resumenPausado
            ? 'El resumen está en pausa.'
            : ultima
              ? 'En unos segundos se muestra el resultado final.'
              : 'La próxima partida empieza en unos segundos.'}
        </p>
        {soyAnfitrion && (
          <button type="button" className="boton secundario" disabled={ocupado} onClick={() => void pausarResumen(!sala.resumenPausado)}>
            {sala.resumenPausado ? 'Continuar' : 'Pausar'}
          </button>
        )}
      </div>
    </section>
  );
}
