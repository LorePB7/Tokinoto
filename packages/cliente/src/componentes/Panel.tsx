import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface PropiedadesPanel {
  /** Identificador del elemento (lo usan los botones que lo abren con aria-controls). */
  id: string;
  /** Título visible y nombre accesible del diálogo. */
  titulo: string;
  alCerrar: () => void;
  /** Clase propia de cada panel (por ejemplo "panel-reglas"). */
  clase?: string;
  /** Clase del encabezado, si el panel ya tiene estilos propios para él. */
  claseEncabezado?: string;
  /**
   * Qué enfocar al abrir, en vez de "Cerrar" (el campo del chat, por ejemplo).
   * Solo con mouse: en pantallas táctiles abriría el teclado sin que se pida.
   */
  foco?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Panel lateral de la mesa y del inicio: lo comparten Reglas, Puntos y Chat.
 *
 * En pantallas anchas es un cajón a la derecha; en celulares sube desde abajo
 * como una hoja que deja ver el juego detrás (ver "Panel" en estilos.css).
 * Un toque en el fondo, Escape o el botón "Cerrar" lo cierran, y el foco no
 * se escapa del panel mientras está abierto.
 */
export function Panel({ id, titulo, alCerrar, clase = '', claseEncabezado = '', foco, children }: PropiedadesPanel) {
  const panel = useRef<HTMLElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const conMouse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    (conMouse && foco?.current ? foco.current : cerrar.current)?.focus();
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        alCerrar();
        return;
      }
      if (evento.key !== 'Tab' || !panel.current) return;
      const enfocables = Array.from(panel.current.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
        (e) => e.offsetParent !== null,
      );
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!primero || !ultimo) return;
      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alCerrar, foco]);

  // Va directo en <body>: si no, hereda los estilos de quien lo abre (la barra de la mesa, por ejemplo).
  return createPortal(
    <>
      <div className="panel-fondo" aria-hidden="true" onClick={alCerrar} />
      <aside ref={panel} id={id} className={`panel ${clase}`.trim()} role="dialog" aria-modal="true" aria-label={titulo}>
        <span className="panel-asa" aria-hidden="true" />
        <header className={`panel-encabezado ${claseEncabezado}`.trim()}>
          <h2>{titulo}</h2>
          <button ref={cerrar} type="button" className="boton chico" onClick={alCerrar}>
            Cerrar
          </button>
        </header>
        {children}
      </aside>
    </>,
    document.body,
  );
}
