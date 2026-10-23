/**
 * Registro de lo que pasa en la mesa, en lenguaje simple ("Ana apuesta 2").
 * Se arma a partir de los eventos del servidor.
 */
import type { MensajeEvento, VistaSala } from '@tokinoto/protocolo';
import { infoCarta } from '../util/cartas';

export interface LineaRegistro {
  id: number;
  texto: string;
}

function nombreDeAsiento(sala: VistaSala, asiento: number): string {
  return sala.juego?.asientos[asiento]?.nombre ?? `Jugador ${asiento + 1}`;
}

function nombreDeJugador(sala: VistaSala | null, idJugador: string): string {
  return sala?.jugadores.find((j) => j.idJugador === idJugador)?.nombre ?? 'Alguien';
}

/**
 * Texto de un evento, o null si no hace falta mostrarlo. `antes` es la sala
 * antes de aplicar el evento y `despues` es la sala ya actualizada.
 */
export function describirEvento(
  evento: MensajeEvento,
  antes: VistaSala | null,
  despues: VistaSala,
): string | null {
  const nombre = (asiento: number) => nombreDeAsiento(despues, asiento);
  switch (evento.tipo) {
    case 'sala.jugadorEntro':
      return `${evento.datos.nombre} entró a la sala`;
    case 'sala.jugadorSalio':
      return evento.datos.expulsado
        ? `El anfitrión sacó a ${nombreDeJugador(antes, evento.datos.idJugador)} de la sala`
        : `${nombreDeJugador(antes, evento.datos.idJugador)} salió de la sala`;
    case 'sala.anfitrionCambio':
      return `${nombreDeJugador(despues, evento.datos.anfitrion)} es el nuevo anfitrión`;
    case 'sala.configuracion':
      return evento.datos.tiempoTurnoMs === null
        ? 'El anfitrión sacó el límite de tiempo por jugada'
        : `El anfitrión puso ${Math.round(evento.datos.tiempoTurnoMs / 1000)} segundos por jugada`;
    case 'jugador.conexion':
      return `${nombreDeJugador(despues, evento.datos.idJugador)} ${evento.datos.conectado ? 'volvió' : 'se desconectó'}`;
    case 'jugador.pilotoAutomatico': {
      const quien = nombreDeJugador(despues, evento.datos.idJugador);
      if (!evento.datos.activado) return `${quien} retomó el control`;
      switch (evento.datos.motivo) {
        case 'abandono':
          return `${quien} dejó la mesa: juega el piloto automático`;
        case 'tiempo':
          return `A ${quien} se le venció el tiempo: juega el piloto automático`;
        default:
          return `El piloto automático juega por ${quien}`;
      }
    }
    case 'juego.iniciado':
      return 'Empezó el juego';
    case 'sorteo.cartasSacadas': {
      const sacadas = evento.datos.sacadas.map((s) => `${nombre(s.asiento)} sacó ${infoCarta(s.carta).texto}`);
      const linea = `Sorteo: ${sacadas.join(', ')}`;
      return evento.datos.repiten.length > 0
        ? `${linea}. Empatan ${evento.datos.repiten.map(nombre).join(' y ')} y vuelven a sacar`
        : linea;
    }
    case 'sorteo.resultado':
      return `Reparte ${nombre(evento.datos.repartidor)}`;
    case 'partida.iniciada': {
      const { partida, cartasPorJugador } = evento.datos;
      return `Partida ${partida}: ${cartasPorJugador} ${cartasPorJugador === 1 ? 'carta' : 'cartas'} por jugador`;
    }
    case 'apuesta.realizada':
      return `${nombre(evento.datos.asiento)} apuesta ${evento.datos.valor}${evento.datos.porPiloto ? ' (piloto)' : ''}`;
    case 'baza.cartaJugada':
      return `${nombre(evento.datos.asiento)} juega ${infoCarta(evento.datos.carta).texto}${evento.datos.porPiloto ? ' (piloto)' : ''}`;
    case 'baza.resuelta':
      return `${nombre(evento.datos.ganador)} gana la baza con ${infoCarta(evento.datos.cartaGanadora).texto}`;
    case 'partida.puntajes':
      return `Terminó la partida ${evento.datos.partida}`;
    case 'juego.terminado':
      return 'Terminó el juego';
    case 'juego.abortado':
      return `Se canceló el juego: ${evento.datos.motivo}`;
    default:
      return null;
  }
}
