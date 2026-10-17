import { BotonReglas } from '../componentes/Reglas';
import {
  ALFABETO_CODIGO,
  LARGO_CODIGO_SALA,
  LARGO_MAXIMO_NOMBRE,
  TIEMPO_TURNO_POR_DEFECTO_S,
} from '@tokinoto/protocolo';
import { useState, type FormEvent } from 'react';
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

        <form onSubmit={alCrear} className="bloque">
          <h2>Crear una sala</h2>
          <label className="campo corto">
            <span>Jugadores como máximo</span>
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
                  {t === 0 ? 'Sin límite' : `${t} segundos`}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="boton" disabled={!nombreLimpio || ocupado}>
            Crear sala
          </button>
        </form>

        <form onSubmit={alUnirse} className="bloque">
          <h2>Unirme a una sala</h2>
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
      </div>
    </main>
  );
}
