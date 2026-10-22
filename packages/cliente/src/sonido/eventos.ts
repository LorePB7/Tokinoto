/**
 * Qué suena con cada mensaje del servidor. Función pura: recibe el mensaje y el
 * estado antes y después de aplicarlo, y devuelve los sonidos.
 *
 * Las fotos (al entrar o reconectar) no suenan: no son algo que acaba de pasar.
 */
import { esEvento, type EstadoCliente, type MensajeServidor, type VistaSala } from '@tokinoto/protocolo';
import type { NombreSonido } from './control';

function meTocaActuar(sala: VistaSala | null): 'apuesta' | 'carta' | null {
  const juego = sala?.juego;
  if (!juego || !juego.turno || juego.turno.asiento !== juego.miAsiento) return null;
  // Con el piloto automático jugando por mí, no tiene sentido avisar.
  if (sala.jugadores.find((j) => j.idJugador === sala.yo)?.piloto) return null;
  return juego.turno.tipo;
}

export function sonidosDelMensaje(
  mensaje: MensajeServidor,
  previo: EstadoCliente,
  nuevo: EstadoCliente,
): NombreSonido[] {
  // Chat (fase 7): suena solo con mensajes de otras personas, nunca con los propios.
  if (mensaje.tipo === 'chat.mensaje') {
    return nuevo !== previo && nuevo.sala && mensaje.datos.idJugador !== nuevo.sala.yo ? ['chat'] : [];
  }
  if (!esEvento(mensaje) || nuevo === previo || nuevo.desincronizado || !nuevo.sala) return [];
  const juego = nuevo.sala.juego;
  const sonidos: NombreSonido[] = [];

  switch (mensaje.tipo) {
    case 'baza.cartaJugada':
      sonidos.push('carta');
      break;
    case 'baza.resuelta':
      if (juego && mensaje.datos.ganador === juego.miAsiento) sonidos.push('baza');
      break;
    case 'partida.puntajes':
      // La última partida no tiene su melodía: le sigue la del podio.
      if (!juego || mensaje.datos.partida < juego.totalPartidas) sonidos.push('finPartida');
      break;
    case 'juego.terminado':
      sonidos.push('podio');
      break;
    default:
      break;
  }

  const ahora = meTocaActuar(nuevo.sala);
  if (ahora && ahora !== meTocaActuar(previo.sala)) sonidos.push('turno');
  return sonidos;
}
