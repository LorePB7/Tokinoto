/**
 * El tiempo lo maneja el servidor (diseño técnico 3.2). La sala no usa
 * setTimeout directamente sino este reloj, para poder probarla con un
 * reloj manual, sin esperas reales.
 */
export interface Reloj {
  /** Hora actual en milisegundos (como Date.now()). */
  ahora(): number;
  /** Ejecuta `tarea` dentro de `ms` milisegundos. Devuelve una función que la cancela. */
  programar(ms: number, tarea: () => void): () => void;
}

export const relojReal: Reloj = {
  ahora: () => Date.now(),
  programar(ms, tarea) {
    const temporizador = setTimeout(tarea, ms);
    return () => clearTimeout(temporizador);
  },
};
