/**
 * Geometría de la mesa redonda. Todo en porcentajes del área de la mesa, con
 * el origen arriba a la izquierda.
 *
 * El juego gira siempre "hacia la derecha": el asiento siguiente es el que
 * queda a la derecha del anterior. Vistos desde mi lugar (abajo, mirando al
 * centro), mi derecha es la derecha de la pantalla, así que los asientos
 * siguientes van hacia la derecha y luego hacia arriba (sentido antihorario
 * en pantalla).
 */
export interface Punto {
  x: number;
  y: number;
}

/** Radio de los asientos, en % del ancho de la mesa (la mesa es un círculo). */
export const RADIO = 41;

/** Posición del asiento `asiento` cuando yo estoy en `miAsiento` y hay `n` jugadores. */
export function posicionAsiento(asiento: number, miAsiento: number, n: number): Punto {
  const lugar = (asiento - miAsiento + n) % n;
  const angulo = ((90 - (lugar * 360) / n) * Math.PI) / 180;
  return { x: 50 + RADIO * Math.cos(angulo), y: 50 + RADIO * Math.sin(angulo) };
}

/** Punto intermedio entre el centro de la mesa y un punto (0 = centro, 1 = el punto). */
export function haciaElCentro(punto: Punto, cuanto: number): Punto {
  return { x: 50 + (punto.x - 50) * cuanto, y: 50 + (punto.y - 50) * cuanto };
}

/** Giro leve y estable de la carta de un asiento, para que la mesa no se vea rígida. */
export function giroDeCarta(asiento: number): number {
  return ((asiento * 37) % 17) - 8;
}
