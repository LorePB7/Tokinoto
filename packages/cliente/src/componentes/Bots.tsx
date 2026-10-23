import { BOTS_MAXIMO, BOTS_MINIMO, NIVELES_BOT, type NivelBot } from '@tokinoto/protocolo';
import { useState, type FormEvent } from 'react';
import { useTienda } from '../estado/contexto';
import { guardarPreferencia, leerPreferencia } from '../util/preferencias';
import { Panel } from './Panel';

export const NOMBRE_NIVEL: Record<NivelBot, string> = { facil: 'Fácil', medio: 'Medio', dificil: 'Difícil' };

const DESCRIPCION_NIVEL: Record<NivelBot, string> = {
  facil: 'Apuesta a ojo y se equivoca seguido.',
  medio: 'Calcula sus bazas y juega para cumplir.',
  dificil: 'Lleva la cuenta de lo jugado y casi no regala nada.',
};

function esNivel(valor: string | null): valor is NivelBot {
  return valor !== null && (NIVELES_BOT as readonly string[]).includes(valor);
}

/** Una cabecita de robot: marca que ese asiento lo ocupa un bot (fase 8). */
export function IconoBot() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.5v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="2.6" r="1.6" fill="currentColor" />
      <rect x="4" y="6.5" width="16" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="9" cy="12.5" r="1.9" fill="currentColor" />
      <circle cx="15" cy="12.5" r="1.9" fill="currentColor" />
      <path d="M9 16.6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Ícono chico con el nivel (en la mesa y en la sala de espera). */
export function InsigniaBot({ nivel }: { nivel: NivelBot }) {
  const texto = `Bot ${NOMBRE_NIVEL[nivel].toLowerCase()}`;
  return (
    <i className={`bot nivel-${nivel}`} title={texto} role="img" aria-label={texto}>
      <IconoBot />
    </i>
  );
}

function SelectorNivel({ nivel, alElegir }: { nivel: NivelBot; alElegir: (nivel: NivelBot) => void }) {
  return (
    <fieldset className="niveles-bot">
      <legend>Nivel</legend>
      {NIVELES_BOT.map((n) => (
        <label key={n} className={n === nivel ? 'elegido' : ''}>
          <input type="radio" name="nivel-bot" value={n} checked={n === nivel} onChange={() => alElegir(n)} />
          <span className="titulo">{NOMBRE_NIVEL[n]}</span>
          <span className="nota">{DESCRIPCION_NIVEL[n]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Inicio: jugar solo contra bots. Crea la sala y empieza enseguida. */
export function PanelContraBots({ alCerrar }: { alCerrar: () => void }) {
  const jugarContraBots = useTienda((s) => s.jugarContraBots);
  const ocupado = useTienda((s) => s.ocupado || s.conexion === 'conectando');
  const [cantidad, setCantidad] = useState(() => {
    const guardada = Number(leerPreferencia('botsCantidad'));
    return guardada >= BOTS_MINIMO && guardada <= BOTS_MAXIMO ? guardada : BOTS_MINIMO;
  });
  const [nivel, setNivel] = useState<NivelBot>(() => {
    const guardado = leerPreferencia('botsNivel');
    return esNivel(guardado) ? guardado : 'medio';
  });
  const opciones = Array.from({ length: BOTS_MAXIMO - BOTS_MINIMO + 1 }, (_, i) => BOTS_MINIMO + i);

  function alEmpezar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    guardarPreferencia('botsCantidad', String(cantidad));
    guardarPreferencia('botsNivel', nivel);
    void jugarContraBots(cantidad, nivel);
  }

  return (
    <Panel id="panel-bots" titulo="Jugar solo" alCerrar={alCerrar} clase="panel-bots">
      <form className="panel-cuerpo formulario-bots" onSubmit={alEmpezar}>
        <label className="campo">
          <span>Rivales</span>
          <select value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>
            {opciones.map((c) => (
              <option key={c} value={c}>
                {c} bots ({c + 1} jugadores)
              </option>
            ))}
          </select>
        </label>
        <SelectorNivel nivel={nivel} alElegir={setNivel} />
        <p className="nota">Sin tiempo por jugada. Los bots juegan en el servidor: hace falta internet.</p>
        <button type="submit" className="boton" disabled={ocupado}>
          Empezar
        </button>
      </form>
    </Panel>
  );
}

/** Sala de espera: el anfitrión suma un bot del nivel que elija. */
export function PanelAgregarBot({ alCerrar }: { alCerrar: () => void }) {
  const agregarBot = useTienda((s) => s.agregarBot);
  const ocupado = useTienda((s) => s.ocupado);
  const [nivel, setNivel] = useState<NivelBot>(() => {
    const guardado = leerPreferencia('botsNivel');
    return esNivel(guardado) ? guardado : 'medio';
  });

  async function alAgregar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    guardarPreferencia('botsNivel', nivel);
    if (await agregarBot(nivel)) alCerrar();
  }

  return (
    <Panel id="panel-agregar-bot" titulo="Agregar un bot" alCerrar={alCerrar} clase="panel-bots">
      <form className="panel-cuerpo formulario-bots" onSubmit={(e) => void alAgregar(e)}>
        <SelectorNivel nivel={nivel} alElegir={setNivel} />
        <p className="nota">El bot ocupa un lugar en la mesa y juega solo. No habla en el chat.</p>
        <button type="submit" className="boton" disabled={ocupado}>
          Agregar bot
        </button>
      </form>
    </Panel>
  );
}
