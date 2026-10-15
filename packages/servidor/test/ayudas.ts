import {
  createSeededRng,
  currentTurn,
  getCardById,
  playableCards,
  validBetsFor,
  type Rng,
} from '@tokinoto/reglas';
import { expect } from 'vitest';
import { mensajeRespuesta, type ComandoDeSala, type MensajeServidor, type Respuesta } from '@tokinoto/protocolo';
import type { Reloj } from '../src/reloj';
import { Sala, type OpcionesSala } from '../src/sala';

/** Reloj manual: el tiempo solo avanza cuando la prueba lo pide. */
export class RelojManual implements Reloj {
  private momento = 0;
  private tareas: { cuando: number; tarea: () => void; activa: boolean }[] = [];

  ahora(): number {
    return this.momento;
  }

  programar(ms: number, tarea: () => void): () => void {
    const item = { cuando: this.momento + ms, tarea, activa: true };
    this.tareas.push(item);
    return () => {
      item.activa = false;
    };
  }

  get pendientes(): number {
    return this.tareas.filter((t) => t.activa).length;
  }

  /** Avanza `ms` milisegundos ejecutando, en orden, lo que venza en ese lapso. */
  avanzar(ms: number): void {
    const fin = this.momento + ms;
    for (;;) {
      const proxima = this.proxima();
      if (!proxima || proxima.cuando > fin) break;
      this.ejecutar(proxima);
    }
    this.momento = fin;
  }

  /** Salta hasta la próxima tarea programada y la ejecuta. Devuelve false si no había ninguna. */
  avanzarAlProximo(): boolean {
    const proxima = this.proxima();
    if (!proxima) return false;
    this.ejecutar(proxima);
    return true;
  }

  private proxima() {
    const activas = this.tareas.filter((t) => t.activa);
    return activas.sort((a, b) => a.cuando - b.cuando)[0];
  }

  private ejecutar(item: { cuando: number; tarea: () => void; activa: boolean }): void {
    item.activa = false;
    this.momento = Math.max(this.momento, item.cuando);
    this.tareas = this.tareas.filter((t) => t.activa);
    item.tarea();
  }
}

export interface JugadorDePrueba {
  id: string;
  nombre: string;
  token: string;
  /** Todo lo que recibió: respuestas a sus comandos, eventos y fotos, en orden. */
  recibidos: MensajeServidor[];
}

export interface Mesa {
  sala: Sala;
  reloj: RelojManual;
  jugadores: JugadorDePrueba[];
  errores: unknown[];
  vaciada: () => boolean;
  /** Suma un jugador más. Devuelve la respuesta y, si entró, el jugador. */
  sumar(nombre: string): { respuesta: Respuesta; jugador: JugadorDePrueba | null };
  /** Ejecuta un comando como el jugador `indice` y devuelve la respuesta. */
  comando(indice: number, comando: ComandoDeSala, idPedido?: string): Respuesta;
  /** Eventos (con seq) que recibió un jugador. */
  eventos(indice: number, tipo?: string): (MensajeServidor & { seq: number })[];
}

let contadorPedidos = 0;

