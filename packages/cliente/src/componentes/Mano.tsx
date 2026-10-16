import type { VistaJuego } from '@tokinoto/protocolo';
import { useTienda } from '../estado/contexto';
import { ordenarMano } from '../util/cartas';
import { Carta } from './Carta';

/** Mis cartas. Se pueden tocar solo cuando me toca jugar. */
export function Mano({ juego }: { juego: VistaJuego }) {
  const jugarCarta = useTienda((s) => s.jugarCarta);
  const ocupado = useTienda((s) => s.ocupado);
  const meToca = juego.fase === 'TIRADAS' && juego.turno?.tipo === 'carta' && juego.turno.asiento === juego.miAsiento;
  const cartas = ordenarMano(juego.miMano);

  if (cartas.length === 0) return <div className="mano vacia" aria-label="No tenés cartas en la mano" />;

  return (
    <div className={`mano ${meToca ? 'activa' : ''}`} role="group" aria-label="Tu mano">
      {cartas.map((id) => (
        <Carta
          key={id}
          id={id}
          tamano="m"
          onClick={meToca ? () => void jugarCarta(id) : undefined}
          deshabilitada={ocupado}
        />
      ))}
    </div>
  );
}
