import { Firma } from '../componentes/Firma';
import { BotonReglas } from '../componentes/Reglas';
import { ALFABETO_CODIGO, LARGO_CODIGO_SALA, LARGO_MAXIMO_NOMBRE } from '@tokinoto/protocolo';
import { useEffect, useState, type FormEvent } from 'react';
import type { Sesion } from '../estado/sesion';
import { useTienda } from '../estado/contexto';
import { leerPreferencia, guardarPreferencia } from '../util/preferencias';

function codigoDeLaURL(): string {
  try {
    return (new URLSearchParams(window.location.search).get('sala') ?? '').toUpperCase().slice(0, LARGO_CODIGO_SALA);
  } catch {
    return '';
  }
}

/** Pantalla de entrada: crear una sala nueva, unirse con un código o volver a la última partida. */
export function Inicio() {
  const crearSala = useTienda((s) => s.crearSala);
  const unirse = useTienda((s) => s.unirse);
  const reconectar = useTienda((s) => s.reconectar);
  const conectando = useTienda((s) => s.conexion === 'conectando');
  const ocupado = useTienda((s) => s.ocupado) || conectando;
  const consultarUltima = useTienda((s) => s.consultarUltima);
  // "Volver a esa partida" aparece solo si el servidor confirma que sigue en curso.
  const [ultima, setUltima] = useState<Sesion | null>(null);
  useEffect(() => {
    let vigente = true;
    void consultarUltima().then((sesion) => {
      if (vigente) setUltima(sesion);
    });
    return () => {
      vigente = false;
    };
  }, [consultarUltima]);
  const [nombre, setNombre] = useState(() => leerPreferencia('nombre') ?? '');
  const [codigo, setCodigo] = useState(codigoDeLaURL);
  const nombreLimpio = nombre.trim();
  const codigoValido = new RegExp(`^[${ALFABETO_CODIGO}]{${LARGO_CODIGO_SALA}}$`).test(codigo.trim().toUpperCase());

  function recordarNombre() {
    guardarPreferencia('nombre', nombreLimpio);
  }

  function alCrear(evento: FormEvent) {
    evento.preventDefault();
    if (!nombreLimpio || ocupado) return;
    recordarNombre();
    void crearSala(nombreLimpio);
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

        <div className="bloques">
          <form onSubmit={alCrear} className="bloque">
            <h2>Crear una sala</h2>
            <p className="nota">
              Invitás a tus amigos con el código y empezás cuando estén todos: de 4 a 7 jugadores.
            </p>
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
      </div>
      <Firma />
    </main>
  );
}
