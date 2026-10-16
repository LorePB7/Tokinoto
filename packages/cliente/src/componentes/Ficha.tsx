import type { CSSProperties } from 'react';

interface PropiedadesFicha {
  /** Número que lleva la ficha. Sin valor, la ficha va lisa. */
  valor?: number;
  tamano?: 's' | 'm';
  style?: CSSProperties;
  titulo?: string;
}

/** Ficha de apuesta. Son todas del mismo color (bordó): lo que distingue es el número. */
export function Ficha({ valor, tamano = 'm', style, titulo }: PropiedadesFicha) {
  return (
    <span className={`ficha ficha-${tamano}`} style={style} title={titulo} data-ficha={valor ?? ''}>
      {valor !== undefined && <span className="ficha-valor">{valor}</span>}
    </span>
  );
}
