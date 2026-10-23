/**
 * Seguimiento del estado del lado del cliente.
 *
 * El cliente arranca con una foto (`estado.foto`) y la mantiene al día
 * aplicando cada evento en orden. Si detecta un salto en `seq`, queda
 * "desincronizado": ignora eventos hasta recibir una foto nueva (que pide
 * con `sync.pedir`).
 *
 * Garantía que verifican las pruebas: en cualquier momento, la foto que
 * arma el servidor es igual al resultado de aplicar los eventos recibidos.
 *
 * Todas las funciones son puras: no modifican el estado que reciben.
 */
import { DEFAULT_CONFIG } from '@tokinoto/reglas';
import { MENSAJES_DE_CHAT_GUARDADOS, type AsientoPublico, type MensajeEvento, type MensajeServidor } from './protocolo';
import type { VistaJuego, VistaSala } from './vista';

export interface EstadoCliente {
  /** Último `seq` aplicado (0 = todavía nada). */
  seq: number;
  sala: VistaSala | null;
  /** Se detectó un salto: hay que pedir una foto con `sync.pedir`. */
  desincronizado: boolean;
}

export const ESTADO_CLIENTE_INICIAL: EstadoCliente = { seq: 0, sala: null, desincronizado: false };

/** Aplica un mensaje del servidor. Devuelve el estado nuevo (o el mismo si no cambia nada). */
export function aplicarMensaje(estado: EstadoCliente, mensaje: MensajeServidor): EstadoCliente {
  if (mensaje.tipo === 'estado.foto') {
    return { seq: mensaje.seq, sala: structuredClone(mensaje.datos), desincronizado: false };
  }
  if (mensaje.tipo === 'ok' || mensaje.tipo === 'error' || mensaje.tipo === 'sala.expulsado') return estado;
  if (mensaje.tipo === 'chat.mensaje') return agregarChat(estado, mensaje.datos);

  // Mientras espera una foto, ignora los eventos.
  if (!estado.sala || estado.desincronizado) return estado;
  // Repetido o viejo: ya está aplicado.
  if (mensaje.seq <= estado.seq) return estado;
  if (mensaje.seq !== estado.seq + 1) return { ...estado, desincronizado: true };

  const sala = structuredClone(estado.sala);
  if (!aplicarEvento(sala, mensaje)) return { ...estado, desincronizado: true };
  return { seq: mensaje.seq, sala, desincronizado: false };
}

/**
 * Suma un mensaje de chat. El chat va fuera de la secuencia de eventos: no
 * toca `seq` ni marca desincronización. Uno repetido o más viejo que el
 * último se ignora (la foto ya lo trae).
 */
function agregarChat(estado: EstadoCliente, mensaje: Extract<MensajeServidor, { tipo: 'chat.mensaje' }>['datos']): EstadoCliente {
  if (!estado.sala) return estado;
  const ultimo = estado.sala.chat.at(-1);
  if (ultimo && mensaje.id <= ultimo.id) return estado;
  const chat = [...estado.sala.chat, { ...mensaje }].slice(-MENSAJES_DE_CHAT_GUARDADOS);
  return { ...estado, sala: { ...estado.sala, chat } };
}

/** Un juego recién iniciado, antes del sorteo. */
export function juegoNuevo(asientos: AsientoPublico[], yo: string): VistaJuego {
  const n = asientos.length;
  return {
    fase: 'SORTEO',
    asientos: structuredClone(asientos),
    miAsiento: asientos.findIndex((a) => a.idJugador === yo),
    sorteo: [],
    repartidor: null,
    partida: 0,
    totalPartidas: DEFAULT_CONFIG.cardsPerRound.length,
    cartasPorJugador: 0,
    mano: null,
    miMano: [],
    cantidades: Array.from({ length: n }, () => 0),
    apuestas: Array.from({ length: n }, () => null),
    bazasGanadas: Array.from({ length: n }, () => 0),
    bazaActual: null,
    bazasCerradas: [],
    puntajes: Array.from({ length: n }, () => []),
    totales: Array.from({ length: n }, () => 0),
    turno: null,
    ranking: null,
    motivoAborto: null,
    finResumen: null,
  };
}

/**
 * Aplica un evento sobre una vista de sala (la modifica). Devuelve false si
 * el evento no encaja con lo que el cliente sabe (por ejemplo, un evento de
 * juego sin juego): en ese caso conviene pedir una foto.
 */
