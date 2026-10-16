import { segundosRestantes, useHoraServidor } from '../util/reloj';

/** Segundos que le quedan al turno. En los últimos 10, se resalta. */
export function CuentaRegresiva({ fechaLimite }: { fechaLimite: number }) {
  const ahora = useHoraServidor();
  const segundos = segundosRestantes(fechaLimite, ahora);
  return (
    <span
      className={`cuenta-regresiva ${segundos <= 10 ? 'urgente' : ''}`}
      role="timer"
      aria-label={`Quedan ${segundos} segundos`}
    >
      {segundos} s
    </span>
  );
}
