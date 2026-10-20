/** Ayudas para probar el cliente contra un servidor real. */
import { crearServidor, type ServidorTokinoto } from '@tokinoto/servidor';
import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { almacenEnMemoria, type AlmacenSesion } from '../src/estado/sesion';
import { crearTienda, type Tienda } from '../src/estado/tienda';

/** Una tienda de prueba: sesión en memoria y reintentos rápidos. */
export function tiendaDePrueba(url: string, almacen: AlmacenSesion = almacenEnMemoria()): Tienda {
  return crearTienda({ url, almacen, esperasDeReconexion: [20, 50, 100] });
}

export interface Mundo {
  servidor: ServidorTokinoto;
  url: string;
  tiendas: Tienda[];
  cerrar(): Promise<void>;
}

export async function levantarMundo(): Promise<Mundo> {
  const servidor = crearServidor({ sala: { pausaBazaMs: 10, pausaResumenMs: 20, pausaPilotoMs: 10 }, limite: { capacidad: 10_000, porSegundo: 10_000 } });
  const puerto = await servidor.escuchar(0, '127.0.0.1');
  const url = `http://127.0.0.1:${puerto}`;
  const tiendas: Tienda[] = [];
  const mundo: Mundo = {
    servidor,
    url,
    tiendas,
    async cerrar() {
      for (const t of tiendas) t.getState().reiniciar();
      await mundo.servidor.cerrar();
    },
  };
  return mundo;
}

export async function esperar(condicion: () => boolean, ms = 8000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error('Se agotó el tiempo esperando una condición');
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function salaDe(t: Tienda): VistaSala | null {
  return t.getState().seguimiento.sala;
}
export function juegoDe(t: Tienda): VistaJuego | null {
  return salaDe(t)?.juego ?? null;
}

/** Crea una sala con `n` jugadores conectados y empieza el juego. */
export async function armarMesa(mundo: Mundo, n: number): Promise<Tienda[]> {
  const nuevas = Array.from({ length: n }, () => tiendaDePrueba(mundo.url));
  mundo.tiendas.push(...nuevas);
  const [anfitrion, ...resto] = nuevas;
  if (!anfitrion) throw new Error('Hacen falta jugadores');
  if (!(await anfitrion.getState().crearSala('Jugador 1'))) throw new Error('No se pudo crear la sala');
  const codigo = salaDe(anfitrion)?.codigo ?? '';
  for (const [i, t] of resto.entries()) {
    if (!(await t.getState().unirse(codigo, `Jugador ${i + 2}`))) throw new Error('No se pudo unir');
  }
  await esperar(() => nuevas.every((t) => salaDe(t)?.jugadores.length === n));
  if (!(await anfitrion.getState().iniciar())) throw new Error('No se pudo iniciar');
  return nuevas;
}

/** Hace la jugada que le toca a `t`, si le toca. Devuelve true si jugó. */
export async function jugarSiToca(t: Tienda): Promise<boolean> {
  const juego = juegoDe(t);
  const turno = juego?.turno;
  if (!juego || !turno || turno.asiento !== juego.miAsiento || t.getState().ocupado) return false;
  if (juego.fase === 'APUESTAS' && turno.tipo === 'apuesta') {
    return t.getState().apostar(turno.valorProhibido === 0 ? 1 : 0);
  }
  if (juego.fase === 'TIRADAS' && turno.tipo === 'carta') {
    const carta = juego.miMano[0];
    return carta ? t.getState().jugarCarta(carta) : false;
  }
  return false;
}

/** Mueve a todos los jugadores hasta que se cumpla `condicion`. */
export async function jugarHasta(tiendas: Tienda[], condicion: () => boolean, ms = 20000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error('Se agotó el tiempo jugando');
    let movio = false;
    for (const t of tiendas) movio = (await jugarSiToca(t)) || movio;
    if (!movio) await new Promise((r) => setTimeout(r, 5));
  }
}
