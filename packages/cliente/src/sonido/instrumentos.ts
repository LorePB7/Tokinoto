/**
 * Muestras generadas con cálculo puro (sin Web Audio), para poder probarlas:
 * - `cuerda`: guitarra criolla con el método Karplus-Strong (un ruido corto que
 *   recorre una "cuerda" y se va suavizando, como una cuerda de nylon pulsada).
 * - `sala`: la respuesta de una pieza chica, para darle a todo un poco de aire.
 */

/** Generador pseudoaleatorio con semilla: la misma nota suena siempre igual. */
function azar(semilla: number): () => number {
  let s = semilla >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

export interface OpcionesCuerda {
  /** Muestras por segundo. */
  tasa: number;
  frecuencia: number;
  duracion: number;
  /** 0 a 1: cuánto tarda en apagarse (más alto, suena más tiempo). */
  sostenido?: number;
  /** 0 a 1: más bajo, ataque más blando (yema del dedo en vez de uña). */
  brillo?: number;
}

export function cuerda({ tasa, frecuencia, duracion, sostenido = 0.996, brillo = 0.5 }: OpcionesCuerda): Float32Array {
  const largo = Math.max(1, Math.floor(tasa * duracion));
  const periodo = Math.max(2, Math.round(tasa / frecuencia));
  const linea = new Float32Array(periodo);
  const r = azar(Math.round(frecuencia * 100));
  for (let i = 0; i < periodo; i++) linea[i] = r();
  // Pulsar con la yema: el ruido inicial se suaviza según el brillo.
  const pasadas = Math.round((1 - brillo) * 4);
  for (let p = 0; p < pasadas; p++) {
    for (let i = 0; i < periodo; i++) linea[i] = 0.5 * (linea[i]! + linea[(i + 1) % periodo]!);
  }
  const salida = new Float32Array(largo);
  let pico = 0;
  for (let i = 0; i < largo; i++) {
    const j = i % periodo;
    const v = linea[j]!;
    salida[i] = v;
    pico = Math.max(pico, Math.abs(v));
    linea[j] = sostenido * 0.5 * (v + linea[(j + 1) % periodo]!);
  }
  // Volumen parejo entre notas, y un final sin "click".
  const escala = pico > 0 ? 0.9 / pico : 0;
  const cola = Math.min(largo, Math.floor(tasa * 0.02));
  for (let i = 0; i < largo; i++) {
    const fin = i >= largo - cola ? (largo - i) / cola : 1;
    salida[i] = salida[i]! * escala * fin;
  }
  return salida;
}

/** Respuesta de una pieza chica de paredes de adobe: ruido que se apaga, más oscuro al final. */
export function sala(tasa: number, duracion = 1.1, semilla = 7): Float32Array {
  const largo = Math.floor(tasa * duracion);
  const r = azar(semilla);
  const salida = new Float32Array(largo);
  let previo = 0;
  for (let i = 0; i < largo; i++) {
    const t = i / largo;
    // Un filtro que se cierra con el tiempo: las paredes se comen los agudos.
    const suavizado = 0.2 + 0.75 * t;
    previo = previo * suavizado + r() * (1 - suavizado);
    salida[i] = previo * Math.pow(1 - t, 3);
  }
  return salida;
}
