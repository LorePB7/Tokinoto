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

/** Desde 6 jugadores la mesa está llena: las placas se compactan para no encimarse (ver "Mesas llenas" en estilos.css). */
export const MESA_LLENA = 6;

/** Radio de los asientos, en % del ancho de la mesa (la mesa es un círculo). */
export const RADIO = 41;

/**
 * Con 7 jugadores, repartir los asientos en partes iguales (cada 51°) encimaba
 * a mis vecinos conmigo y a los de los costados entre sí. Estos ángulos (en
 * grados desde mi lugar, hacia la derecha) les dan más aire; salen de medir
 * las placas en pantallas de 320 a 1920 px. Con menos jugadores sobra lugar y
 * se reparten en partes iguales.
 */
const ANGULOS_SIETE = [0, 58, 101, 154, 206, 259, 302];

/** Posición del asiento `asiento` cuando yo estoy en `miAsiento` y hay `n` jugadores. */
export function posicionAsiento(asiento: number, miAsiento: number, n: number): Punto {
  const lugar = (asiento - miAsiento + n) % n;
  const grados = n === 7 ? (ANGULOS_SIETE[lugar] ?? 0) : (lugar * 360) / n;
  const angulo = ((90 - grados) * Math.PI) / 180;
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
