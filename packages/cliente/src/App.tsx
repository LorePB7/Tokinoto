import { Aviso } from './componentes/Aviso';
import { useTienda } from './estado/contexto';
import { Inicio } from './pantallas/Inicio';
import { Lobby } from './pantallas/Lobby';
import { Mesa } from './pantallas/Mesa';

export function App() {
  const sala = useTienda((s) => s.seguimiento.sala);
  const conexion = useTienda((s) => s.conexion);
  const desincronizado = useTienda((s) => s.seguimiento.desincronizado);
  const reiniciar = useTienda((s) => s.reiniciar);

  let pantalla;
  if (conexion === 'caida') {
    pantalla = (
      <main className="inicio">
        <h1 className="logo">Tokinoto</h1>
        <div className="hoja">
          <h2>Se perdió la conexión</h2>
          <p>No hay conexión con el servidor. Volvé al inicio para entrar a una sala de nuevo.</p>
          <button type="button" className="boton" onClick={reiniciar}>
            Volver al inicio
          </button>
        </div>
      </main>
    );
  } else if (!sala) {
    pantalla = <Inicio />;
  } else if (!sala.juego) {
    pantalla = <Lobby />;
  } else {
    pantalla = <Mesa sala={sala} juego={sala.juego} />;
  }

  return (
    <>
      {pantalla}
      {desincronizado && (
        <p className="sincronizando" role="status">
          Actualizando la mesa…
        </p>
      )}
      <Aviso />
    </>
  );
}
