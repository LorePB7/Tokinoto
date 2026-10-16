import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { Mano } from '../componentes/Mano';
import { MesaRedonda } from '../componentes/MesaRedonda';
import { Registro } from '../componentes/Registro';
import { Resultados } from '../componentes/Resultados';
import { Resumen } from '../componentes/Resumen';

export function mensajeDeTurno(juego: VistaJuego): string {
  const nombre = (asiento: number) => juego.asientos[asiento]?.nombre ?? `Jugador ${asiento + 1}`;
  const turno = juego.turno;
  const meToca = turno?.asiento === juego.miAsiento;
  switch (juego.fase) {
    case 'SORTEO':
      return 'Sorteando quién reparte';
    case 'APUESTAS':
      return !turno ? 'Esperando las apuestas' : meToca ? 'Te toca apostar' : `Apuesta ${nombre(turno.asiento)}`;
    case 'TIRADAS':
      return !turno ? 'Esperando la jugada' : meToca ? 'Te toca jugar una carta' : `Juega ${nombre(turno.asiento)}`;
    case 'BAZA_RESUELTA': {
      const ganador = juego.bazaActual?.ganador;
      return ganador === null || ganador === undefined ? 'Se resolvió la baza' : `${nombre(ganador)} gana la baza`;
    }
    case 'RESUMEN':
      return `Terminó la partida ${juego.partida}`;
    case 'TERMINADO':
      return 'Terminó el juego';
    case 'ABORTADO':
      return 'Se canceló el juego';
  }
}

/** Mesa de juego: la mesa redonda, mis cartas, la apuesta y el registro. */
export function Mesa({ sala, juego }: { sala: VistaSala; juego: VistaJuego }) {
  const meToca = juego.turno?.asiento === juego.miAsiento;
  return (
    <div className="pantalla-mesa">
      <header className="barra">
        <h1 className="marca">Tokinoto</h1>
        <p className="datos-partida">
          <span>
            Partida {Math.max(juego.partida, 1)} de {juego.totalPartidas}
          </span>
          {juego.cartasPorJugador > 0 && (
            <span>
              {juego.cartasPorJugador} {juego.cartasPorJugador === 1 ? 'carta' : 'cartas'} por jugador
            </span>
          )}
        </p>
        <p className="sala-codigo">
          Sala <strong>{sala.codigo}</strong>
        </p>
      </header>

      <MesaRedonda sala={sala} juego={juego} />

      <footer className="inferior">
        <p className={`turno ${meToca ? 'mio' : ''}`} role="status" aria-live="polite">
          {mensajeDeTurno(juego)}
        </p>
        <Mano juego={juego} />
      </footer>

      <Registro />

      <Resumen sala={sala} juego={juego} />
      <Resultados sala={sala} juego={juego} />
    </div>
  );
}
