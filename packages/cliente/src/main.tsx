import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProveedorTienda } from './estado/contexto';
import { crearTienda } from './estado/tienda';
import { urlDelServidor } from './servidor';
import './estilos.css';

const tienda = crearTienda({ url: urlDelServidor() });

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProveedorTienda tienda={tienda}>
      <App />
    </ProveedorTienda>
  </StrictMode>,
);
