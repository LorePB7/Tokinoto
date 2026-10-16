import { useEffect, useRef } from 'react';
import { useTienda } from '../estado/contexto';

/** Lo que va pasando en la mesa, en orden. */
export function Registro() {
  const registro = useTienda((s) => s.registro);
  const lista = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const elemento = lista.current;
    if (elemento) elemento.scrollTop = elemento.scrollHeight;
  }, [registro]);

  return (
    <section className="registro" aria-label="Registro de la mesa">
      <h2>En la mesa</h2>
      <ol ref={lista}>
        {registro.map((linea) => (
          <li key={linea.id}>{linea.texto}</li>
        ))}
      </ol>
    </section>
  );
}
