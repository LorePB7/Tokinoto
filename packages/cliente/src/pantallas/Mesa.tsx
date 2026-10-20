import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { useRef, useState } from 'react';
import { ControlSonido } from '../componentes/ControlSonido';
import { CuentaRegresiva } from '../componentes/CuentaRegresiva';
import { Mano } from '../componentes/Mano';
import { Menu } from '../componentes/Menu';
import { Panel } from '../componentes/Panel';
import { ContenidoPuntos } from '../componentes/TablaPuntos';
import { PanelApuesta } from '../componentes/PanelApuesta';
import { MesaRedonda } from '../componentes/MesaRedonda';
import { Registro } from '../componentes/Registro';
import { PanelReglas } from '../componentes/Reglas';
import { Resultados } from '../componentes/Resultados';
import { Resumen } from '../componentes/Resumen';
import { useTienda } from '../estado/contexto';
import { CONSULTA_COMPACTA, useConsulta } from '../util/pantalla';

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
function ConfirmarSalida({ alCancelar }: { alCancelar: () => void }) {
  const salir = useTienda((s) => s.salir);
  const ocupado = useTienda((s) => s.ocupado);
  return (
    <div className="confirmar-salida" role="alertdialog" aria-label="Salir del juego">
      <p>¿Dejás la mesa? El piloto automático va a jugar por vos hasta el final.</p>
      <div className="acciones">
        <button type="button" className="boton chico" disabled={ocupado} onClick={() => void salir()}>
          Sí, salir
        </button>
        <button type="button" className="boton chico secundario" onClick={alCancelar}>
          Seguir jugando
        </button>
      </div>
    </div>
  );
}

/** Aviso de que el piloto automático juega por mí, con la opción de retomar el control. */
function MiPiloto() {
  const retomarControl = useTienda((s) => s.retomarControl);
  const ocupado = useTienda((s) => s.ocupado || s.conexion !== 'conectada');
  return (
    <div className="mi-piloto" role="status">
      <p>Se te venció el tiempo varias veces: el piloto automático está jugando por vos.</p>
      <button type="button" className="boton chico" disabled={ocupado} onClick={() => void retomarControl()}>
        Retomar el control
      </button>
    </div>
  );
}

/**
 * Mesa de juego. La pantalla se reparte en lugares fijos: la barra arriba, la mesa en el medio y,
 * abajo, la zona de juego (un recuadro de alto fijo para el turno o la apuesta, y tu mano).
 * Así, apostar o tirar una carta nunca mueve ni achica la mesa.
 */
export function Mesa({ sala, juego }: { sala: VistaSala; juego: VistaJuego }) {
  const meToca = juego.turno?.asiento === juego.miAsiento;
  const miFechaLimite = meToca ? (juego.turno?.fechaLimite ?? null) : null;
  const enCurso = sala.estado === 'JUGANDO';
  const [registroAbierto, setRegistroAbierto] = useState(false);
  const [panel, setPanel] = useState<'reglas' | 'puntos' | null>(null);
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);
  const compacto = useConsulta(CONSULTA_COMPACTA);
  // Al cerrar un panel, el foco vuelve al botón que lo abrió.
  const retorno = useRef<HTMLElement | null>(null);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const botonPuntos = useRef<HTMLButtonElement>(null);
  const botonReglas = useRef<HTMLButtonElement>(null);
  const abrirPanel = (cual: 'reglas' | 'puntos', desde: 'menu' | 'directo') => {
    retorno.current = desde === 'menu' ? botonMenu.current : cual === 'puntos' ? botonPuntos.current : botonReglas.current;
    setPanel(cual);
  };
  const cerrarPanel = () => {
    setPanel(null);
    retorno.current?.focus();
  };
  const yo = sala.jugadores.find((j) => j.idJugador === sala.yo);
  const conPiloto = Boolean(yo?.piloto) && enCurso;
  const apostando = !conPiloto && juego.fase === 'APUESTAS' && juego.turno?.tipo === 'apuesta' && meToca;
  const tirando = !conPiloto && juego.fase === 'TIRADAS' && juego.turno?.tipo === 'carta' && meToca;
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
        <div className="barra-derecha">
          <p className="sala-codigo">
            Sala <strong>{sala.codigo}</strong>
          </p>
          <button
            ref={botonPuntos}
            type="button"
            aria-label="Puntos"
            className="boton chico secundario boton-puntos"
            aria-expanded={panel === 'puntos'}
            aria-controls="panel-puntos"
            onClick={() => abrirPanel('puntos', 'directo')}
          >
            <span className="signo" aria-hidden="true">
              ★
            </span>
            <span className="texto-boton">Puntos</span>
          </button>
          <ControlSonido />
          {compacto ? (
            <Menu
              ref={botonMenu}
              elementos={[
                { clave: 'reglas', texto: 'Reglas', accion: () => abrirPanel('reglas', 'menu') },
                { clave: 'registro', texto: 'Registro', accion: () => setRegistroAbierto(true) },
                ...(enCurso ? [{ clave: 'salir', texto: 'Salir', accion: () => setConfirmandoSalida(true) }] : []),
              ]}
            />
          ) : (
            <>
              <button
                ref={botonReglas}
                type="button"
                aria-label="Reglas"
                className="boton chico secundario boton-reglas"
                aria-expanded={panel === 'reglas'}
                aria-controls="panel-reglas"
                onClick={() => abrirPanel('reglas', 'directo')}
              >
                <span className="signo" aria-hidden="true">
                  ?
                </span>
                <span className="texto-boton">Reglas</span>
              </button>
              {enCurso && (
                <button type="button" className="boton chico secundario" onClick={() => setConfirmandoSalida(true)}>
                  Salir
                </button>
              )}
            </>
          )}
          {enCurso && confirmandoSalida && <ConfirmarSalida alCancelar={() => setConfirmandoSalida(false)} />}
        </div>
      </header>

      <div className="zona-mesa">
        <MesaRedonda sala={sala} juego={juego} />
      </div>

      <section className="zona-juego" aria-label="Tu turno y tus cartas">
        <div className="acciones-turno">
          {/* El turno siempre se anuncia; mientras apostás, el cartel de apuesta ocupa su lugar en pantalla. */}
          <p
            className={`turno ${meToca ? 'mio' : ''} ${apostando || conPiloto ? 'solo-lectores' : ''}`}
            role="status"
            aria-live="polite"
          >
            {mensajeDeTurno(juego)}
            {miFechaLimite !== null && <CuentaRegresiva fechaLimite={miFechaLimite} />}
          </p>
          {conPiloto && <MiPiloto />}
          {apostando && <PanelApuesta juego={juego} />}
          {tirando && <p className="pista">Tocá la carta que querés jugar.</p>}
        </div>
        <Mano juego={juego} />
      </section>

      {panel === 'reglas' && <PanelReglas alCerrar={cerrarPanel} />}
      {panel === 'puntos' && (
        <Panel id="panel-puntos" titulo="Puntos" alCerrar={cerrarPanel} clase="panel-puntos panel-reglas" claseEncabezado="encabezado-reglas">
          <ContenidoPuntos juego={juego} />
        </Panel>
      )}

      <Registro abierto={registroAbierto} alCerrar={() => setRegistroAbierto(false)} />

      <Resumen sala={sala} juego={juego} />
      <Resultados sala={sala} juego={juego} />
    </div>
  );
}
