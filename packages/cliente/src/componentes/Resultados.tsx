import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { useTienda } from '../estado/contexto';
import { TablaPuntos } from './TablaPuntos';

/** Resultado final del juego: ranking con podio compartido y puntaje de cada partida. */
export function Resultados({ sala, juego }: { sala: VistaSala; juego: VistaJuego }) {
  const revancha = useTienda((s) => s.revancha);
  const salir = useTienda((s) => s.salir);
  const ocupado = useTienda((s) => s.ocupado);
  if (juego.fase !== 'TERMINADO' && juego.fase !== 'ABORTADO') return null;
  const soyAnfitrion = sala.anfitrion === sala.yo;
  const nombreDe = (asiento: number) => juego.asientos[asiento]?.nombre ?? `Jugador ${asiento + 1}`;

  if (juego.fase === 'ABORTADO') {
    return (
      <section className="superposicion" aria-label="Juego cancelado">
        <div className="hoja">
          <h2>Se canceló el juego</h2>
          <p>{juego.motivoAborto}</p>
          <button type="button" className="boton" disabled={ocupado} onClick={() => void salir()}>
            Salir
          </button>
        </div>
      </section>
    );
  }

  const ranking = juego.ranking ?? [];
  const ganadores = ranking.filter((r) => r.puesto === 1);
  const compartido = ganadores.length > 1;
  const titulo = compartido
    ? `Ganan ${ganadores.map((r) => nombreDe(r.asiento)).join(' y ')}`
    : `Gana ${nombreDe(ganadores[0]?.asiento ?? 0)}`;

  return (
    <section className="superposicion" aria-label="Resultado final">
      <div className="hoja final">
        <h2>{titulo}</h2>
        {compartido && <p className="nota">El podio se comparte: empatan en el total y en todos sus mejores puntajes.</p>}
        <ol className="ranking">
          {ranking.map((r) => (
            <li key={r.asiento} className={r.asiento === juego.miAsiento ? 'yo' : ''} data-puesto={r.puesto}>
              <span className="puesto">{r.puesto}.º</span>
              <span className="jugador">{nombreDe(r.asiento)}</span>
              <span className="total">{r.total} puntos</span>
            </li>
          ))}
        </ol>
        <details>
          <summary>Puntos de cada partida</summary>
          <TablaPuntos juego={juego} />
        </details>
        <div className="acciones">
          {soyAnfitrion ? (
            <button type="button" className="boton" disabled={ocupado} onClick={() => void revancha()}>
              Jugar de nuevo
            </button>
          ) : (
            <p className="nota">Esperando que el anfitrión decida si juegan de nuevo.</p>
          )}
          <button type="button" className="boton secundario" disabled={ocupado} onClick={() => void salir()}>
            Salir
          </button>
        </div>
      </div>
    </section>
  );
}
