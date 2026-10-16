import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { EstadoTienda, Tienda } from './tienda';

const ContextoTienda = createContext<Tienda | null>(null);

export function ProveedorTienda({ tienda, children }: { tienda: Tienda; children: ReactNode }) {
  return <ContextoTienda.Provider value={tienda}>{children}</ContextoTienda.Provider>;
}

/** Lee una parte del estado. Se vuelve a dibujar solo cuando esa parte cambia. */
export function useTienda<T>(selector: (estado: EstadoTienda) => T): T {
  const tienda = useContext(ContextoTienda);
  if (!tienda) throw new Error('Falta el ProveedorTienda');
  return useStore(tienda, selector);
}
