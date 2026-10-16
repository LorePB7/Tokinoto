/** Direcciones que solo existen en la computadora de quien las abre. */
export function esDireccionLocal(host: string): boolean {
  const limpio = host.toLowerCase().replace(/^\[|\]$/g, '');
  return limpio === 'localhost' || limpio.endsWith('.localhost') || limpio === '127.0.0.1' || limpio === '::1';
}

/**
 * Enlace para invitar a una sala. Usa `VITE_URL_PUBLICA` si está definida (la dirección
 * pública del juego); si no, la dirección desde la que se abrió la página.
 */
export function enlaceDeLaSala(codigo: string, base?: string): string {
  const configurada = import.meta.env['VITE_URL_PUBLICA'];
  const origen =
    base ??
    (typeof configurada === 'string' && configurada.length > 0
      ? configurada
      : `${window.location.origin}${window.location.pathname}`);
  try {
    const url = new URL(origen);
    url.search = '';
    url.hash = '';
    url.searchParams.set('sala', codigo);
    return url.toString();
  } catch {
    return codigo;
  }
}
