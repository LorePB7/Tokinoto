/**
 * Control del sonido: preferencias (activado, volumen, música), cuándo se puede
 * sonar y qué se manda al sintetizador. No genera audio: eso lo hace el
 * `Sintetizador`, que en las pruebas se reemplaza por uno falso.
 *
 * - Todo arranca activado (pedido de Lorenzo), con volumen bajo.
 * - Los navegadores no dejan sonar hasta el primer toque: antes de `desbloquear`
 *   no suena nada (no se acumula).
 * - La música se corta con la pestaña en segundo plano.
 * - Los avisos de turno y de chat no suenan en cascada.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { guardarPreferencia, leerPreferencia } from '../util/preferencias';

export type NombreSonido = 'clic' | 'carta' | 'baza' | 'turno' | 'turnoAjeno' | 'finPartida' | 'podio' | 'chat';

export const SONIDOS: readonly NombreSonido[] = ['clic', 'carta', 'baza', 'turno', 'turnoAjeno', 'finPartida', 'podio', 'chat'];

/** Lo que genera el audio de verdad. `volumen` va de 0 a 1. */
export interface Sintetizador {
  /**
   * Prepara el audio, o lo reanuda si el navegador lo dejó en pausa. Se llama en cada gesto
   * de la persona: el primero puede no alcanzar (en celulares, apoyar el dedo no cuenta;
   * levantarlo, sí).
   */
  desbloquear(): void;
  tocar(nombre: NombreSonido, volumen: number): void;
  /** Prende, apaga o cambia el volumen de la música de fondo. */
  musica(activa: boolean, volumen: number): void;
}

export const VOLUMEN_INICIAL = 0.5;

/** Separación mínima entre dos veces el mismo sonido, en ms. */
export const SEPARACION_MS: Record<NombreSonido, number> = {
  clic: 40,
  carta: 40,
  baza: 200,
  turno: 1500,
  turnoAjeno: 250,
  finPartida: 1000,
  podio: 1000,
  chat: 1000,
};

export interface EstadoSonido {
  activado: boolean;
  volumen: number;
  musica: boolean;
  /** La persona ya tocó la pantalla: el navegador deja sonar. */
  desbloqueado: boolean;
  /** La pestaña está a la vista. */
  visible: boolean;

  reproducir(nombre: NombreSonido): void;
  desbloquear(): void;
  setActivado(activado: boolean): void;
  setVolumen(volumen: number): void;
  setMusica(musica: boolean): void;
  setVisible(visible: boolean): void;
}

export type ControlSonido = StoreApi<EstadoSonido>;

const recortar = (v: number) => Math.min(1, Math.max(0, v));

function leerBooleano(clave: string, porDefecto: boolean): boolean {
  const valor = leerPreferencia(clave);
  return valor === null ? porDefecto : valor === '1';
}

function leerVolumen(): number {
  const valor = Number(leerPreferencia('sonido.volumen'));
  return leerPreferencia('sonido.volumen') !== null && Number.isFinite(valor) ? recortar(valor) : VOLUMEN_INICIAL;
}

export function crearControlSonido(sintetizador: Sintetizador, ahora: () => number = () => Date.now()): ControlSonido {
  const ultimaVez = new Map<NombreSonido, number>();

  const control = createStore<EstadoSonido>((set, get) => ({
    activado: leerBooleano('sonido.activado', true),
    volumen: leerVolumen(),
    musica: leerBooleano('sonido.musica', true),
    desbloqueado: false,
    visible: true,

    reproducir(nombre) {
      const { activado, desbloqueado, volumen } = get();
      if (!activado || !desbloqueado || volumen <= 0) return;
      const t = ahora();
      const previa = ultimaVez.get(nombre);
      if (previa !== undefined && t - previa < SEPARACION_MS[nombre]) return;
      ultimaVez.set(nombre, t);
      sintetizador.tocar(nombre, volumen);
    },
    desbloquear() {
      sintetizador.desbloquear();
      if (!get().desbloqueado) set({ desbloqueado: true });
    },
    setActivado(activado) {
      guardarPreferencia('sonido.activado', activado ? '1' : '0');
      set({ activado });
    },
    setVolumen(volumen) {
      const v = recortar(volumen);
      guardarPreferencia('sonido.volumen', String(v));
      set({ volumen: v });
    },
    setMusica(musica) {
      guardarPreferencia('sonido.musica', musica ? '1' : '0');
      set({ musica });
    },
    setVisible: (visible) => set({ visible }),
  }));

  // La música sigue al estado: suena solo si todo lo permite.
  let musicaPrevia: string | null = null;
  const sincronizarMusica = (e: EstadoSonido) => {
    const activa = e.activado && e.musica && e.desbloqueado && e.visible && e.volumen > 0;
    const clave = activa ? `on:${e.volumen}` : 'off';
    if (clave === musicaPrevia) return;
    // Antes del primer toque no hay audio: no hace falta avisar que está apagada.
    if (musicaPrevia === null && !activa) {
      musicaPrevia = clave;
      return;
    }
    musicaPrevia = clave;
    sintetizador.musica(activa, e.volumen);
  };
  sincronizarMusica(control.getState());
  control.subscribe(sincronizarMusica);

  return control;
}
