import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Carga } from './componentes/Carga';
import { ProveedorTienda } from './estado/contexto';
import { crearTienda } from './estado/tienda';
import { PruebaSonidos } from './pantallas/PruebaSonidos';
import { urlDelServidor } from './servidor';
import { conectarSonido, sonarMensajes } from './sonido/conectar';
import { ProveedorSonido } from './sonido/contexto';
import { crearControlSonido } from './sonido/control';
import { crearSintetizadorWebAudio } from './sonido/sintetizador';
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/abril-fatface/latin-ext-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-ext-700.css';
import './estilos.css';

const sonido = crearControlSonido(crearSintetizadorWebAudio());
conectarSonido(sonido);

const tienda = crearTienda({ url: urlDelServidor(), alMensaje: sonarMensajes(sonido) });
// Si esta pestaña ya estaba en una sala (por ejemplo, al recargar), vuelve a su asiento.
void tienda.getState().retomarSesion();

// Con #sonidos al final de la dirección se abre la pantalla para escuchar cada sonido.
const pruebaDeSonidos = window.location.hash === '#sonidos';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProveedorSonido control={sonido}>
      <ProveedorTienda tienda={tienda}>
        {pruebaDeSonidos ? <PruebaSonidos /> : <App />}
        <Carga />
      </ProveedorTienda>
    </ProveedorSonido>
  </StrictMode>,
);
