import type { VistaJuego } from '@tokinoto/protocolo';
import { useTienda } from '../estado/contexto';
import { Ficha } from './Ficha';

/** Fichas del 0 al N para apostar. El valor que el Pié no puede apostar queda deshabilitado. */
export function PanelApuesta({ juego }: { juego: VistaJuego }) {
  const apostar = useTienda((s) => s.apostar);
  const ocupado = useTienda((s) => s.ocupado);
  const turno = juego.turno;
  if (juego.fase !== 'APUESTAS' || turno?.tipo !== 'apuesta' || turno.asiento !== juego.miAsiento) return null;

  const total = juego.cartasPorJugador;
  const apostado = juego.apuestas.reduce<number>((suma, valor) => suma + (valor ?? 0), 0);
  const valores = Array.from({ length: total + 1 }, (_, i) => i);

  return (
    <section className="panel-apuesta" aria-label="Apuesta">
      <h2>Hacé tu apuesta</h2>
      <p>
        ¿Cuántas bazas vas a ganar de {total}? Se apostaron {apostado}.
      </p>
      <div className="fichas-apuesta">
        {valores.map((valor) => {
          const prohibida = turno.valorProhibido === valor;
          return (
            <button
              key={valor}
              type="button"
              className="boton-ficha"
              disabled={ocupado || prohibida}
              onClick={() => void apostar(valor)}
              aria-label={prohibida ? `Apostar ${valor} (no permitido)` : `Apostar ${valor}`}
              title={prohibida ? `Como Pié, no podés apostar ${valor}: las apuestas sumarían ${total}` : undefined}
              data-apuesta={valor}
            >
              <Ficha valor={valor} />
            </button>
          );
        })}
      </div>
      {turno.valorProhibido !== null && (
        <p className="nota">
          Sos el Pié: no podés apostar {turno.valorProhibido}, porque la suma daría {total}.
        </p>
      )}
    </section>
  );
}
