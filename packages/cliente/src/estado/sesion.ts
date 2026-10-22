/**
 * Lo que el navegador recuerda entre visitas. Nunca falla: sin almacenamiento
 * disponible, simplemente no guarda.
 *
 * - La cuenta (fase 6), en `localStorage`: la sesión que entregó el servidor
 *   al entrar con Google o como invitado, y el nombre. La comparten todas las
 *   pestañas: es la misma persona. Si se borran los datos del sitio, un
 *   invitado pierde esa identidad.
 * - La sala de esta pestaña, en `sessionStorage`: si la pestaña estaba en una
 *   sala, al recargar vuelve sola al asiento (DP-14). En otra pestaña, volver
 *   es una decisión de la persona ("volver a tu partida").
 */
export interface CuentaGuardada {
  /** Sesión firmada por el servidor. */
  sesion: string;
  tipo: 'google' | 'invitado';
  nombre: string;
}

export interface AlmacenSesion {
  leerCuenta(): CuentaGuardada | null;
  guardarCuenta(cuenta: CuentaGuardada): void;
  borrarCuenta(): void;
  /** Código de la sala en la que estaba esta pestaña. */
  leerSala(): string | null;
  guardarSala(codigo: string): void;
  borrarSala(): void;
}

const CLAVE_CUENTA = 'tokinoto.cuenta';
const CLAVE_SALA = 'tokinoto.sala';
/** Clave de la versión anterior (token por sala): se borra, ya no sirve. */
const CLAVE_VIEJA = 'tokinoto.sesion';

function intentar<T>(accion: () => T, siFalla: T): T {
  try {
    return accion();
  } catch {
    return siFalla; // Sin almacenamiento: se sigue sin recordar.
  }
}

function leerCuentaDe(texto: string | null): CuentaGuardada | null {
  if (!texto) return null;
  try {
    const datos = JSON.parse(texto) as Partial<CuentaGuardada>;
    if (typeof datos.sesion !== 'string' || typeof datos.nombre !== 'string') return null;
    if (datos.tipo !== 'google' && datos.tipo !== 'invitado') return null;
    return { sesion: datos.sesion, tipo: datos.tipo, nombre: datos.nombre };
  } catch {
    return null;
  }
}

export const almacenDelNavegador: AlmacenSesion = {
  leerCuenta: () => intentar(() => leerCuentaDe(window.localStorage.getItem(CLAVE_CUENTA)), null),
  guardarCuenta(cuenta) {
    intentar(() => window.localStorage.setItem(CLAVE_CUENTA, JSON.stringify(cuenta)), undefined);
  },
  borrarCuenta() {
    intentar(() => window.localStorage.removeItem(CLAVE_CUENTA), undefined);
  },
  leerSala: () => intentar(() => window.sessionStorage.getItem(CLAVE_SALA), null),
  guardarSala(codigo) {
    intentar(() => window.sessionStorage.setItem(CLAVE_SALA, codigo), undefined);
  },
  borrarSala() {
    intentar(() => window.sessionStorage.removeItem(CLAVE_SALA), undefined);
  },
};

/** Borra lo que guardaba la versión anterior del juego (un token por sala). */
export function limpiarVersionVieja(): void {
  intentar(() => window.sessionStorage.removeItem(CLAVE_VIEJA), undefined);
  intentar(() => window.localStorage.removeItem(CLAVE_VIEJA), undefined);
}

/** Almacén en memoria, para pruebas. */
export function almacenEnMemoria(
  cuenta: CuentaGuardada | null = null,
): AlmacenSesion & { cuenta: CuentaGuardada | null; sala: string | null } {
  const almacen = {
    cuenta,
    sala: null as string | null,
    leerCuenta: () => almacen.cuenta,
    guardarCuenta(nueva: CuentaGuardada) {
      almacen.cuenta = nueva;
    },
    borrarCuenta() {
      almacen.cuenta = null;
    },
    leerSala: () => almacen.sala,
    guardarSala(codigo: string) {
      almacen.sala = codigo;
    },
    borrarSala() {
      almacen.sala = null;
    },
  };
  return almacen;
}
