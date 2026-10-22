import type { EstadoCliente, MensajeServidor } from '@tokinoto/protocolo';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { ControlSonido } from '../src/componentes/ControlSonido';
import { almacenEnMemoria } from '../src/estado/sesion';
import { crearTienda, type Tienda } from '../src/estado/tienda';
import { conectarSonido, sonarMensajes } from '../src/sonido/conectar';
import { ProveedorSonido } from '../src/sonido/contexto';
import { crearControlSonido, SEPARACION_MS, VOLUMEN_INICIAL, type NombreSonido, type Sintetizador } from '../src/sonido/control';
import { sonidosDelMensaje } from '../src/sonido/eventos';
import { crearComo, esperar, jugarHasta, juegoDe, levantarMundo, salaDe, tiendaDePrueba, unirseComo, type Mundo } from './ayuda';

/** Sintetizador falso: anota lo que le piden. */
function sintetizadorFalso() {
  const tocados: { nombre: NombreSonido; volumen: number }[] = [];
  const musica: { activa: boolean; volumen: number }[] = [];
  let desbloqueos = 0;
  const s: Sintetizador = {
    desbloquear: () => void desbloqueos++,
    tocar: (nombre, volumen) => void tocados.push({ nombre, volumen }),
    musica: (activa, volumen) => void musica.push({ activa, volumen }),
  };
  return { s, tocados, musica, desbloqueos: () => desbloqueos };
}

beforeEach(() => window.localStorage.clear());

describe('control del sonido', () => {
  it('arranca activado, con volumen bajo y música', () => {
    const c = crearControlSonido(sintetizadorFalso().s).getState();
    expect(c.activado).toBe(true);
    expect(c.musica).toBe(true);
    expect(c.volumen).toBe(VOLUMEN_INICIAL);
  });

  it('no suena antes del primer toque, ni se acumula', () => {
    const f = sintetizadorFalso();
    const c = crearControlSonido(f.s);
    c.getState().reproducir('carta');
    expect(f.tocados).toEqual([]);
    c.getState().desbloquear();
    // Cada gesto vuelve a avisar: si el navegador dejó el audio en pausa, lo reanuda.
    c.getState().desbloquear();
    expect(f.desbloqueos()).toBe(2);
    expect(c.getState().desbloqueado).toBe(true);
    expect(f.tocados).toEqual([]);
    c.getState().reproducir('carta');
    expect(f.tocados).toEqual([{ nombre: 'carta', volumen: VOLUMEN_INICIAL }]);
  });

  it('respeta el silencio y el volumen en cero', () => {
    const f = sintetizadorFalso();
    const c = crearControlSonido(f.s);
    c.getState().desbloquear();
    c.getState().setActivado(false);
    c.getState().reproducir('baza');
    c.getState().setActivado(true);
    c.getState().setVolumen(0);
    c.getState().reproducir('baza');
    expect(f.tocados).toEqual([]);
    c.getState().setVolumen(0.8);
    c.getState().reproducir('baza');
    expect(f.tocados).toEqual([{ nombre: 'baza', volumen: 0.8 }]);
  });

  it('recuerda la elección en el navegador', () => {
    const c = crearControlSonido(sintetizadorFalso().s).getState();
    c.setActivado(false);
    c.setVolumen(0.3);
    c.setMusica(false);
    const otra = crearControlSonido(sintetizadorFalso().s).getState();
    expect(otra.activado).toBe(false);
    expect(otra.volumen).toBe(0.3);
    expect(otra.musica).toBe(false);
  });

  it('ignora un volumen guardado inválido', () => {
    window.localStorage.setItem('tokinoto.sonido.volumen', 'basura');
    expect(crearControlSonido(sintetizadorFalso().s).getState().volumen).toBe(VOLUMEN_INICIAL);
  });

  it('el aviso de turno no suena en cascada', () => {
    const f = sintetizadorFalso();
    let ahora = 1000;
    const c = crearControlSonido(f.s, () => ahora);
    c.getState().desbloquear();
    c.getState().reproducir('turno');
    ahora += 100;
    c.getState().reproducir('turno');
    ahora += SEPARACION_MS.turno;
    c.getState().reproducir('turno');
    expect(f.tocados.map((t) => t.nombre)).toEqual(['turno', 'turno']);
  });

  it('la música suena solo con el primer toque, la pestaña visible y todo activado', () => {
    const f = sintetizadorFalso();
    const c = crearControlSonido(f.s);
    expect(f.musica).toEqual([]);
    c.getState().desbloquear();
    expect(f.musica.at(-1)).toEqual({ activa: true, volumen: VOLUMEN_INICIAL });
    c.getState().setVisible(false);
    expect(f.musica.at(-1)?.activa).toBe(false);
    c.getState().setVisible(true);
    expect(f.musica.at(-1)?.activa).toBe(true);
    c.getState().setVolumen(0.2);
    expect(f.musica.at(-1)).toEqual({ activa: true, volumen: 0.2 });
    c.getState().setMusica(false);
    expect(f.musica.at(-1)?.activa).toBe(false);
    c.getState().setMusica(true);
    c.getState().setActivado(false);
    expect(f.musica.at(-1)?.activa).toBe(false);
  });
});

