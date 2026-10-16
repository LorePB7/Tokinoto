import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { giroDeCarta, haciaElCentro, posicionAsiento } from '../util/geometria';
import { Asiento } from './Asiento';
import { Carta } from './Carta';

interface PropiedadesMesa {
  sala: VistaSala;
  juego: VistaJuego;
}

/** Mesa redonda de paño verde con "Tokinoto" al centro y los jugadores alrededor. */
export function MesaRedonda({ sala, juego }: PropiedadesMesa) {
  const n = juego.asientos.length;
  const tiradas = juego.bazaActual?.tiradas ?? [];
  const ganador = juego.fase === 'BAZA_RESUELTA' ? juego.bazaActual?.ganador : null;

  return (
    <div className="mesa" role="group" aria-label="Mesa de juego">
      <div className="riel">
        <div className="fieltro">
          <div className="titulo-mesa" aria-hidden="true">
            Tokinoto
          </div>
        </div>
      </div>

      <div className="cartas-en-mesa" aria-label="Cartas de la baza">
        {tiradas.map((tirada, orden) => {
          const punto = haciaElCentro(posicionAsiento(tirada.asiento, juego.miAsiento, n), n >= 6 ? 0.47 : 0.54);
          return (
            <div
              key={`${juego.bazaActual?.baza}-${tirada.asiento}`}
              className={`tirada ${ganador === tirada.asiento ? 'ganadora' : ''}`}
              style={{
                left: `${punto.x}%`,
                top: `${punto.y}%`,
                zIndex: orden + 1,
                transform: `translate(-50%, -50%) rotate(${giroDeCarta(tirada.asiento)}deg)`,
              }}
              data-tirada={tirada.asiento}
            >
              <Carta id={tirada.carta} tamano="s" resaltada={ganador === tirada.asiento} />
            </div>
          );
        })}
      </div>

      {juego.asientos.map((a) => (
        <Asiento key={a.asiento} sala={sala} juego={juego} asiento={a.asiento} />
      ))}
    </div>
  );
}
