/**
 * Sesión guardada en el navegador: el token que permite volver al asiento
 * (DP-14). Nunca falla: sin almacenamiento disponible, simplemente no guarda.
 *
 * - En `sessionStorage` (una por pestaña): sirve para volver solo al recargar
 *   la página o si se corta la conexión. Así, varias pestañas del mismo
 *   navegador pueden ser jugadores distintos sin pisarse.
 * - En `localStorage` queda además la última sesión, para ofrecer "volver a
 *   tu partida" si se cerró la pestaña. Volver es una decisión del jugador.
 */
export interface Sesion {
  token: string;
  codigo: string;
  nombre: string;
}

export interface AlmacenSesion {
  leer(): Sesion | null;
  /** La última sesión usada en este navegador (aunque sea de otra pestaña). */
  leerUltima(): Sesion | null;
  guardar(sesion: Sesion): void;
  borrar(): void;
  /** Olvida la última sesión si es la de ese token (porque esa partida ya no existe). */
  olvidarUltima(token: string): void;
}

const CLAVE = 'tokinoto.sesion';

function leerDe(almacen: () => Storage): Sesion | null {
  try {
    const crudo = almacen().getItem(CLAVE);
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as Partial<Sesion>;
    if (typeof datos.token !== 'string' || typeof datos.codigo !== 'string' || typeof datos.nombre !== 'string') {
      return null;
    }
    return { token: datos.token, codigo: datos.codigo, nombre: datos.nombre };
  } catch {
    return null;
  }
}

function intentar(accion: () => void): void {
  try {
    accion();
  } catch {
    // Sin almacenamiento: se sigue sin recordar.
  }
}

export const almacenDelNavegador: AlmacenSesion = {
  leer: () => leerDe(() => window.sessionStorage),
  leerUltima: () => leerDe(() => window.localStorage),
  guardar(sesion) {
    const texto = JSON.stringify(sesion);
    intentar(() => window.sessionStorage.setItem(CLAVE, texto));
    intentar(() => window.localStorage.setItem(CLAVE, texto));
  },
  borrar() {
    const actual = leerDe(() => window.sessionStorage);
    intentar(() => window.sessionStorage.removeItem(CLAVE));
    // La última sesión se borra solo si es esta (otra pestaña puede estar usando la suya).
    const ultima = leerDe(() => window.localStorage);
    if (!ultima || !actual || ultima.token === actual.token) intentar(() => window.localStorage.removeItem(CLAVE));
  },
  olvidarUltima(token) {
    if (leerDe(() => window.localStorage)?.token === token) intentar(() => window.localStorage.removeItem(CLAVE));
  },
};

/** Almacén en memoria, para pruebas. */
export function almacenEnMemoria(): AlmacenSesion & { ultima: Sesion | null; actual: Sesion | null } {
  const almacen = {
    actual: null as Sesion | null,
    ultima: null as Sesion | null,
    leer: () => almacen.actual,
    leerUltima: () => almacen.ultima,
    guardar(sesion: Sesion) {
      almacen.actual = sesion;
      almacen.ultima = sesion;
    },
    borrar() {
      if (almacen.ultima?.token === almacen.actual?.token) almacen.ultima = null;
      almacen.actual = null;
    },
    olvidarUltima(token: string) {
      if (almacen.ultima?.token === token) almacen.ultima = null;
    },
  };
  return almacen;
}
