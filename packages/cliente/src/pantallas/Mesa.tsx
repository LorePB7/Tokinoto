import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { useState } from 'react';
import { CuentaRegresiva } from '../componentes/CuentaRegresiva';
import { Mano } from '../componentes/Mano';
import { PanelApuesta } from '../componentes/PanelApuesta';
import { MesaRedonda } from '../componentes/MesaRedonda';
import { Registro } from '../componentes/Registro';
import { BotonReglas } from '../componentes/Reglas';
import { Resultados } from '../componentes/Resultados';
import { Resumen } from '../componentes/Resumen';
import { useTienda } from '../estado/contexto';

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

/** Salir con el juego en curso: se pide confirmación, porque el asiento queda con el piloto. */
function BotonSalir({ enCurso }: { enCurso: boolean }) {
  const salir = useTienda((s) => s.salir);
  const ocupado = useTienda((s) => s.ocupado);
  const [confirmando, setConfirmando] = useState(false);
  if (!enCurso) return null;
  if (!confirmando) {
    return (
      <button type="button" className="boton chico secundario" onClick={() => setConfirmando(true)}>
        Salir
      </button>
    );
  }
  return (
    <div className="confirmar-salida" role="alertdialog" aria-label="Salir del juego">
      <p>¿Dejás la mesa? El piloto automático va a jugar por vos hasta el final.</p>
      <div className="acciones">
        <button type="button" className="boton chico" disabled={ocupado} onClick={() => void salir()}>
          Sí, salir
        </button>
        <button type="button" className="boton chico secundario" onClick={() => setConfirmando(false)}>
          Seguir jugando
        </button>
      </div>
    </div>
  );
}

/** Aviso de que el piloto automático juega por mí, con la opción de retomar el control. */
function MiPiloto({ sala }: { sala: VistaSala }) {
  const retomarControl = useTienda((s) => s.retomarControl);
  const ocupado = useTienda((s) => s.ocupado || s.conexion !== 'conectada');
  const yo = sala.jugadores.find((j) => j.idJugador === sala.yo);
  if (!yo?.piloto || sala.estado !== 'JUGANDO') return null;
  return (
    <div className="mi-piloto" role="status">
      <p>Se te venció el tiempo varias veces: el piloto automático está jugando por vos.</p>
      <button type="button" className="boton chico" disabled={ocupado} onClick={() => void retomarControl()}>
        Retomar el control
      </button>
    </div>
  );
}

/** Mesa de juego: la mesa redonda, mis cartas, la apuesta y el registro. */
export function Mesa({ sala, juego }: { sala: VistaSala; juego: VistaJuego }) {
  const meToca = juego.turno?.asiento === juego.miAsiento;
  const miFechaLimite = meToca ? (juego.turno?.fechaLimite ?? null) : null;
  const enCurso = sala.estado === 'JUGANDO';
  // Mientras apostás, la mesa se achica un poco para que entren el cartel de apuesta y tus cartas sin scroll.
  const apostando = juego.fase === 'APUESTAS' && juego.turno?.tipo === 'apuesta' && meToca;
  return (
    <div className={`pantalla-mesa ${apostando ? 'apostando' : ''}`}>
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
        <div className="barra-derecha">
          <p className="sala-codigo">
            Sala <strong>{sala.codigo}</strong>
          </p>
          <BotonReglas />
          <BotonSalir enCurso={enCurso} />
        </div>
      </header>

      <MesaRedonda sala={sala} juego={juego} />

      <footer className="inferior">
        <MiPiloto sala={sala} />
        <p className={`turno ${meToca ? 'mio' : ''} ${apostando ? 'solo-lectores' : ''}`} role="status" aria-live="polite">
          {mensajeDeTurno(juego)}
          {miFechaLimite !== null && <CuentaRegresiva fechaLimite={miFechaLimite} />}
        </p>
        <PanelApuesta juego={juego} />
        <Mano juego={juego} />
      </footer>

      <Registro />

      <Resumen sala={sala} juego={juego} />
      <Resultados sala={sala} juego={juego} />
    </div>
  );
}
