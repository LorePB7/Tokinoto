import { useEffect, useRef } from 'react';
import { useTienda } from '../estado/contexto';

/** Lo que va pasando en la mesa, en orden. */
export function Registro({ abierto = false, alCerrar }: { abierto?: boolean; alCerrar?: () => void }) {
  const registro = useTienda((s) => s.registro);
  const lista = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const elemento = lista.current;
    if (elemento) elemento.scrollTop = elemento.scrollHeight;
  }, [registro, abierto]);

  return (
    <section id="registro-mesa" className={`registro ${abierto ? 'abierto' : ''}`} aria-label="Registro de la mesa">
      <header className="encabezado-registro">
        <h2>En la mesa</h2>
        {alCerrar && (
          <button type="button" className="boton chico secundario cerrar-registro" onClick={alCerrar}>
            Cerrar
          </button>
        )}
      </header>
      <ol ref={lista}>
        {registro.map((linea) => (
          <li key={linea.id}>{linea.texto}</li>
        ))}
      </ol>
    </section>
  );
}
