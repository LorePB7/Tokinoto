import { BotonReglas } from '../componentes/Reglas';
import { useState } from 'react';
import { useTienda } from '../estado/contexto';
import { enlaceDeLaSala, esDireccionLocal } from '../util/enlace';
import { copiarAlPortapapeles } from '../util/portapapeles';

const MINIMO = 4;

/** Sala de espera: se ve quién entró y el anfitrión inicia el juego. */
export function Lobby() {
  const sala = useTienda((s) => s.seguimiento.sala);
  const iniciar = useTienda((s) => s.iniciar);
  const salir = useTienda((s) => s.salir);
  const ocupado = useTienda((s) => s.ocupado);
  const [copiado, setCopiado] = useState<'codigo' | 'enlace' | null>(null);
  /** Si no se pudo copiar solo, se muestra el texto para copiarlo a mano. */
  const [paraCopiar, setParaCopiar] = useState<string | null>(null);
  if (!sala) return null;

  const soyAnfitrion = sala.anfitrion === sala.yo;
  const anfitrion = sala.jugadores.find((j) => j.idJugador === sala.anfitrion);
  const faltan = Math.max(0, MINIMO - sala.jugadores.length);

  async function copiar(texto: string, que: 'codigo' | 'enlace') {
    if (await copiarAlPortapapeles(texto)) {
      setParaCopiar(null);
      setCopiado(que);
      setTimeout(() => setCopiado(null), 2000);
    } else {
      setCopiado(null);
      setParaCopiar(texto);
    }
  }

  return (
    <main className="inicio lobby">
      <BotonReglas flotante />
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
          <button type="button" className="boton secundario" onClick={() => void copiar(enlaceDeLaSala(sala.codigo), 'enlace')}>
            {copiado === 'enlace' ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
        </div>

        <p className="solo-lectores" role="status">
          {copiado === 'codigo' && 'El código quedó copiado.'}
          {copiado === 'enlace' && 'El enlace quedó copiado.'}
        </p>
        {paraCopiar !== null && (
          <label className="campo">
            <span>No se pudo copiar solo. Copialo desde acá:</span>
            <input readOnly value={paraCopiar} onFocus={(e) => e.currentTarget.select()} autoFocus />
          </label>
        )}
        {esDireccionLocal(window.location.hostname) && (
          <p className="nota nota-local">
            Estás jugando en tu propia computadora: el enlace solo abre en ella. Para invitar a otras personas hay que
            publicar el juego (o usar la dirección de red de tu PC).
          </p>
        )}

        <p className="nota">
          Tiempo por jugada:{' '}
          {sala.tiempoTurnoMs === null ? 'sin límite' : `${Math.round(sala.tiempoTurnoMs / 1000)} segundos`}. Si alguien se
          va o se le vence el tiempo, el piloto automático juega por él.
        </p>

       </div>
       <div className="lobby-jugadores">
        <h3>
          Jugadores ({sala.jugadores.length} de {sala.maxJugadores})
        </h3>
        <ul className="jugadores">
          {sala.jugadores.map((j) => (
            <li key={j.idJugador} className={j.idJugador === sala.yo ? 'yo' : ''}>
              <span className="nombre">
                {j.nombre}
                {j.idJugador === sala.yo ? ' (vos)' : ''}
              </span>
              {j.idJugador === sala.anfitrion && <i className="insignia">Anfitrión</i>}
              {!j.conectado && <i className="insignia alerta">Sin conexión</i>}
            </li>
          ))}
        </ul>

        {soyAnfitrion && faltan > 0 && (
          <p className="nota">
            Faltan {faltan} {faltan === 1 ? 'jugador' : 'jugadores'} para poder empezar: se juega de {MINIMO} a 7.
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
    </main>
  );
}
