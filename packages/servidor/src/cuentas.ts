/**
 * Identidad de los jugadores (fase 6, DP-16): cuenta de Google o invitado.
 *
 * - Google: el cliente manda el token de identidad que le dio el botón de
 *   Google; el servidor lo verifica (firma, audiencia = nuestro ID de cliente,
 *   emisor y vencimiento) y usa el `sub` como identificador. Nunca el email.
 * - Invitado: solo un nombre. No tiene fila en la base.
 *
 * En los dos casos el servidor entrega su propia sesión firmada (HMAC), con
 * vencimiento. Así no depende del token de Google, que dura poco, y la sesión
 * sobrevive a un reinicio del servidor (por eso es firmada y no en memoria).
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { OAuth2Client } from 'google-auth-library';
import type { Cuenta, Cuentas } from '@tokinoto/persistencia';
import { LARGO_MAXIMO_NOMBRE } from '@tokinoto/protocolo';

/** Lo que importa de una cuenta de Google verificada. */
export interface PerfilGoogle {
  sub: string;
  /** Nombre que da Google (puede venir vacío). */
  nombre: string;
}

/** Verifica un token de identidad de Google. Lanza un error si no es válido. */
export type VerificadorGoogle = (credencial: string) => Promise<PerfilGoogle>;

/** Quién es la persona de una conexión. */
export interface Identidad {
  tipo: 'google' | 'invitado';
  /** Clave única de la persona: `g:<cuentaId>` o `i:<idInvitado>`. */
  clave: string;
  nombre: string;
  /** Cuenta en la base; null si es invitado. */
  cuentaId: string | null;
}

/**
 * Verificador real, con la librería oficial de Google. `cliente` solo se pasa
 * en las pruebas (para usar claves propias en vez de pedirlas a Google).
 */
export async function crearVerificadorGoogle(idCliente: string, cliente?: OAuth2Client): Promise<VerificadorGoogle> {
  if (!idCliente.trim()) throw new Error('Falta el ID de cliente de Google');
  if (!cliente) {
    const { OAuth2Client: Cliente } = await import('google-auth-library');
    cliente = new Cliente();
  }
  const google = cliente;
  return async (credencial) => {
    // Verifica firma (claves públicas de Google), audiencia, emisor y vencimiento.
    const ticket = await google.verifyIdToken({ idToken: credencial, audience: idCliente });
    const datos = ticket.getPayload();
    if (!datos?.sub) throw new Error('El token de Google no tiene identificador');
    return { sub: datos.sub, nombre: datos.name ?? datos.given_name ?? '' };
  };
}

/**
 * Verificador de prueba (TOKINOTO_AUTH_PRUEBA): acepta `prueba:<nombre>` y no
 * habla con Google. El servidor se niega a usarlo en producción.
 */
export const verificadorDePrueba: VerificadorGoogle = async (credencial) => {
  const coincidencia = /^prueba:(.{1,40})$/u.exec(credencial);
  if (!coincidencia) throw new Error('Credencial de prueba inválida');
  const nombre = coincidencia[1]!;
  return { sub: `prueba-${nombre.toLocaleLowerCase('es')}`, nombre };
};

/**
 * Deja el nombre como lo acepta una sala: sin caracteres de control,
 * espacios simples y hasta 20 caracteres. Si queda vacío, "Jugador".
 */
export function limpiarNombre(nombre: string): string {
  const limpio = [...nombre.replace(/\p{C}/gu, '').replace(/\s+/gu, ' ').trim()].slice(0, LARGO_MAXIMO_NOMBRE).join('').trim();
  return limpio || 'Jugador';
}

// ---------------------------------------------------------------------------
// Sesiones firmadas
// ---------------------------------------------------------------------------

/** Una sesión dura 30 días; se renueva cada vez que la persona vuelve. */
export const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;

type DatosSesion =
  | { t: 'g'; c: string; exp: number }
  | { t: 'i'; i: string; n: string; exp: number };

export class Sesiones {
  private readonly secreto: Buffer;

  constructor(
    secreto: string | Buffer,
    private readonly ahora: () => number = Date.now,
    private readonly duracionMs: number = DURACION_SESION_MS,
  ) {
    this.secreto = typeof secreto === 'string' ? Buffer.from(secreto) : secreto;
    if (this.secreto.length < 32) throw new Error('El secreto de las sesiones debe tener al menos 32 caracteres.');
  }

  /** Secreto al azar: las sesiones se pierden al reiniciar (solo para desarrollo y pruebas). */
  static efimeras(ahora?: () => number): Sesiones {
    return new Sesiones(randomBytes(32), ahora);
  }

  deCuenta(cuentaId: string): string {
    return this.firmar({ t: 'g', c: cuentaId, exp: this.ahora() + this.duracionMs });
  }

  deInvitado(idInvitado: string, nombre: string): string {
    return this.firmar({ t: 'i', i: idInvitado, n: nombre, exp: this.ahora() + this.duracionMs });
  }

  nuevoInvitado(nombre: string): { sesion: string; identidad: Identidad } {
    const id = randomUUID();
    const limpio = limpiarNombre(nombre);
    return { sesion: this.deInvitado(id, limpio), identidad: { tipo: 'invitado', clave: `i:${id}`, nombre: limpio, cuentaId: null } };
  }

  /** Lee una sesión. null si está mal formada, adulterada o vencida. */
  leer(sesion: string): DatosSesion | null {
    const partes = sesion.split('.');
    if (partes.length !== 2) return null;
    const [cuerpo, firma] = partes as [string, string];
    const esperada = this.firma(cuerpo);
    const recibida = Buffer.from(firma, 'base64url');
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
    let datos: unknown;
    try {
      datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!esDatosSesion(datos) || datos.exp <= this.ahora()) return null;
    return datos;
  }

  private firmar(datos: DatosSesion): string {
    const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
    return `${cuerpo}.${this.firma(cuerpo).toString('base64url')}`;
  }

  private firma(cuerpo: string): Buffer {
    return createHmac('sha256', this.secreto).update(cuerpo).digest();
  }
}

function esDatosSesion(datos: unknown): datos is DatosSesion {
  if (typeof datos !== 'object' || datos === null) return false;
  const d = datos as Record<string, unknown>;
  if (typeof d['exp'] !== 'number') return false;
  if (d['t'] === 'g') return typeof d['c'] === 'string';
  if (d['t'] === 'i') return typeof d['i'] === 'string' && typeof d['n'] === 'string';
  return false;
}

/**
 * Cuentas en memoria, para cuando no hay base (desarrollo y pruebas): se
 * pierden al reiniciar. Mismo contrato que el repositorio.
 */
export function cuentasEnMemoria(): Cuentas {
  const cuentas = new Map<string, Cuenta>();
  return {
    async cuentaDeGoogle(googleSub, nombreInicial, cuando) {
      for (const cuenta of cuentas.values()) if (cuenta.googleSub === googleSub) return { ...cuenta };
      const cuenta: Cuenta = { id: randomUUID(), googleSub, nombre: nombreInicial, creadaEn: cuando };
      cuentas.set(cuenta.id, cuenta);
      return { ...cuenta };
    },
    async obtenerCuenta(id) {
      const cuenta = cuentas.get(id);
      return cuenta ? { ...cuenta } : null;
    },
    async cambiarNombreCuenta(id, nombre) {
      const cuenta = cuentas.get(id);
      if (!cuenta) return null;
      cuenta.nombre = nombre;
      return { ...cuenta };
    },
  };
}
