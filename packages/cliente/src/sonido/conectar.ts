/**
 * Une el sonido con la página: primer toque, pestaña visible y clic de botones.
 * Devuelve una función para desconectar (la usan las pruebas).
 */
import type { EstadoCliente, MensajeServidor } from '@tokinoto/protocolo';
import type { ControlSonido } from './control';
import { sonidosDelMensaje } from './eventos';

export function conectarSonido(control: ControlSonido, documento: Document = document): () => void {
  const sonido = () => control.getState();

  // Los navegadores solo dejan sonar después de un gesto de la persona.
  const alPrimerGesto = () => sonido().desbloquear();
  const alCambiarVisibilidad = () => sonido().setVisible(documento.visibilityState !== 'hidden');
  const alClic = (e: Event) => {
    const boton = (e.target as Element | null)?.closest?.('button');
    // Las cartas tienen su propio sonido (cuando el servidor confirma la jugada).
    if (!boton || boton.disabled || boton.closest('.carta, [data-sin-clic]')) return;
    sonido().reproducir('clic');
  };

  documento.addEventListener('pointerdown', alPrimerGesto, true);
  documento.addEventListener('keydown', alPrimerGesto, true);
  documento.addEventListener('visibilitychange', alCambiarVisibilidad);
  documento.addEventListener('click', alClic, true);
  alCambiarVisibilidad();

  return () => {
    documento.removeEventListener('pointerdown', alPrimerGesto, true);
    documento.removeEventListener('keydown', alPrimerGesto, true);
    documento.removeEventListener('visibilitychange', alCambiarVisibilidad);
    documento.removeEventListener('click', alClic, true);
  };
}

/** Para `crearTienda({ alMensaje })`: hace sonar lo que corresponde a cada mensaje. */
export function sonarMensajes(control: ControlSonido) {
  return (mensaje: MensajeServidor, previo: EstadoCliente, nuevo: EstadoCliente): void => {
    try {
      for (const nombre of sonidosDelMensaje(mensaje, previo, nuevo)) control.getState().reproducir(nombre);
    } catch {
      // Un problema con el sonido nunca frena el juego.
    }
  };
}
