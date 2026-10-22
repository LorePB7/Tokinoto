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

  const reconectar = useTienda((s) => s.reconectar);
  const codigoSala = useTienda((s) => s.codigoSala);

  let pantalla;
  if (conexion === 'reemplazada') {
    pantalla = (
      <main className="inicio">
        <h1 className="logo">Tokinoto</h1>
        <div className="hoja">
          <h2>Abriste esta mesa en otra pestaña</h2>
          <p>Para no jugar dos veces, esta pestaña se desconectó.</p>
          <div className="acciones">
            {codigoSala && (
              <button type="button" className="boton" onClick={() => void reconectar()}>
                Jugar en esta pestaña
              </button>
            )}
            <button type="button" className="boton secundario" onClick={reiniciar}>
              Volver al inicio
            </button>
          </div>
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
      {conexion === 'reconectando' && (
        <div className="reconectando" role="status">
          <p>Se cortó la conexión. Volviendo a la mesa…</p>
          <button type="button" className="boton chico secundario" onClick={reiniciar}>
            Volver al inicio
          </button>
        </div>
      )}
      {conexion === 'conectada' && desincronizado && (
        <p className="sincronizando" role="status">
          Actualizando la mesa…
        </p>
      )}
      <Aviso />
      <div className="girar-telefono" role="alert">
        <p>Girá el teléfono para jugar.</p>
      </div>
    </>
  );
}
