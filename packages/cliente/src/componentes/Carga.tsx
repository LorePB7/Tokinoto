import { useEffect, useState } from 'react';

const DURACION_MS = 1800;
const SALIDA_MS = 450;

/**
 * Pantalla de carga: "El Niño Games" y el lema. Se muestra una sola vez al abrir el juego,
 * se va sola a los 1,8 segundos y se puede saltear con un toque, Enter o Escape.
 */
export function Carga({ duracion = DURACION_MS }: { duracion?: number }) {
  const [fase, setFase] = useState<'visible' | 'saliendo' | 'fuera'>('visible');

  useEffect(() => {
    if (fase !== 'visible') return;
    const espera = setTimeout(() => setFase('saliendo'), duracion);
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') setFase('saliendo');
    };
    document.addEventListener('keydown', alTeclear);
    return () => {
      clearTimeout(espera);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [fase, duracion]);

  useEffect(() => {
    if (fase !== 'saliendo') return;
    const espera = setTimeout(() => setFase('fuera'), SALIDA_MS);
    return () => clearTimeout(espera);
  }, [fase]);

  if (fase === 'fuera') return null;
  return (
    <div className={`carga ${fase === 'saliendo' ? 'saliendo' : ''}`} role="status" aria-label="Cargando Tokinoto" onClick={() => setFase('saliendo')}>
      <p className="estudio">El Niño Games</p>
      <span className="regla" aria-hidden="true" />
      <p className="lema-carga">Un juego 100% argentino</p>
      <p className="toque">Tocá para continuar</p>
    </div>
  );
}
