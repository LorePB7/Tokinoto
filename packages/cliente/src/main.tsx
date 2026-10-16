import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProveedorTienda } from './estado/contexto';
import { crearTienda } from './estado/tienda';
import { urlDelServidor } from './servidor';
import './estilos.css';

const tienda = crearTienda({ url: urlDelServidor() });
// Si esta pestaña ya estaba en una sala (por ejemplo, al recargar), vuelve a su asiento.
void tienda.getState().retomarSesion();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProveedorTienda tienda={tienda}>
      <App />
    </ProveedorTienda>
  </StrictMode>,
);
