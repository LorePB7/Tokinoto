import { Firma } from '../componentes/Firma';
import { ControlSonido } from '../componentes/ControlSonido';
import { BotonReglas } from '../componentes/Reglas';
import { PanelContraBots } from '../componentes/Bots';
import { ALFABETO_CODIGO, LARGO_CODIGO_SALA, LARGO_MAXIMO_NOMBRE } from '@tokinoto/protocolo';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTienda } from '../estado/contexto';
import { leerPreferencia, guardarPreferencia } from '../util/preferencias';
import { idClienteGoogle, mostrarBotonGoogle, olvidarGoogle } from '../util/google';

function codigoDeLaURL(): string {
  try {
    return (new URLSearchParams(window.location.search).get('sala') ?? '').toUpperCase().slice(0, LARGO_CODIGO_SALA);
  } catch {
    return '';
  }
}

/**
 * Pantalla de inicio. Sin cuenta: entrar con Google o como invitado (fase 6).
 * Con cuenta: crear una sala, unirse con un código o volver a la última partida.
 */
export function Inicio() {
  const cuenta = useTienda((s) => s.cuenta);
  const conectando = useTienda((s) => s.conexion === 'conectando');

  return (
    <main className="inicio">
      <ControlSonido flotante />
      <BotonReglas flotante />
      <h1 className="logo">Tokinoto</h1>
      <p className="lema">Un juego de cartas para jugar de 4 a 7 amigos.</p>
      {conectando && (
        <p className="estado-conexion" role="status">
          Conectando…
        </p>
      )}
      {cuenta ? <Salas /> : <Entrada />}
      <Firma />
    </main>
  );
}

