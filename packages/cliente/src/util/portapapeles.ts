/**
 * Copia un texto al portapapeles. Devuelve false si no se pudo.
 * Primero usa la API moderna (solo anda en páginas seguras: https o localhost) y,
 * si no está disponible, el método clásico, que sirve también por http en la red local.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se prueba el método clásico.
  }
  const activo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  try {
    area.value = texto;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, texto.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    activo?.focus();
  }
}
