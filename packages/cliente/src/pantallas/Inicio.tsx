import { BotonReglas } from '../componentes/Reglas';
import {
  ALFABETO_CODIGO,
  LARGO_CODIGO_SALA,
  LARGO_MAXIMO_NOMBRE,
  TIEMPO_TURNO_POR_DEFECTO_S,
} from '@tokinoto/protocolo';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTienda } from '../estado/contexto';
import { leerPreferencia, guardarPreferencia } from '../util/preferencias';

function codigoDeLaURL(): string {
  try {
    return (new URLSearchParams(window.location.search).get('sala') ?? '').toUpperCase().slice(0, LARGO_CODIGO_SALA);
  } catch {
    return '';
  }
}

/** Opciones de tiempo por jugada (DP-13). 0 representa "sin límite". */
const TIEMPOS = [TIEMPO_TURNO_POR_DEFECTO_S, 60, 0];

/** Pantalla de entrada: crear una sala nueva, unirse con un código o volver a la última partida. */
export function Inicio() {
  const crearSala = useTienda((s) => s.crearSala);
  const unirse = useTienda((s) => s.unirse);
  const reconectar = useTienda((s) => s.reconectar);
  const conectando = useTienda((s) => s.conexion === 'conectando');
  const ocupado = useTienda((s) => s.ocupado) || conectando;
  const ultimaSesion = useTienda((s) => s.ultimaSesion);
  const [ultima] = useState(ultimaSesion);
  const [tiempo, setTiempo] = useState(TIEMPO_TURNO_POR_DEFECTO_S);
  const [nombre, setNombre] = useState(() => leerPreferencia('nombre') ?? '');
  const [codigo, setCodigo] = useState(codigoDeLaURL);
  const [cupo, setCupo] = useState(7);
  // Una sola acción a la vez: así la pantalla entra entera, sin scroll, también en el celular.
  const [modo, setModo] = useState<'crear' | 'unirme'>(() => (codigoDeLaURL() ? 'unirme' : 'crear'));
  const nombreLimpio = nombre.trim();
  const codigoValido = new RegExp(`^[${ALFABETO_CODIGO}]{${LARGO_CODIGO_SALA}}$`).test(codigo.trim().toUpperCase());

  function recordarNombre() {
    guardarPreferencia('nombre', nombreLimpio);
  }

  function alCrear(evento: FormEvent) {
    evento.preventDefault();
    if (!nombreLimpio || ocupado) return;
    recordarNombre();
    void crearSala(nombreLimpio, cupo, tiempo === 0 ? null : tiempo);
  }

  function alUnirse(evento: FormEvent) {
    evento.preventDefault();
    if (!nombreLimpio || !codigoValido || ocupado) return;
    recordarNombre();
    void unirse(codigo.trim().toUpperCase(), nombreLimpio);
  }

  function alTeclearPestana(evento: KeyboardEvent) {
    if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
    evento.preventDefault();
    const siguiente = modo === 'crear' ? 'unirme' : 'crear';
    setModo(siguiente);
    document.getElementById(`pestana-${siguiente}`)?.focus();
  }

  return (
    <main className="inicio">
      <BotonReglas flotante />
      <h1 className="logo">Tokinoto</h1>
      <p className="lema">Un juego de cartas para jugar de 4 a 7 amigos.</p>
      {conectando && (
        <p className="estado-conexion" role="status">
          Conectando…
        </p>
      )}

      {ultima && (
        <div className="hoja volver">
          <p>
            Tenés una partida en la sala <strong>{ultima.codigo}</strong>
            {ultima.nombre ? ` como ${ultima.nombre}` : ''}.
          </p>
          <button type="button" className="boton" disabled={ocupado} onClick={() => void reconectar(ultima.token)}>
            Volver a esa partida
          </button>
        </div>
      )}

      <div className="hoja formulario">
        <label className="campo">
          <span>Tu nombre</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={LARGO_MAXIMO_NOMBRE}
            autoComplete="nickname"
            autoFocus
          />
        </label>

        <div className="guarda" aria-hidden="true" />

        <div className="pestanas" role="tablist" aria-label="Qué querés hacer" onKeyDown={alTeclearPestana}>
          <button
            type="button"
            role="tab"
            id="pestana-crear"
            aria-selected={modo === 'crear'}
            aria-controls="panel-crear"
            tabIndex={modo === 'crear' ? 0 : -1}
            className={`pestana ${modo === 'crear' ? 'activa' : ''}`}
            onClick={() => setModo('crear')}
          >
            Crear una sala
          </button>
          <button
            type="button"
            role="tab"
            id="pestana-unirme"
            aria-selected={modo === 'unirme'}
            aria-controls="panel-unirme"
            tabIndex={modo === 'unirme' ? 0 : -1}
            className={`pestana ${modo === 'unirme' ? 'activa' : ''}`}
            onClick={() => setModo('unirme')}
          >
            Tengo código
          </button>
        </div>

        {modo === 'crear' ? (
          <form onSubmit={alCrear} className="bloque" role="tabpanel" id="panel-crear" aria-labelledby="pestana-crear">
            <div className="fila-campos">
              <label className="campo corto">
                <span>Jugadores (máx.)</span>
                <select value={cupo} onChange={(e) => setCupo(Number(e.target.value))}>
                  {[4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo corto">
                <span>Tiempo por jugada</span>
                <select value={tiempo} onChange={(e) => setTiempo(Number(e.target.value))}>
                  {TIEMPOS.map((t) => (
                    <option key={t} value={t}>
                      {t === 0 ? 'Sin límite' : `${t} s`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" className="boton" disabled={!nombreLimpio || ocupado}>
              Crear sala
            </button>
          </form>
        ) : (
          <form onSubmit={alUnirse} className="bloque" role="tabpanel" id="panel-unirme" aria-labelledby="pestana-unirme">
            <label className="campo">
              <span>Código de la sala</span>
              <input
                className="codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                maxLength={LARGO_CODIGO_SALA}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="boton" disabled={!nombreLimpio || !codigoValido || ocupado}>
              Unirme
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
