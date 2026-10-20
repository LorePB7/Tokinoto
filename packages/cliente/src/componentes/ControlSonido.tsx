import { useEffect, useId, useRef, useState } from 'react';
import { useHaySonido, useSonido } from '../sonido/contexto';

/**
 * Botón de sonido, siempre a mano: en la barra de la mesa y flotante en el inicio y la sala.
 * Abre un recuadro chico con Sonido (sí/no), Volumen y Música. La elección se recuerda.
 */
export function ControlSonido({ flotante = false }: { flotante?: boolean }) {
  const hay = useHaySonido();
  const activado = useSonido((s) => s.activado);
  const volumen = useSonido((s) => s.volumen);
  const musica = useSonido((s) => s.musica);
  const setActivado = useSonido((s) => s.setActivado);
  const setVolumen = useSonido((s) => s.setVolumen);
  const setMusica = useSonido((s) => s.setMusica);
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: Event) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener('pointerdown', alTocar);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('pointerdown', alTocar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  if (!hay) return null;
  const silenciado = !activado || volumen <= 0;

  return (
    <div className={`control-sonido ${flotante ? 'flotante' : ''}`} ref={raiz}>
      <button
        ref={boton}
        type="button"
        aria-label={silenciado ? 'Sonido (silenciado)' : 'Sonido'}
        className="boton chico secundario boton-sonido"
        aria-expanded={abierto}
        aria-controls={`${id}-opciones`}
        onClick={() => setAbierto((a) => !a)}
      >
        <span className={`signo ${silenciado ? 'tachado' : ''}`} aria-hidden="true">
          ♪
        </span>
        <span className="texto-boton">Sonido</span>
      </button>
      {abierto && (
        <div id={`${id}-opciones`} className="opciones-sonido" role="group" aria-label="Opciones de sonido">
          <label className="opcion-sonido">
            <input type="checkbox" checked={activado} onChange={(e) => setActivado(e.target.checked)} />
            Sonido
          </label>
          <label className="opcion-sonido volumen">
            <span>Volumen</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(volumen * 100)}
              disabled={!activado}
              onChange={(e) => setVolumen(Number(e.target.value) / 100)}
            />
          </label>
          <label className="opcion-sonido">
            <input type="checkbox" checked={musica} disabled={!activado} onChange={(e) => setMusica(e.target.checked)} />
            Música de fondo
          </label>
        </div>
      )}
    </div>
  );
}
