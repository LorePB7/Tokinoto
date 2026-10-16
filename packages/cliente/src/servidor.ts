/** Dirección del servidor: la de VITE_SERVIDOR, o el mismo equipo en el puerto 3001. */
export function urlDelServidor(): string {
  const configurada = import.meta.env['VITE_SERVIDOR'];
  if (typeof configurada === 'string' && configurada.length > 0) return configurada;
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}
