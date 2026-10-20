import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Carga } from './componentes/Carga';
import { ProveedorTienda } from './estado/contexto';
import { crearTienda } from './estado/tienda';
import { urlDelServidor } from './servidor';
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/abril-fatface/latin-ext-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-ext-700.css';
import './estilos.css';

const tienda = crearTienda({ url: urlDelServidor() });
// Si esta pestaña ya estaba en una sala (por ejemplo, al recargar), vuelve a su asiento.
void tienda.getState().retomarSesion();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProveedorTienda tienda={tienda}>
      <App />
      <Carga />
    </ProveedorTienda>
  </StrictMode>,
);