/** Entrar con Google o como invitado. */
function Entrada() {
  const entrarComoInvitado = useTienda((s) => s.entrarComoInvitado);
  const ocupado = useTienda((s) => s.ocupado || s.conexion === 'conectando');
  const [nombre, setNombre] = useState(() => leerPreferencia('nombre') ?? '');
  const nombreLimpio = nombre.trim();
  const conGoogle = idClienteGoogle() !== '';

  function alEntrar(evento: FormEvent) {
    evento.preventDefault();
    if (!nombreLimpio || ocupado) return;
    guardarPreferencia('nombre', nombreLimpio);
    void entrarComoInvitado(nombreLimpio);
  }

  return (
    <div className="hoja formulario entrada">
      <p className="nota">
        Para jugar, entrá con tu cuenta de Google o como invitado.{' '}
        <a href="/privacidad.html" target="_blank" rel="noopener">
          Privacidad
        </a>
      </p>
      <div className="bloques">
        <form onSubmit={alEntrar} className="bloque">
          <h2>Como invitado</h2>
          <label className="campo">
            <span>Tu nombre</span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={LARGO_MAXIMO_NOMBRE}
              autoComplete="nickname"
            />
          </label>
          <button type="submit" className="boton" disabled={!nombreLimpio || ocupado}>
            Jugar como invitado
          </button>
        </form>
        {conGoogle && (
          <p className="separador" aria-hidden="true">
            <span>o</span>
          </p>
        )}
        {conGoogle && (
          <div className="bloque">
            <h2>Con Google</h2>
            <BotonGoogle />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * El botón oficial de Google, dibujado por su propio script. Google lo dibuja con un ancho fijo en
 * píxeles, así que se vuelve a dibujar cuando cambia el ancho disponible: si no, al achicarse la
 * ventana quedaba más ancho que su lugar y se veía cortado en los extremos.
 */
function BotonGoogle() {
  const entrarConGoogle = useTienda((s) => s.entrarConGoogle);
  const contenedor = useRef<HTMLDivElement>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const div = contenedor.current;
    if (!div) return;
    let vigente = true;
    let anchoDibujado = -1;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const dibujar = () => {
      const ancho = Math.floor(div.clientWidth);
      if (!vigente || ancho <= 0 || Math.abs(ancho - anchoDibujado) < 4) return;
      anchoDibujado = ancho;
      mostrarBotonGoogle(div, idClienteGoogle(), (credencial) => void entrarConGoogle(credencial), ancho).catch(() => {
        if (vigente) setFallo(true);
      });
    };
    dibujar();
    const observador = new ResizeObserver(() => {
      clearTimeout(espera);
      espera = setTimeout(dibujar, 100);
    });
    observador.observe(div);
    return () => {
      vigente = false;
      clearTimeout(espera);
      observador.disconnect();
    };
  }, [entrarConGoogle]);

  return (
    <>
      <div ref={contenedor} className="boton-google" />
      {fallo && (
        <p className="nota" role="status">
          No se pudo cargar el botón de Google. Probá de nuevo o entrá como invitado.
        </p>
      )}
    </>
  );
}

/** Con cuenta: quién juega, crear una sala o unirse con un código. */
function Salas() {
  const cuenta = useTienda((s) => s.cuenta)!;
  const crearSala = useTienda((s) => s.crearSala);
  const unirse = useTienda((s) => s.unirse);
  const reconectar = useTienda((s) => s.reconectar);
  const cambiarNombre = useTienda((s) => s.cambiarNombre);
  const cerrarSesion = useTienda((s) => s.cerrarSesion);
  const conectando = useTienda((s) => s.conexion === 'conectando');
  const ocupado = useTienda((s) => s.ocupado) || conectando;
  const consultarUltima = useTienda((s) => s.consultarUltima);
  const abandonarUltima = useTienda((s) => s.abandonarUltima);
  // Cada vez que el servidor responde "ya estás en otra sala", se vuelve a consultar para ofrecer Volver o Abandonar.
  const avisosOtraPartida = useTienda((s) => s.avisosOtraPartida);
  // "Volver a esa partida" aparece solo si el servidor confirma que sigue en curso.
  const [ultima, setUltima] = useState<{ codigo: string } | null>(null);
  const [confirmarAbandono, setConfirmarAbandono] = useState(false);
  useEffect(() => {
    let vigente = true;
    void consultarUltima().then((encontrada) => {
      if (vigente) setUltima(encontrada);
    });
    return () => {
      vigente = false;
    };
  }, [consultarUltima, avisosOtraPartida]);

  async function alAbandonar() {
    if (ocupado) return;
    if (await abandonarUltima()) {
      setUltima(null);
      setConfirmarAbandono(false);
    }
  }
  const [codigo, setCodigo] = useState(codigoDeLaURL);
  const codigoValido = new RegExp(`^[${ALFABETO_CODIGO}]{${LARGO_CODIGO_SALA}}$`).test(codigo.trim().toUpperCase());

  const [contraBots, setContraBots] = useState(false);
  const [cerrarBots] = useState(() => () => setContraBots(false));
  const [editando, setEditando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState(cuenta.nombre);
  const nombreLimpio = nombreNuevo.trim();

  function alCrear(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    void crearSala();
  }

  function alUnirse(evento: FormEvent) {
    evento.preventDefault();
    if (!codigoValido || ocupado) return;
    void unirse(codigo.trim().toUpperCase());
  }

  async function alCambiarNombre(evento: FormEvent) {
    evento.preventDefault();
    if (!nombreLimpio || ocupado) return;
    if (await cambiarNombre(nombreLimpio)) {
      if (cuenta.tipo === 'invitado') guardarPreferencia('nombre', nombreLimpio);
      setEditando(false);
    }
  }

  function alSalir() {
    if (cuenta.tipo === 'google') olvidarGoogle();
    cerrarSesion();
  }

  return (
    <>
      {ultima && (
        <div className="hoja volver">
          {confirmarAbandono ? (
            <>
              <p>
                ¿Abandonás la partida de la sala <strong>{ultima.codigo}</strong>? Si quedan otras personas, el piloto
                automático juega por vos hasta el final; si no, la partida se cierra.
              </p>
              <div className="acciones-volver">
                <button type="button" className="boton" disabled={ocupado} onClick={() => void alAbandonar()}>
                  Sí, abandonar
                </button>
                <button type="button" className="boton secundario" onClick={() => setConfirmarAbandono(false)}>
                  No
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Tenés una partida en la sala <strong>{ultima.codigo}</strong>.
              </p>
              <div className="acciones-volver">
                <button type="button" className="boton" disabled={ocupado} onClick={() => void reconectar()}>
                  Volver a esa partida
                </button>
                <button type="button" className="boton secundario" disabled={ocupado} onClick={() => setConfirmarAbandono(true)}>
                  Abandonarla
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="hoja formulario">
        {editando ? (
          <form className="cuenta-fila" onSubmit={(e) => void alCambiarNombre(e)}>
            <label className="campo">
              <span>Tu nombre</span>
              <input
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                maxLength={LARGO_MAXIMO_NOMBRE}
                autoComplete="nickname"
                autoFocus
              />
            </label>
            <button type="submit" className="boton chico" disabled={!nombreLimpio || ocupado}>
              Guardar
            </button>
            <button type="button" className="boton chico secundario" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </form>
        ) : (
          <div className="cuenta-fila">
            <p className="quien">
              Jugás como <strong>{cuenta.nombre}</strong>
              <span className="nota">{cuenta.tipo === 'google' ? ' · cuenta de Google' : ' · invitado'}</span>
            </p>
            <button
              type="button"
              className="boton chico secundario"
              onClick={() => {
                setNombreNuevo(cuenta.nombre);
                setEditando(true);
              }}
            >
              Cambiar nombre
            </button>
            <button type="button" className="boton chico secundario" onClick={alSalir}>
              Salir
            </button>
          </div>
        )}

        <div className="bloques">
          <form onSubmit={alCrear} className="bloque">
            <h2>Crear una sala</h2>
            <p className="nota">
              Invitás a tus amigos con el código y empezás cuando estén todos: de 4 a 7 jugadores.
            </p>
            <div className="acciones-crear">
              <button type="submit" className="boton" disabled={ocupado}>
                Crear sala
              </button>
              <button
                type="button"
                className="boton secundario"
                disabled={ocupado}
                aria-haspopup="dialog"
                aria-controls="panel-bots"
                onClick={() => setContraBots(true)}
              >
                Jugar solo
              </button>
            </div>
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
            <button type="submit" className="boton" disabled={!codigoValido || ocupado}>
              Unirme
            </button>
          </form>
        </div>
      </div>
      {contraBots && <PanelContraBots alCerrar={cerrarBots} />}
    </>
  );
}
