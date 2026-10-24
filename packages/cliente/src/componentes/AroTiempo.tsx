import type { CSSProperties } from 'react';
import { useHoraServidor } from '../util/reloj';

/** Segundos finales en los que el aro se pone rojo. */
const SEGUNDOS_URGENTES = 5;

/**
 * Marco del jugador en turno que se va vaciando con el tiempo que le queda.
 * Va dibujado encima del borde de la placa, así no ocupa lugar ni mueve nada.
 */
export function AroTiempo({ fechaLimite, totalMs }: { fechaLimite: number; totalMs: number }) {
  const ahora = useHoraServidor();
  const restanMs = Math.max(0, fechaLimite - ahora);
  const resto = Math.min(1, restanMs / totalMs);
  const urgente = restanMs <= SEGUNDOS_URGENTES * 1000;
  return (
    <span
      className={`aro-tiempo${urgente ? ' urgente' : ''}`}
      style={{ '--resto': resto } as CSSProperties}
      aria-hidden="true"
    />
  );
}
