import { forwardRef, useEffect, useRef, useState } from 'react';

export interface ElementoMenu {
  clave: string;
  texto: string;
  accion: () => void;
}

/**
 * Botón "Menú" de la barra en celulares: abre una lista corta de acciones.
 * Se cierra con Escape, con un toque afuera o al elegir una; el foco vuelve al botón.
 */
export const Menu = forwardRef<HTMLButtonElement, { elementos: ElementoMenu[] }>(function Menu(
  { elementos },
  referencia,
) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!abierto) return;
    raiz.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const alTocar = (e: Event) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false);
        boton.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const siguiente = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[siguiente]?.focus();
      e.preventDefault();
    };
    document.addEventListener('pointerdown', alTocar);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('pointerdown', alTocar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  return (
    <div className="menu" ref={raiz}>
      <button
        ref={(e) => {
          boton.current = e;
          if (typeof referencia === 'function') referencia(e);
          else if (referencia) referencia.current = e;
        }}
        type="button"
        aria-label="Menú"
        className="boton chico secundario boton-menu"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls="menu-mesa"
        onClick={() => setAbierto((a) => !a)}
      >
        <span className="signo" aria-hidden="true">
          ⋯
        </span>
        <span className="texto-boton">Menú</span>
      </button>
      {abierto && (
        <ul id="menu-mesa" className="menu-lista" role="menu">
          {elementos.map((e) => (
            <li key={e.clave} role="none">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setAbierto(false);
                  e.accion();
                }}
              >
                {e.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
