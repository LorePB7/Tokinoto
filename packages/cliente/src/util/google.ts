/**
 * Botón "Iniciar sesión con Google" (Google Identity Services).
 *
 * El script de Google se carga recién cuando hace falta mostrar el botón. Al
 * tocarlo, Google abre su ventana y devuelve un token de identidad
 * ("credential"), que la tienda manda al servidor para verificarlo. El cliente
 * nunca decide nada con ese token.
 */

/** ID de cliente de Google; vacío si no se configuró (entonces solo hay invitados). */
export function idClienteGoogle(): string {
  const id = import.meta.env['VITE_GOOGLE_CLIENT_ID'];
  return typeof id === 'string' ? id.trim() : '';
}

const URL_SCRIPT = 'https://accounts.google.com/gsi/client';

interface RespuestaCredencial {
  credential?: string;
}

interface GoogleId {
  initialize(opciones: {
    client_id: string;
    callback: (respuesta: RespuestaCredencial) => void;
    ux_mode?: 'popup' | 'redirect';
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(contenedor: HTMLElement, opciones: Record<string, string | number>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

let carga: Promise<GoogleId> | null = null;

/** Carga el script de Google una sola vez. */
export function cargarGoogle(): Promise<GoogleId> {
  carga ??= new Promise<GoogleId>((resolver, rechazar) => {
    const listo = window.google?.accounts?.id;
    if (listo) {
      resolver(listo);
      return;
    }
    const script = document.createElement('script');
    script.src = URL_SCRIPT;
    script.async = true;
    script.onload = () => {
      const id = window.google?.accounts?.id;
      if (id) resolver(id);
      else rechazar(new Error('Google no respondió'));
    };
    script.onerror = () => rechazar(new Error('No se pudo cargar Google'));
    document.head.appendChild(script);
  }).catch((problema: unknown) => {
    carga = null; // permite reintentar más tarde
    throw problema;
  });
  return carga;
}

let inicializado = false;
/** A quién avisarle cuando Google entregue el token (el botón visible en ese momento). */
let alCredencial: ((credencial: string) => void) | null = null;

/** Dibuja el botón de Google en `contenedor`. `alEntrar` recibe el token de identidad. */
export async function mostrarBotonGoogle(
  contenedor: HTMLElement,
  idCliente: string,
  alEntrar: (credencial: string) => void,
  ancho: number,
): Promise<void> {
  const google = await cargarGoogle();
  alCredencial = alEntrar;
  if (!inicializado) {
    google.initialize({
      client_id: idCliente,
      callback: (respuesta) => {
        if (respuesta.credential) alCredencial?.(respuesta.credential);
      },
      ux_mode: 'popup',
      auto_select: false,
      use_fedcm_for_button: true,
    });
    inicializado = true;
  }
  google.renderButton(contenedor, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
    locale: 'es-419',
    width: Math.round(Math.max(200, Math.min(ancho, 400))),
  });
}

/** Al salir de la cuenta: que Google no vuelva a elegirla sola. */
export function olvidarGoogle(): void {
  window.google?.accounts?.id?.disableAutoSelect();
}
