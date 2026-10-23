import type { CSSProperties } from 'react';
import type { VistaJuego, VistaSala } from '@tokinoto/protocolo';
import { MESA_LLENA, posicionAsiento, RADIO } from '../util/geometria';
import { Carta } from './Carta';
import { CuentaRegresiva } from './CuentaRegresiva';
import { Ficha } from './Ficha';
import { InsigniaBot } from './Bots';

const TEXTO_PILOTO = {
  desconexion: 'Se desconectó: el piloto automático juega por él',
  abandono: 'Dejó la mesa: el piloto automático juega por él',
  tiempo: 'Se le venció el tiempo varias veces: el piloto automático juega por él',
} as const;

/** Un timón chico: marca que el piloto automático juega por ese jugador. */
function IconoPiloto() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <path d="M12 9.4V3.5M9.7 13.3 4.6 16.2M14.3 13.3l5.1 2.9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

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
  // Dirección del asiento desde el centro (de -1 a 1). El CSS la multiplica por el radio horizontal y el vertical de la mesa.
  const direccion = { '--ux': (x - 50) / RADIO, '--uy': (y - 50) / RADIO } as CSSProperties;
  const soyYo = asiento === juego.miAsiento;
  const apuesta = juego.apuestas[asiento] ?? null;
  const ganadas = juego.bazasGanadas[asiento] ?? 0;
  const cartas = juego.cantidades[asiento] ?? 0;
  const enTurno = juego.turno?.asiento === asiento;
  const jugador = sala.jugadores.find((j) => j.idJugador === datos.idJugador);
  const desconectado = jugador?.conectado === false;
  const piloto = jugador?.piloto ?? null;
  const bot = jugador?.bot ?? null;
  const fechaLimite = enTurno ? (juego.turno?.fechaLimite ?? null) : null;
  const montones = juego.bazasCerradas.filter((b) => b.ganador === asiento);
  // Los montones van hacia afuera de la mesa, para no tapar las cartas de la baza. Los asientos de los
  // costados que quedan apenas arriba del centro también los llevan arriba, para no pisar al vecino de abajo.
  const arriba = (y - 50) / RADIO < -0.15;
  // Los asientos de la cima de la mesa: en pantallas anchas sus montones van al costado de afuera,
  // para no subir hasta la barra de arriba.
  const cima = (y - 50) / RADIO < -0.75 ? (x < 50 - 0.5 ? 'cima izq' : 'cima der') : '';
  const jugando = juego.fase === 'APUESTAS' || juego.fase === 'TIRADAS' || juego.fase === 'BAZA_RESUELTA';
  const esMano = jugando && juego.mano === asiento;
  const reparte = juego.partida > 0 && juego.repartidor === asiento;

  const clases = ['asiento', soyYo ? 'yo' : '', enTurno ? 'en-turno' : '', desconectado ? 'desconectado' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={clases} style={direccion} data-asiento={asiento}>
      <div className="placa">
        <span className="nombre" title={datos.nombre}>
          {/* Fase 8: el ícono del bot va en el renglón del nombre, así la placa no crece. */}
          {bot && <InsigniaBot nivel={bot} />}
          {/* En una mesa llena, la placa propia dice solo "Vos": es más angosta y no pisa a los vecinos. */}
          {soyYo && n >= MESA_LLENA ? 'Vos' : `${datos.nombre}${soyYo ? ' (vos)' : ''}`}
        </span>
        {(reparte || esMano || desconectado || piloto || fechaLimite !== null) && (
          <span className="insignias">
            {reparte && <i title="Reparte y apuesta último">Pié</i>}
            {esMano && <i title="Abre la baza">Mano</i>}
            {desconectado && !piloto && <i className="alerta">Sin conexión</i>}
            {piloto && (
              <i className="piloto" title={TEXTO_PILOTO[piloto]} role="img" aria-label="Piloto automático">
                <IconoPiloto />
              </i>
            )}
            {fechaLimite !== null && <CuentaRegresiva fechaLimite={fechaLimite} />}
          </span>
        )}
        <span className="marcador">
          {apuesta === null ? (
            <span className="sin-apuesta">{juego.fase === 'APUESTAS' ? 'Sin apostar' : ''}</span>
          ) : (
            <>
              <Ficha valor={apuesta} tamano="s" titulo={`Apostó ${apuesta}`} />
              <span className="cuentas">
                <span className="apostado">Apostó {apuesta}</span>
                <span className="ganado">Ganó {ganadas}</span>
              </span>
            </>
          )}
        </span>
        {!soyYo && cartas > 0 && (
          <span className="dorsos" aria-label={`${cartas} ${cartas === 1 ? 'carta' : 'cartas'} en mano`}>
            {Array.from({ length: Math.min(cartas, 3) }, (_, i) => (
              <Carta key={i} tamano="xs" className="mini" />
            ))}
          </span>
        )}
      </div>
      {montones.length > 0 && (
        <div className={['montones', arriba ? 'arriba' : 'abajo', cima].filter(Boolean).join(' ')} aria-label={`Bazas ganadas por ${datos.nombre}`}>
          {montones.map((b) => (
            <span className="monton" key={b.baza} data-baza={b.baza}>
              <Carta id={b.cartaGanadora} tamano="xs" />
              {b.tieneFicha && <Ficha tamano="s" titulo="Dentro de la apuesta" />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
