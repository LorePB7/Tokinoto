/** Preferencias del navegador (por ejemplo, el último nombre usado). Nunca fallan: sin almacenamiento, no guardan. */
export function leerPreferencia(clave: string): string | null {
  try {
    return window.localStorage.getItem(`tokinoto.${clave}`);
  } catch {
    return null;
  }
}

export function guardarPreferencia(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(`tokinoto.${clave}`, valor);
  } catch {
    // Sin almacenamiento disponible: se sigue sin recordar.
  }
}
