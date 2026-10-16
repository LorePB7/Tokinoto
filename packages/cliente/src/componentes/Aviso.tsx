import { useEffect } from 'react';
import { useTienda } from '../estado/contexto';

const SEGUNDOS_VISIBLE = 6;

/** Mensaje breve arriba de la pantalla, por ejemplo cuando el servidor rechaza una jugada. */
export function Aviso() {
  const aviso = useTienda((s) => s.aviso);
  const descartar = useTienda((s) => s.descartarAviso);

  useEffect(() => {
    if (!aviso) return;
    const temporizador = setTimeout(descartar, SEGUNDOS_VISIBLE * 1000);
    return () => clearTimeout(temporizador);
  }, [aviso, descartar]);

  if (!aviso) return null;
  return (
    <div className="aviso" role="alert">
      <span>{aviso.texto}</span>
      <button type="button" onClick={descartar} aria-label="Cerrar aviso">
        ✕
      </button>
    </div>
  );
}
