import { useEffect, useState } from 'react';
import { useTienda } from '../estado/contexto';

/** Hora del servidor, aproximada con el desfase medido en la última foto. Se actualiza sola. */
export function useHoraServidor(cadaMs = 250): number {
  const desfase = useTienda((s) => s.desfaseReloj);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(intervalo);
  }, [cadaMs]);
  return ahora + desfase;
}

/** Segundos que faltan hasta una fecha límite (nunca negativos). */
export function segundosRestantes(fechaLimite: number, ahora: number): number {
  return Math.max(0, Math.ceil((fechaLimite - ahora) / 1000));
}
