import { BotonChat } from '../componentes/Chat';
import { Firma } from '../componentes/Firma';
import { ControlSonido } from '../componentes/ControlSonido';
import { BotonReglas } from '../componentes/Reglas';
import { InsigniaBot, NOMBRE_NIVEL, PanelAgregarBot } from '../componentes/Bots';
import { TIEMPO_TURNO_POR_DEFECTO_S } from '@tokinoto/protocolo';
import { useEffect, useRef, useState } from 'react';
import { useTienda } from '../estado/contexto';

const MINIMO = 4;
const MAXIMO = 7;

/** Opciones de tiempo por jugada (DP-13). 0 representa "sin límite". */
const TIEMPOS = [TIEMPO_TURNO_POR_DEFECTO_S, 60, 0];

function textoTiempo(ms: number | null): string {
  return ms === null ? 'sin límite' : `${Math.round(ms / 1000)} segundos`;
}

function enlaceDeLaSala(codigo: string): string {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('sala', codigo);
    return url.toString();
  } catch {
    return codigo;
  }
}

/** El anfitrión confirma antes de sacar a alguien: la persona no puede volver a la sala. */
function ConfirmarExpulsion({ nombre, alConfirmar, alCancelar }: { nombre: string; alConfirmar: () => void; alCancelar: () => void }) {
  const ocupado = useTienda((s) => s.ocupado);
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelar.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCancelar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alCancelar]);
  return (
    <>
      <div className="panel-fondo" aria-hidden="true" onClick={alCancelar} />
      <div className="confirmar-expulsion" role="alertdialog" aria-modal="true" aria-label={`Sacar a ${nombre}`}>
        <p>
          ¿Sacás a <strong>{nombre}</strong> de la sala? No va a poder volver a entrar.
        </p>
        <div className="acciones">
          <button type="button" className="boton chico" disabled={ocupado} onClick={alConfirmar}>
            Sí, sacar
          </button>
          <button ref={cancelar} type="button" className="boton chico secundario" onClick={alCancelar}>
            Cancelar
          </button>
        </div>
      </div>
    </>
  );
}

