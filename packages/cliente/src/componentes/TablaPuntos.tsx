import { buildRanking } from '@tokinoto/reglas';
import type { VistaJuego } from '@tokinoto/protocolo';

/**
 * Puntos de cada partida, de mayor a menor total (los empatados comparten lugar).
 * El total va antes que las partidas, para verlo sin desplazar la tabla.
 */
export function TablaPuntos({ juego }: { juego: VistaJuego }) {
  const filas = buildRanking(juego.puntajes);
  return (
    <div className="tabla-ancha tabla-puntos" tabIndex={0} role="region" aria-label="Tabla de puntos, se desplaza hacia el costado">
      <table>
        <thead>
          <tr>
            <th scope="col">Lugar</th>
            <th scope="col">Jugador</th>
            <th scope="col">Total</th>
            {Array.from({ length: juego.totalPartidas }, (_, i) => (
              <th scope="col" key={i} title={`Partida ${i + 1}`}>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const jugador = juego.asientos[fila.seat];
            if (!jugador) return null;
            const jugadas = juego.puntajes[fila.seat] ?? [];
            return (
              <tr key={fila.seat} className={fila.seat === juego.miAsiento ? 'yo' : ''} data-puesto={fila.position}>
                <td>{fila.position}</td>
                <th scope="row">{jugador.nombre}</th>
                <td className="total">{fila.total}</td>
                {Array.from({ length: juego.totalPartidas }, (_, i) => (
                  <td key={i} className={i < jugadas.length ? '' : 'pendiente'}>
                    {i < jugadas.length ? jugadas[i] : '–'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Contenido del panel de Puntos de la mesa. */
export function ContenidoPuntos({ juego }: { juego: VistaJuego }) {
  return (
    <div className="contenido-puntos">
      <p className="nota">
        {juego.partida > 0
          ? `Van ${Math.min(juego.partida, juego.totalPartidas)} de ${juego.totalPartidas} partidas. Mayor total arriba.`
          : 'Todavía no se jugó ninguna partida.'}
      </p>
      <TablaPuntos juego={juego} />
    </div>
  );
}
