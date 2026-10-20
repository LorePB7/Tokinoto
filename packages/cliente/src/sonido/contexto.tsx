import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ControlSonido, EstadoSonido } from './control';

const ContextoSonido = createContext<ControlSonido | null>(null);

// Control vacío para cumplir las reglas de los hooks cuando no hay proveedor (algunas pruebas).
const SIN_SONIDO: ControlSonido = createStore<EstadoSonido>(() => ({
  activado: false,
  volumen: 0,
  musica: false,
  desbloqueado: false,
  visible: true,
  reproducir: () => undefined,
  desbloquear: () => undefined,
  setActivado: () => undefined,
  setVolumen: () => undefined,
  setMusica: () => undefined,
  setVisible: () => undefined,
}));

export function ProveedorSonido({ control, children }: { control: ControlSonido; children: ReactNode }) {
  return <ContextoSonido.Provider value={control}>{children}</ContextoSonido.Provider>;
}

/** El control del sonido, o null si no hay proveedor. */
export function useHaySonido(): boolean {
  return useContext(ContextoSonido) !== null;
}

/** Lee una parte del estado del sonido. Se vuelve a dibujar solo cuando esa parte cambia. */
export function useSonido<T>(selector: (estado: EstadoSonido) => T): T {
  const control = useContext(ContextoSonido);
  return useStore(control ?? SIN_SONIDO, selector);
}
