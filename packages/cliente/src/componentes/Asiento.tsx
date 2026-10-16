import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { posicionAsiento } from '../util/geometria';
import { Carta } from './Carta';
import { Ficha } from './Ficha';

interface PropiedadesAsiento {
  sala: VistaSala;
  juego: VistaJuego;
  asiento: number;
}

/** Lugar de un jugador alrededor de la mesa: nombre, apuesta, bazas y sus montones. */
export function Asiento({ sala, juego, asiento }: PropiedadesAsiento) {
  const n = juego.asientos.length;
  const datos = juego.asientos[asiento];
  if (!datos) return null;
  const { x, y } = posicionAsiento(asiento, juego.miAsiento, n);
  const soyYo = asiento === juego.miAsiento;
  const apuesta = juego.apuestas[asiento] ?? null;
  const ganadas = juego.bazasGanadas[asiento] ?? 0;
  const cartas = juego.cantidades[asiento] ?? 0;
  const enTurno = juego.turno?.asiento === asiento;
  const desconectado = sala.jugadores.find((j) => j.idJugador === datos.idJugador)?.conectado === false;
  const montones = juego.bazasCerradas.filter((b) => b.ganador === asiento);
  // Los montones van hacia afuera de la mesa, para no tapar las cartas de la baza.
  const arriba = y < 42;
  const jugando = juego.fase === 'APUESTAS' || juego.fase === 'TIRADAS' || juego.fase === 'BAZA_RESUELTA';
  const esMano = jugando && juego.mano === asiento;
  const reparte = juego.partida > 0 && juego.repartidor === asiento;

  const clases = ['asiento', soyYo ? 'yo' : '', enTurno ? 'en-turno' : '', desconectado ? 'desconectado' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={clases} style={{ left: `${x}%`, top: `${y}%` }} data-asiento={asiento}>
      <div className="placa">
        <span className="nombre" title={datos.nombre}>
          {datos.nombre}
          {soyYo ? ' (vos)' : ''}
        </span>
        {(reparte || esMano || desconectado) && (
          <span className="insignias">
            {reparte && <i title="Reparte y apuesta último">Pié</i>}
            {esMano && <i title="Abre la baza">Mano</i>}
            {desconectado && <i className="alerta">Sin conexión</i>}
          </span>
        )}
        <span className="marcador">
          {apuesta === null ? (
            <span className="sin-apuesta">{juego.fase === 'APUESTAS' ? 'Sin apostar' : ''}</span>
          ) : (
            <>
              <Ficha valor={apuesta} tamano="s" titulo={`Apostó ${apuesta}`} />
              <span className="bazas" title="Bazas ganadas de las apostadas">
                {ganadas} de {apuesta}
              </span>
            </>
          )}
        </span>
        {!soyYo && cartas > 0 && (
          <span className="dorsos" aria-label={`${cartas} ${cartas === 1 ? 'carta' : 'cartas'} en mano`}>
            {Array.from({ length: Math.min(cartas, 3) }, (_, i) => (
              <Carta key={i} tamano="xs" className="mini" />
            ))}
            <span className="cuenta" aria-hidden="true">
              ×{cartas}
            </span>
          </span>
        )}
      </div>
      {montones.length > 0 && (
        <div className={`montones ${arriba ? 'arriba' : 'abajo'}`} aria-label={`Bazas ganadas por ${datos.nombre}`}>
          {montones.map((b) => (
            <span className="monton" key={b.baza} data-baza={b.baza}>
              <Carta id={b.cartaGanadora} tamano="xs" />
              {b.tieneFicha && <Ficha color="rojo" tamano="s" titulo="Dentro de la apuesta" />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
