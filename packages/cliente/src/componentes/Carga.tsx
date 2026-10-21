import { useEffect, useRef, useState } from 'react';

const SALIDA_MS = 450;

/**
 * Pantalla de carga: "El Niño Games", el lema y "Tocá para entrar". Se muestra una vez al abrir el juego
 * y espera un toque (o Enter, Espacio o Escape). Ese toque es el que los navegadores piden para dejar
 * sonar, así la música arranca apenas se entra.
 */
export function Carga() {
  const [fase, setFase] = useState<'visible' | 'saliendo' | 'fuera'>('visible');
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (fase !== 'visible') return;
    boton.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') setFase('saliendo');
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [fase]);

  useEffect(() => {
    if (fase !== 'saliendo') return;
    const espera = setTimeout(() => setFase('fuera'), SALIDA_MS);
    return () => clearTimeout(espera);
  }, [fase]);

  if (fase === 'fuera') return null;
  return (
    <div className={`carga ${fase === 'saliendo' ? 'saliendo' : ''}`} onClick={() => setFase('saliendo')}>
      <p className="estudio">El Niño Games</p>
      <span className="regla" aria-hidden="true" />
      <p className="lema-carga">Un juego 100% argentino</p>
      <button ref={boton} type="button" className="toque" data-sin-clic>
        Tocá para entrar
      </button>
    </div>
  );
}
