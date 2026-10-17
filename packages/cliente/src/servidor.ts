/**
 * Dirección del servidor:
 * - la de VITE_SERVIDOR, si se definió al construir;
 * - en la versión publicada, la misma dirección de la página (el servidor
 *   entrega el cliente y el juego en el mismo sitio);
 * - en desarrollo, el mismo equipo en el puerto 3001.
 */
export function urlDelServidor(): string {
  const configurada = import.meta.env['VITE_SERVIDOR'];
  if (typeof configurada === 'string' && configurada.length > 0) return configurada;
  if (import.meta.env.PROD) return window.location.origin;
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}