describe('conexión con la página', () => {
  let desconectar: (() => void) | null = null;
  afterEach(() => desconectar?.());

  it('el primer toque desbloquea y los botones hacen clic, salvo las cartas', () => {
    const f = sintetizadorFalso();
    const c = crearControlSonido(f.s);
    desconectar = conectarSonido(c);
    document.body.innerHTML =
      '<button id="b">Ok</button><button id="d" disabled>No</button><button class="carta" id="c">7</button>';
    fireEvent.pointerDown(document.body);
    expect(c.getState().desbloqueado).toBe(true);
    fireEvent.click(document.getElementById('c')!);
    fireEvent.click(document.getElementById('d')!);
    expect(f.tocados).toEqual([]);
    fireEvent.click(document.getElementById('b')!);
    expect(f.tocados.map((t) => t.nombre)).toEqual(['clic']);
  });

  it('en celulares, levantar el dedo también reanuda el audio', () => {
    const f = sintetizadorFalso();
    const c = crearControlSonido(f.s);
    desconectar = conectarSonido(c);
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.touchEnd(document.body);
    expect(f.desbloqueos()).toBe(3);
  });
});

describe('control en pantalla', () => {
  it('silencia, cambia el volumen y apaga la música', () => {
    const c = crearControlSonido(sintetizadorFalso().s);
    render(
      <ProveedorSonido control={c}>
        <ControlSonido />
      </ProveedorSonido>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sonido' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Música de fondo' }));
    expect(c.getState().musica).toBe(false);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '80' } });
    expect(c.getState().volumen).toBe(0.8);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sonido' }));
    expect(c.getState().activado).toBe(false);
    expect(screen.getByRole('button', { name: 'Sonido (silenciado)' })).toBeInTheDocument();
  });

  it('sin proveedor no muestra nada', () => {
    const { container } = render(<ControlSonido />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('qué suena con cada mensaje', () => {
  // Estados mínimos: solo los campos que mira el mapeo.
  const estado = (juego: Record<string, unknown>, piloto: string | null = null): EstadoCliente =>
    ({
      seq: 1,
      desincronizado: false,
      sala: { yo: 'a', jugadores: [{ idJugador: 'a', piloto }], juego: { miAsiento: 0, totalPartidas: 14, turno: null, ...juego } },
    }) as unknown as EstadoCliente;
  const evento = (tipo: string, datos: Record<string, unknown>) => ({ v: 1, tipo, seq: 2, datos }) as unknown as MensajeServidor;

  it('baza: solo la que gano yo', () => {
    const e = estado({});
    expect(sonidosDelMensaje(evento('baza.resuelta', { ganador: 0 }), estado({}), e)).toEqual(['baza']);
    expect(sonidosDelMensaje(evento('baza.resuelta', { ganador: 2 }), estado({}), estado({}))).toEqual([]);
  });

  it('fin de partida, salvo la última, que tiene el podio', () => {
    expect(sonidosDelMensaje(evento('partida.puntajes', { partida: 3 }), estado({}), estado({}))).toEqual(['finPartida']);
    expect(sonidosDelMensaje(evento('partida.puntajes', { partida: 14 }), estado({}), estado({}))).toEqual([]);
    expect(sonidosDelMensaje(evento('juego.terminado', {}), estado({}), estado({}))).toEqual(['podio']);
  });

  it('avisa el turno al llegar, no con el piloto ni repetido', () => {
    const mio = { turno: { tipo: 'carta', asiento: 0 } };
    const cartaDeOtro = evento('baza.cartaJugada', { asiento: 3 });
    expect(sonidosDelMensaje(cartaDeOtro, estado({}), estado(mio))).toEqual(['carta', 'turno']);
    expect(sonidosDelMensaje(cartaDeOtro, estado(mio), estado(mio))).toEqual(['carta']);
    expect(sonidosDelMensaje(cartaDeOtro, estado({}), estado(mio, 'tiempo'))).toEqual(['carta']);
  });

  it('las fotos y los desfasajes no suenan', () => {
    const foto = { v: 1, tipo: 'estado.foto', seq: 5, datos: {} } as unknown as MensajeServidor;
    const mio = estado({ turno: { tipo: 'apuesta', asiento: 0 } });
    expect(sonidosDelMensaje(foto, estado({}), mio)).toEqual([]);
    expect(sonidosDelMensaje(evento('baza.cartaJugada', {}), estado({}), { ...mio, desincronizado: true })).toEqual([]);
  });
});

describe('sonidos en un juego real', () => {
  let mundo: Mundo;
  beforeEach(async () => {
    mundo = await levantarMundo();
  });
  afterEach(async () => {
    await mundo.cerrar();
  });

  it('un juego completo suena coherente', async () => {
    const f = sintetizadorFalso();
    const control = crearControlSonido(f.s, () => 0);
    // Sin separación entre sonidos, para contarlos todos.
    const separacion = { ...SEPARACION_MS };
    for (const k of Object.keys(SEPARACION_MS)) SEPARACION_MS[k as NombreSonido] = 0;
    onTestFinished(() => void Object.assign(SEPARACION_MS, separacion));
    control.getState().desbloquear();
    const yo: Tienda = crearTienda({
      url: mundo.url,
      almacen: almacenEnMemoria(),
      esperasDeReconexion: [20, 50, 100],
      alMensaje: sonarMensajes(control),
    });
    const otros = [1, 2, 3].map(() => tiendaDePrueba(mundo.url));
    const tiendas = [yo, ...otros];
    mundo.tiendas.push(...tiendas);
    expect(await crearComo(yo, 'Yo')).toBe(true);
    const codigo = salaDe(yo)!.codigo;
    for (const [i, t] of otros.entries()) expect(await unirseComo(t, codigo, `J${i + 2}`)).toBe(true);
    await esperar(() => salaDe(yo)?.jugadores.length === 4);
    expect(await yo.getState().iniciar()).toBe(true);
    await jugarHasta(tiendas, () => tiendas.every((t) => juegoDe(t)?.fase === 'TERMINADO'), 60_000);

    const cuenta = (n: NombreSonido) => f.tocados.filter((t) => t.nombre === n).length;
    // 56 bazas × 4 jugadores = 224 cartas.
    expect(cuenta('carta')).toBe(224);
    expect(cuenta('finPartida')).toBe(13);
    expect(cuenta('podio')).toBe(1);
    // 14 apuestas propias más al menos una tirada por partida.
    expect(cuenta('turno')).toBeGreaterThanOrEqual(28);
    expect(cuenta('baza')).toBeLessThanOrEqual(56);
  }, 90_000);
});

describe('instrumentos', () => {
  it('la cuerda suena en su nota, se apaga y no satura', async () => {
    const { cuerda, sala } = await import('../src/sonido/instrumentos');
    const tasa = 8000;
    const x = cuerda({ tasa, frecuencia: 200, duracion: 1 });
    expect(x.length).toBe(tasa);
    expect(x.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
    const energia = (a: number, b: number) => x.slice(a, b).reduce((s, v) => s + v * v, 0);
    expect(energia(0, 800)).toBeGreaterThan(energia(7000, 7800) * 5);
    // El período coincide con la nota: la señal se parece a sí misma 40 muestras después (8000 / 200).
    let corr = 0;
    let norma = 0;
    for (let i = 100; i < 900; i++) {
      corr += x[i]! * x[i + 40]!;
      norma += x[i]! * x[i]!;
    }
    expect(corr / norma).toBeGreaterThan(0.8);
    const s = sala(tasa);
    expect(s.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.abs(s.at(-1)!)).toBeLessThan(1e-3);
  });
});
