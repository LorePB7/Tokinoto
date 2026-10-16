import type { VistaJuego } from '@tokinoto/protocolo';
import { useTienda } from '../estado/contexto';

/** Botones del 0 al N para apostar. El valor que el Pié no puede apostar queda tachado y deshabilitado. */
export function PanelApuesta({ juego }: { juego: VistaJuego }) {
  const apostar = useTienda((s) => s.apostar);
  const ocupado = useTienda((s) => s.ocupado || s.conexion !== 'conectada');
  const turno = juego.turno;
  if (juego.fase !== 'APUESTAS' || turno?.tipo !== 'apuesta' || turno.asiento !== juego.miAsiento) return null;

  const total = juego.cartasPorJugador;
  const apostado = juego.apuestas.reduce<number>((suma, valor) => suma + (valor ?? 0), 0);
  const valores = Array.from({ length: total + 1 }, (_, i) => i);

  return (
    <section className="panel-apuesta" aria-label="Apuesta">
      <p className="instruccion">¿Cuántas bazas pensás ganar de {total}? Tocá un número.</p>
      <div className="botones-apuesta">
        {valores.map((valor) => {
          const prohibida = turno.valorProhibido === valor;
          return (
            <button
              key={valor}
              type="button"
              className="boton-apuesta"
              disabled={ocupado || prohibida}
              onClick={() => void apostar(valor)}
              aria-label={prohibida ? `Apostar ${valor} (no permitido)` : `Apostar ${valor}`}
              title={prohibida ? `Como Pié, no podés apostar ${valor}: las apuestas sumarían ${total}` : undefined}
              data-apuesta={valor}
            >
              {valor}
            </button>
          );
        })}
      </div>
      <p className="nota">
        Hasta ahora la mesa apostó {apostado} en total.
        {turno.valorProhibido !== null && (
          <b className="aviso-pie">
            {' '}
            Sos el Pié: no podés apostar {turno.valorProhibido}, porque la suma daría {total}.
          </b>
        )}
      </p>
    </section>
  );
}
