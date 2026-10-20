import { useEffect, useState } from 'react';

/** Las mismas pantallas en que el CSS pasa la barra y el registro a su versión de celular. */
export const CONSULTA_COMPACTA = '(max-width: 820px), (max-height: 560px) and (max-width: 1099px)';

/** true mientras la pantalla coincide con la consulta (siempre false donde no existe matchMedia). */
export function useConsulta(consulta: string): boolean {
  const leer = () => (typeof window.matchMedia === 'function' ? window.matchMedia(consulta).matches : false);
  const [coincide, setCoincide] = useState(leer);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const lista = window.matchMedia(consulta);
    const alCambiar = () => setCoincide(lista.matches);
    alCambiar();
    lista.addEventListener('change', alCambiar);
    return () => lista.removeEventListener('change', alCambiar);
  }, [consulta]);
  return coincide;
}
