import type { NombreSonido } from '../sonido/control';
import { SONIDOS } from '../sonido/control';
import { useSonido } from '../sonido/contexto';
import { ControlSonido } from '../componentes/ControlSonido';

const NOMBRES: Record<NombreSonido, string> = {
  clic: 'Botón',
  carta: 'Tirar carta',
  baza: 'Ganar baza',
  turno: 'Tu turno',
  finPartida: 'Fin de partida',
  podio: 'Podio',
  chat: 'Mensaje de chat',
};

/** Pantalla para escuchar cada sonido (se abre con #sonidos al final de la dirección). */
export function PruebaSonidos() {
  const reproducir = useSonido((s) => s.reproducir);
  const musica = useSonido((s) => s.musica);
  const setMusica = useSonido((s) => s.setMusica);
  return (
    <main className="inicio prueba-sonidos">
      <ControlSonido flotante />
      <h1 className="logo">Tokinoto</h1>
      <div className="hoja">
        <h2>Prueba de sonidos</h2>
        <p>Tocá cada botón para escucharlo. Arriba a la izquierda están el volumen y el silencio.</p>
        <div className="botones-prueba">
          {SONIDOS.map((nombre) => (
            <button key={nombre} type="button" data-sin-clic className="boton secundario" onClick={() => reproducir(nombre)}>
              {NOMBRES[nombre]}
            </button>
          ))}
        </div>
        <div className="acciones">
          <button type="button" className="boton" onClick={() => setMusica(!musica)}>
            {musica ? 'Apagar la música' : 'Prender la música'}
          </button>
          <a className="boton secundario" href="./">
            Volver al juego
          </a>
        </div>
      </div>
    </main>
  );
}