function aplicarEvento(sala: VistaSala, evento: MensajeEvento): boolean {
  switch (evento.tipo) {
    case 'sala.jugadorEntro':
      sala.jugadores.push({
        idJugador: evento.datos.idJugador,
        nombre: evento.datos.nombre,
        conectado: true,
        piloto: null,
        bot: evento.datos.bot ?? null,
      });
      return true;
    case 'sala.jugadorSalio':
      sala.jugadores = sala.jugadores.filter((j) => j.idJugador !== evento.datos.idJugador);
      return true;
    case 'sala.anfitrionCambio':
      sala.anfitrion = evento.datos.anfitrion;
      return true;
    case 'sala.configuracion':
      sala.tiempoTurnoMs = evento.datos.tiempoTurnoMs;
      return true;
    case 'jugador.conexion': {
      const jugador = sala.jugadores.find((j) => j.idJugador === evento.datos.idJugador);
      if (!jugador) return false;
      jugador.conectado = evento.datos.conectado;
      return true;
    }
    case 'jugador.pilotoAutomatico': {
      const jugador = sala.jugadores.find((j) => j.idJugador === evento.datos.idJugador);
      if (!jugador) return false;
      jugador.piloto = evento.datos.activado ? evento.datos.motivo : null;
      return true;
    }
    case 'juego.iniciado':
      sala.estado = 'JUGANDO';
      sala.juego = juegoNuevo(evento.datos.asientos, sala.yo);
      return true;
    default:
      return sala.juego ? aplicarEventoDeJuego(sala, sala.juego, evento) : false;
  }
}

function aplicarEventoDeJuego(sala: VistaSala, juego: VistaJuego, evento: MensajeEvento): boolean {
  switch (evento.tipo) {
    case 'sorteo.cartasSacadas':
      juego.sorteo.push(structuredClone(evento.datos));
      return true;

    case 'sorteo.resultado':
      juego.repartidor = evento.datos.repartidor;
      return true;

    case 'partida.iniciada': {
      const n = juego.asientos.length;
      juego.fase = 'APUESTAS';
      juego.partida = evento.datos.partida;
      juego.cartasPorJugador = evento.datos.cartasPorJugador;
      juego.repartidor = evento.datos.repartidor;
      juego.mano = evento.datos.mano;
      juego.miMano = [];
      juego.apuestas = Array.from({ length: n }, () => null);
      juego.bazasGanadas = Array.from({ length: n }, () => 0);
      juego.bazaActual = null;
      juego.bazasCerradas = [];
      juego.turno = null;
      juego.finResumen = null;
      return true;
    }

    case 'partida.manoRepartida':
      juego.miMano = [...evento.datos.cartas];
      juego.cantidades = [...evento.datos.cantidades];
      return true;

    case 'apuesta.turno':
      juego.turno = {
        tipo: 'apuesta',
        asiento: evento.datos.asiento,
        valorProhibido: evento.datos.valorProhibido,
        fechaLimite: evento.datos.fechaLimite,
      };
      return true;

    case 'apuesta.realizada':
      juego.apuestas[evento.datos.asiento] = evento.datos.valor;
      juego.turno = null;
      return true;

    case 'baza.iniciada':
      juego.fase = 'TIRADAS';
      juego.mano = evento.datos.mano;
      juego.bazaActual = { baza: evento.datos.baza, mano: evento.datos.mano, tiradas: [], ganador: null };
      return true;

    case 'baza.turno':
      juego.turno = { tipo: 'carta', asiento: evento.datos.asiento, fechaLimite: evento.datos.fechaLimite };
      return true;

    case 'baza.cartaJugada': {
      const { asiento, carta } = evento.datos;
      if (!juego.bazaActual) return false;
      juego.bazaActual.tiradas.push({ asiento, carta });
      juego.cantidades[asiento] = (juego.cantidades[asiento] ?? 0) - 1;
      if (asiento === juego.miAsiento) juego.miMano = juego.miMano.filter((c) => c !== carta);
      juego.turno = null;
      return true;
    }

    case 'baza.resuelta': {
      const { baza, ganador, cartaGanadora, tieneFicha } = evento.datos;
      if (!juego.bazaActual) return false;
      juego.fase = 'BAZA_RESUELTA';
      juego.bazaActual.ganador = ganador;
      juego.bazasGanadas[ganador] = (juego.bazasGanadas[ganador] ?? 0) + 1;
      juego.bazasCerradas.push({ baza, ganador, cartaGanadora, tieneFicha });
      juego.mano = ganador;
      juego.turno = null;
      return true;
    }

    case 'partida.puntajes':
      juego.fase = 'RESUMEN';
      for (const resultado of evento.datos.resultados) {
        const puntos = juego.puntajes[resultado.asiento];
        if (!puntos) return false;
        puntos[evento.datos.partida - 1] = resultado.puntos;
      }
      juego.totales = [...evento.datos.totales];
      juego.finResumen = evento.datos.finResumen;
      return true;

    case 'juego.terminado':
      sala.estado = 'TERMINADO';
      juego.fase = 'TERMINADO';
      juego.ranking = structuredClone(evento.datos.ranking);
      juego.turno = null;
      juego.finResumen = null;
      return true;

    case 'juego.abortado':
      sala.estado = 'TERMINADO';
      juego.fase = 'ABORTADO';
      juego.motivoAborto = evento.datos.motivo;
      juego.turno = null;
      juego.finResumen = null;
      return true;

    default:
      return false;
  }
}