export function armarMesa(
  cantidad: number,
  opciones: Partial<OpcionesSala> & { semilla?: number } = {},
): Mesa {
  const { semilla = 1, ...resto } = opciones;
  const reloj = new RelojManual();
  const errores: unknown[] = [];
  let vaciada = false;
  let juegos = 0;
  const sala = new Sala(
    'PRUEBA23',
    {
      reloj,
      crearAzar: () => createSeededRng(semilla * 1000 + juegos++),
      alError: (problema) => errores.push(problema),
      ...resto,
    },
    () => {
      vaciada = true;
    },
  );
  const jugadores: JugadorDePrueba[] = [];

  function sumar(nombre: string) {
    const recibidos: MensajeServidor[] = [];
    let respuesta: Respuesta | null = null;
    sala.unirse(nombre, { enviar: (m) => recibidos.push(m) }, (r) => {
      respuesta = r;
      recibidos.push(mensajeRespuesta('ingreso', r));
    });
    const final = respuesta as Respuesta | null;
    if (!final) throw new Error('La sala no respondió de inmediato');
    if (!final.ok) return { respuesta: final, jugador: null };
    const jugador: JugadorDePrueba = {
      id: final.datos['idJugador'] as string,
      token: final.datos['token'] as string,
      nombre,
      recibidos,
    };
    jugadores.push(jugador);
    return { respuesta: final, jugador };
  }

  for (let i = 0; i < cantidad; i++) sumar(`Jugador ${i + 1}`);

  return {
    sala,
    reloj,
    jugadores,
    errores,
    vaciada: () => vaciada,
    sumar,
    comando(indice, comando, idPedido = `p${++contadorPedidos}`) {
      const jugador = jugadores[indice];
      if (!jugador) throw new Error(`No hay jugador ${indice}`);
      let respuesta: Respuesta | null = null;
      sala.comando(jugador.id, idPedido, comando, (r) => {
        respuesta = r;
        jugador.recibidos.push(mensajeRespuesta(idPedido, r));
      });
      const final = respuesta as Respuesta | null;
      if (!final) throw new Error('La sala no respondió de inmediato');
      return final;
    },
    eventos(indice, tipo) {
      const jugador = jugadores[indice];
      if (!jugador) throw new Error(`No hay jugador ${indice}`);
      return jugador.recibidos.filter(
        (m): m is MensajeServidor & { seq: number } =>
          'seq' in m && m.tipo !== 'estado.foto' && (tipo === undefined || m.tipo === tipo),
      );
    },
  };
}

/** Índice (en mesa.jugadores) del jugador sentado en `asiento`. */
export function indiceDeAsiento(mesa: Mesa, asiento: number): number {
  const id = mesa.sala.estadoDelJuego?.players[asiento]?.id;
  const indice = mesa.jugadores.findIndex((j) => j.id === id);
  if (indice < 0) throw new Error(`Nadie en el asiento ${asiento}`);
  return indice;
}

/**
 * Juega hasta que termine el juego con jugadas legales al azar (la prueba
 * mira el estado del servidor para elegir). Avanza el reloj en las pausas.
 */
export function jugarHastaElFinal(mesa: Mesa, rng: Rng = createSeededRng(7), alPaso: () => void = () => {}): void {
  jugarHasta(mesa, () => false, rng, alPaso);
}

/** Como jugarHastaElFinal, pero se detiene apenas se cumple `parar` (o termina el juego). */
export function jugarHasta(
  mesa: Mesa,
  parar: () => boolean,
  rng: Rng = createSeededRng(7),
  alPaso: () => void = () => {},
): void {
  for (let pasos = 0; mesa.sala.estado === 'JUGANDO' && !parar(); pasos++, alPaso()) {
    if (pasos > 5000) throw new Error('El juego no termina');
    const juego = mesa.sala.estadoDelJuego!;
    const turno = currentTurn(juego);
    if (!turno) {
      expect(mesa.reloj.avanzarAlProximo()).toBe(true);
      continue;
    }
    const indice = indiceDeAsiento(mesa, turno.seat);
    const respuesta =
      turno.kind === 'bet'
        ? mesa.comando(indice, { tipo: 'juego.apostar', datos: { valor: elegir(validBetsFor(juego, turno.seat), rng) } })
        : mesa.comando(indice, {
            tipo: 'juego.jugarCarta',
            datos: { idCarta: elegir(playableCards(juego, turno.seat), rng).id },
          });
    expect(respuesta).toEqual({ ok: true, datos: {} });
  }
}

function elegir<T>(opciones: readonly T[], rng: Rng): T {
  const elegido = opciones[rng.nextInt(opciones.length)];
  if (elegido === undefined) throw new Error('No hay opciones');
  return elegido;
}

/** Todos los identificadores de carta que aparecen en un valor (búsqueda profunda). */
export function cartasEn(valor: unknown, encontradas: string[] = []): string[] {
  if (typeof valor === 'string') {
    if (getCardById(valor)) encontradas.push(valor);
  } else if (Array.isArray(valor)) {
    for (const item of valor) cartasEn(item, encontradas);
  } else if (typeof valor === 'object' && valor !== null) {
    for (const item of Object.values(valor)) cartasEn(item, encontradas);
  }
  return encontradas;
}
