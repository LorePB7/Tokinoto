import type { CSSProperties } from 'react';
import { infoCarta } from '../util/cartas';

export type TamanoCarta = 'xs' | 's' | 'm';

interface PropiedadesCarta {
  /** Identificador de la carta, por ejemplo "K-picas". Sin id, se muestra el dorso. */
  id?: string;
  tamano?: TamanoCarta;
  onClick?: (() => void) | undefined;
  deshabilitada?: boolean | undefined;
  resaltada?: boolean | undefined;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}

function Cara({ id }: { id: string }) {
  const carta = infoCarta(id);
  const figura = ['J', 'Q', 'K', 'A'].includes(carta.rango);
  return (
    <>
      <span className="esquina arriba" aria-hidden="true">
        <b>{carta.rango}</b>
        {!carta.esComodin && <i>{carta.simbolo}</i>}
      </span>
      <span className="centro" aria-hidden="true">
        {carta.esComodin ? (
          <>
            <span className="estrella">★</span>
            <span className="leyenda">Comodín</span>
          </>
        ) : figura ? (
          <span className="medallon">
            <b>{carta.rango}</b>
            <i>{carta.simbolo}</i>
          </span>
        ) : (
          <span className="palo-grande">{carta.simbolo}</span>
        )}
      </span>
      <span className="esquina abajo" aria-hidden="true">
        <b>{carta.rango}</b>
        {!carta.esComodin && <i>{carta.simbolo}</i>}
      </span>
    </>
  );
}

/** Carta de casino: cara con valor y palo, o dorso si no se indica el id. */
export function Carta({ id, tamano = 'm', onClick, deshabilitada, resaltada, style, className }: PropiedadesCarta) {
  const info = id ? infoCarta(id) : null;
  const clases = [
    'carta',
    `carta-${tamano}`,
    info ? 'cara' : 'dorso',
    info?.rojo ? 'roja' : '',
    info?.esComodin ? 'comodin' : '',
    resaltada ? 'resaltada' : '',
    onClick ? 'jugable' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const contenido = id ? <Cara id={id} /> : null;
  const etiqueta = info ? info.nombre : 'Carta boca abajo';

  if (onClick) {
    return (
      <button
        type="button"
        className={clases}
        style={style}
        onClick={onClick}
        disabled={deshabilitada}
        aria-label={`Jugar ${etiqueta}`}
        data-carta={id}
      >
        {contenido}
      </button>
    );
  }
  return (
    <div className={clases} style={style} role="img" aria-label={etiqueta} data-carta={id}>
      {contenido}
    </div>
  );
}