/** Sala de espera: se ve quién entró y el anfitrión inicia el juego (o saca a alguien). */
export function Lobby() {
  const sala = useTienda((s) => s.seguimiento.sala);
  const iniciar = useTienda((s) => s.iniciar);
  const salir = useTienda((s) => s.salir);
  const ocupado = useTienda((s) => s.ocupado);
  const configurarTiempo = useTienda((s) => s.configurarTiempo);
  const expulsar = useTienda((s) => s.expulsar);
  const quitarBot = useTienda((s) => s.quitarBot);
  const [agregando, setAgregando] = useState(false);
  const [cerrarAgregar] = useState(() => () => setAgregando(false));
  const [copiado, setCopiado] = useState<'codigo' | 'enlace' | null>(null);
  const [aExpulsar, setAExpulsar] = useState<string | null>(null);
  const [cancelarExpulsion] = useState(() => () => setAExpulsar(null));
  if (!sala) return null;
  const expulsado = sala.jugadores.find((j) => j.idJugador === aExpulsar);

  const soyAnfitrion = sala.anfitrion === sala.yo;
  const anfitrion = sala.jugadores.find((j) => j.idJugador === sala.anfitrion);
  const faltan = Math.max(0, MINIMO - sala.jugadores.length);

  async function copiar(texto: string, que: 'codigo' | 'enlace') {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setCopiado(null);
    }
  }

  return (
    <main className="inicio lobby">
      <ControlSonido flotante />
      <div className="flotantes-derecha">
        <BotonChat flotante />
        <BotonReglas flotante />
      </div>
      <h1 className="logo">Tokinoto</h1>
      <div className="hoja">
        <div className="lobby-info">
          <h2>Sala de espera</h2>
          <p className="invitacion">
            Pasales este código a tus amigos: <strong className="codigo-sala" data-testid="codigo">{sala.codigo}</strong>
          </p>
          <div className="acciones">
            <button type="button" className="boton secundario" onClick={() => void copiar(sala.codigo, 'codigo')}>
              {copiado === 'codigo' ? 'Código copiado' : 'Copiar código'}
            </button>
            <button
              type="button"
              className="boton secundario"
              onClick={() => void copiar(enlaceDeLaSala(sala.codigo), 'enlace')}
            >
              {copiado === 'enlace' ? 'Enlace copiado' : 'Copiar enlace'}
            </button>
          </div>
          {soyAnfitrion ? (
            <label className="campo tiempo-jugada">
              <span>Tiempo por jugada</span>
              <select
                value={sala.tiempoTurnoMs === null ? 0 : Math.round(sala.tiempoTurnoMs / 1000)}
                disabled={ocupado}
                onChange={(e) => {
                  const segundos = Number(e.target.value);
                  void configurarTiempo(segundos === 0 ? null : segundos);
                }}
              >
                {TIEMPOS.map((t) => (
                  <option key={t} value={t}>
                    {t === 0 ? 'Sin límite' : `${t} segundos`}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="nota">Tiempo por jugada: {textoTiempo(sala.tiempoTurnoMs)}.</p>
          )}
          <p className="nota">Si alguien se va o se le vence el tiempo, el piloto automático juega por él.</p>
        </div>

        <div className="lobby-jugadores">
          <div className="titulo-jugadores">
            <h3>
              Jugadores ({sala.jugadores.length} de {MAXIMO})
            </h3>
            {soyAnfitrion && sala.jugadores.length < MAXIMO && (
              <button
                type="button"
                className="boton-agregar-bot"
                disabled={ocupado}
                aria-haspopup="dialog"
                aria-controls="panel-agregar-bot"
                onClick={() => setAgregando(true)}
              >
                + Bot
              </button>
            )}
          </div>
          <ul className="jugadores">
            {sala.jugadores.map((j) => (
              <li key={j.idJugador} className={j.idJugador === sala.yo ? 'yo' : ''}>
                <span className="nombre">
                  {j.nombre}
                  {j.idJugador === sala.yo ? ' (vos)' : ''}
                </span>
                {j.idJugador === sala.anfitrion && <i className="insignia">Anfitrión</i>}
                {j.bot && (
                  <span className="insignias insignia-bot">
                    <InsigniaBot nivel={j.bot} />
                    <i className="nivel">{NOMBRE_NIVEL[j.bot]}</i>
                  </span>
                )}
                {!j.conectado && <i className="insignia alerta">Sin conexión</i>}
                {soyAnfitrion && j.idJugador !== sala.yo && (
                  <button
                    type="button"
                    className="boton-expulsar"
                    aria-label={j.bot ? `Quitar a ${j.nombre}` : `Sacar a ${j.nombre} de la sala`}
                    title={j.bot ? 'Quitar el bot' : 'Sacar de la sala'}
                    disabled={ocupado}
                    onClick={() => (j.bot ? void quitarBot(j.idJugador) : setAExpulsar(j.idJugador))}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {soyAnfitrion && faltan > 0 && (
            <p className="nota">
              Faltan {faltan} {faltan === 1 ? 'jugador' : 'jugadores'} para poder empezar: se juega de {MINIMO} a {MAXIMO}.
            </p>
          )}
          {!soyAnfitrion && <p className="nota">Esperando que {anfitrion?.nombre ?? 'el anfitrión'} inicie el juego.</p>}
          <div className="acciones fila">
            {soyAnfitrion && (
              <button type="button" className="boton" disabled={faltan > 0 || ocupado} onClick={() => void iniciar()}>
                Iniciar juego
              </button>
            )}
            <button type="button" className="boton secundario" disabled={ocupado} onClick={() => void salir()}>
              Salir de la sala
            </button>
          </div>
        </div>
      </div>
      {soyAnfitrion && expulsado && (
        <ConfirmarExpulsion
          nombre={expulsado.nombre}
          alCancelar={cancelarExpulsion}
          alConfirmar={() => {
            setAExpulsar(null);
            void expulsar(expulsado.idJugador);
          }}
        />
      )}
      {soyAnfitrion && agregando && <PanelAgregarBot alCerrar={cerrarAgregar} />}
      <Firma />
    </main>
  );
}
