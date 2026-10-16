import type { CSSProperties } from 'react';

const COLORES = ['blanco', 'rojo', 'azul', 'verde', 'negro', 'violeta', 'naranja', 'laton'] as const;

interface PropiedadesFicha {
  /** Número que lleva la ficha. Sin valor, la ficha va lisa. */
  valor?: number;
  /** Color fijo. Si no se indica, depende del valor. */
  color?: (typeof COLORES)[number];
  tamano?: 's' | 'm';
  style?: CSSProperties;
  titulo?: string;
}

/** Ficha de casino. El color cambia con el valor, como en una mesa real. */
export function Ficha({ valor, color, tamano = 'm', style, titulo }: PropiedadesFicha) {
  const tono = color ?? COLORES[(valor ?? 1) % COLORES.length] ?? 'rojo';
  return (
    <span className={`ficha ficha-${tono} ficha-${tamano}`} style={style} title={titulo} data-ficha={valor ?? ''}>
      {valor !== undefined && <span className="ficha-valor">{valor}</span>}
    </span>
  );
}
