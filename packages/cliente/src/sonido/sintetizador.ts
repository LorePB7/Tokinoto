/**
 * Sonidos rústicos generados con Web Audio, sin archivos de audio:
 * - guitarra criolla (cuerda pulsada, ver `instrumentos.ts`) para avisos y melodías,
 * - golpes de madera para botones y cartas,
 * - bombo legüero para el cambio de partida y el podio,
 * - de fondo, una milonga campera en Mi menor, tranquila y a volumen bajo.
 * Todo pasa por una "caja" de guitarra y una pieza chica, para que suene cálido y no a máquina.
 *
 * Si el navegador no tiene Web Audio, no suena nada y no falla.
 */
import type { NombreSonido, Sintetizador } from './control';
import { cuerda, sala } from './instrumentos';

type CtorAudio = new () => AudioContext;

// Notas (Hz).
const N = {
  E2: 82.41, F2s: 92.5, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, D4s: 311.13, E4: 329.63, F4s: 369.99, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, B5: 987.77,
} as const;

interface Compas {
  /** Bajos en el ritmo de milonga (3 + 3 + 2). */
  bajos: [number, number, number];
  /** Notas del acorde que acompañan arriba. */
  agudos: [number, number, number];
  /** Melodía: hasta dos notas, en el primer y el quinto semicorchea. */
  melodia?: [number, number?];
}

const Em: Omit<Compas, 'melodia'> = { bajos: [N.E2, N.B2, N.E3], agudos: [N.G3, N.B3, N.E4] };
const Am: Omit<Compas, 'melodia'> = { bajos: [N.A2, N.E3, N.A2], agudos: [N.A3, N.C4, N.E4] };
const B7: Omit<Compas, 'melodia'> = { bajos: [N.B2, N.F2s, N.B2], agudos: [N.A3, N.B3, N.D4s] };
const G: Omit<Compas, 'melodia'> = { bajos: [N.G2, N.D3, N.G2], agudos: [N.G3, N.B3, N.D4] };

/** Milonga de 16 compases: la primera vuelta solo acompaña, la segunda suma una melodía. */
const MILONGA: Compas[] = [
  Em, Em, Am, Em, B7, B7, Em, Em,
  { ...G, melodia: [N.B4, N.D5] },
  { ...G, melodia: [N.B4, N.G4] },
  { ...Am, melodia: [N.C5, N.A4] },
  { ...Em, melodia: [N.B4, N.G4] },
  { ...B7, melodia: [N.A4, N.F4s] },
  { ...B7, melodia: [N.B4, N.A4] },
  { ...Em, melodia: [N.G4, N.E4] },
  { ...Em, melodia: [N.E4] },
];
/** Un compás de 2/4 a paso de milonga campera. */
const COMPAS_S = 1.5;
const SEMI_S = COMPAS_S / 8;
const ANTICIPACION_S = 2;

export function crearSintetizadorWebAudio(): Sintetizador {
  let ctx: AudioContext | null = null;
  let efectos: AudioNode | null = null;
  let musicaGeneral: GainNode | null = null;
  let ruido: AudioBuffer | null = null;
  const cuerdas = new Map<string, AudioBuffer>();

  let sesion: GainNode | null = null;
  let programador: ReturnType<typeof setInterval> | null = null;
  let siguienteCompas = 0;
  let indiceCompas = 0;

  function bufferDeCuerda(frecuencia: number, duracion: number, sostenido: number, brillo: number): AudioBuffer | null {
    if (!ctx) return null;
    const clave = `${frecuencia}|${duracion}|${sostenido}|${brillo}`;
    let b = cuerdas.get(clave);
    if (!b) {
      const datos = cuerda({ tasa: ctx.sampleRate, frecuencia, duracion, sostenido, brillo });
      b = ctx.createBuffer(1, datos.length, ctx.sampleRate);
      b.getChannelData(0).set(datos);
      cuerdas.set(clave, b);
    }
    return b;
  }

  /** Pulsa una cuerda de guitarra. */
  function pulsar(
    frecuencia: number,
    inicio: number,
    destino: AudioNode,
    pico: number,
    { duracion = 1.2, sostenido = 0.996, brillo = 0.45 } = {},
  ): void {
    const b = bufferDeCuerda(frecuencia, duracion, sostenido, brillo);
    if (!ctx || !b) return;
    const fuente = ctx.createBufferSource();
    fuente.buffer = b;
    const g = ctx.createGain();
    g.gain.value = pico;
    fuente.connect(g).connect(destino);
    fuente.start(inicio);
  }

  /** Rasguido: las cuerdas una tras otra, muy rápido, como al pasar la mano. */
  function rasguear(notas: number[], inicio: number, destino: AudioNode, pico: number, duracion = 1.6): void {
    notas.forEach((f, i) => pulsar(f, inicio + i * 0.022, destino, pico * (1 - i * 0.06), { duracion, brillo: 0.4 }));
  }

  /** Ruido filtrado muy corto: el roce, el "tac" de la madera. */
  function roce(inicio: number, duracion: number, pico: number, corte: number, destino: AudioNode): void {
    if (!ctx || !ruido) return;
    const fuente = ctx.createBufferSource();
    fuente.buffer = ruido;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = corte;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.linearRampToValueAtTime(pico, inicio + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    fuente.connect(filtro).connect(g).connect(destino);
    fuente.start(inicio);
    fuente.stop(inicio + duracion + 0.02);
  }

  /** Golpe seco sobre madera: unos pocos parciales que se apagan rápido. */
  function madera(inicio: number, base: number, pico: number, decaimiento: number, destino: AudioNode): void {
    if (!ctx) return;
    const parciales: [number, number, number][] = [
      [1, 1, 1],
      [2.57, 0.4, 0.6],
      [4.21, 0.15, 0.4],
    ];
    for (const [razon, amplitud, largo] of parciales) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = base * razon;
      const fin = inicio + decaimiento * largo;
      g.gain.setValueAtTime(0.0001, inicio);
      g.gain.linearRampToValueAtTime(pico * amplitud, inicio + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, fin);
      osc.connect(g).connect(destino);
      osc.start(inicio);
      osc.stop(fin + 0.02);
    }
    roce(inicio, 0.015, pico * 0.25, 1600, destino);
  }

  /** Bombo legüero: un golpe grave de parche, con el cuero que vibra un poco. */
  function bombo(inicio: number, pico: number, destino: AudioNode): void {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(78, inicio);
    osc.frequency.exponentialRampToValueAtTime(52, inicio + 0.3);
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.linearRampToValueAtTime(pico, inicio + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.55);
    osc.connect(g).connect(destino);
    osc.start(inicio);
    osc.stop(inicio + 0.6);
    roce(inicio, 0.12, pico * 0.35, 380, destino);
  }

  /** Una carta que cae sobre una mesa de madera: apoyo blando, un toque de madera y el roce del naipe. */
  function cartaSobreMadera(inicio: number, k: number, destino: AudioNode): void {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, inicio);
    osc.frequency.exponentialRampToValueAtTime(95, inicio + 0.08);
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.linearRampToValueAtTime(0.12 * k, inicio + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.1);
    osc.connect(g).connect(destino);
    osc.start(inicio);
    osc.stop(inicio + 0.12);
    madera(inicio, 620, 0.2 * k, 0.08, destino);
    roce(inicio - 0.012, 0.05, 0.08 * k, 1300, destino);
  }

  function programarCompas(indice: number, inicio: number, destino: AudioNode): void {
    const c = MILONGA[indice % MILONGA.length]!;
    // Bajo en 3 + 3 + 2: semicorcheas 0, 3 y 6.
    c.bajos.forEach((f, i) => pulsar(f, inicio + [0, 3, 6][i]! * SEMI_S, destino, 0.42, { duracion: 1.1, sostenido: 0.995, brillo: 0.3 }));
    // Acompañamiento arriba, suave y "pellizcado", entre los bajos.
    const [a, b, cc] = c.agudos;
    for (const [pos, notas] of [
      [1, [a, b]],
      [4, [b, cc]],
      [7, [a, cc]],
    ] as [number, number[]][]) {
      for (const f of notas) pulsar(f, inicio + pos * SEMI_S, destino, 0.12, { duracion: 0.6, sostenido: 0.993, brillo: 0.35 });
    }
    if (c.melodia) {
      const [m1, m2] = c.melodia;
      pulsar(m1, inicio, destino, 0.26, { duracion: 1.3, brillo: 0.5 });
      if (m2) pulsar(m2, inicio + 4 * SEMI_S, destino, 0.22, { duracion: 1.1, brillo: 0.5 });
    }
  }

  function programarMusica(): void {
    if (!ctx || !sesion) return;
    while (siguienteCompas < ctx.currentTime + ANTICIPACION_S) {
      programarCompas(indiceCompas, siguienteCompas, sesion);
      siguienteCompas += COMPAS_S;
      indiceCompas++;
    }
  }

  function apagarMusica(): void {
    if (programador) clearInterval(programador);
    programador = null;
    const vieja = sesion;
    sesion = null;
    if (!ctx || !vieja) return;
    vieja.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    setTimeout(() => vieja.disconnect(), 2000);
  }

  return {
    desbloquear() {
      if (ctx) return;
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: CtorAudio }).webkitAudioContext) as
        | CtorAudio
        | undefined;
      if (!Ctor) return;
      try {
        ctx = new Ctor();
      } catch {
        ctx = null;
        return;
      }
      void ctx.resume().catch(() => undefined);

      const compresor = ctx.createDynamicsCompressor();
      compresor.threshold.value = -18;
      compresor.ratio.value = 3;
      compresor.connect(ctx.destination);

      // Mezcla seca y una pieza chica, para que nada suene "en el vacío".
      const mezcla = ctx.createGain();
      mezcla.connect(compresor);
      const pieza = ctx.createConvolver();
      const datosPieza = sala(ctx.sampleRate);
      const respuesta = ctx.createBuffer(2, datosPieza.length, ctx.sampleRate);
      respuesta.getChannelData(0).set(datosPieza);
      respuesta.getChannelData(1).set(sala(ctx.sampleRate, 1.1, 11));
      pieza.buffer = respuesta;
      const humedo = ctx.createGain();
      humedo.gain.value = 0.22;
      mezcla.connect(pieza).connect(humedo).connect(compresor);

      // Caja de guitarra: un poco de cuerpo en los graves y sin agudos filosos.
      const cuerpo = ctx.createBiquadFilter();
      cuerpo.type = 'peaking';
      cuerpo.frequency.value = 220;
      cuerpo.Q.value = 1;
      cuerpo.gain.value = 4;
      const sinFilo = ctx.createBiquadFilter();
      sinFilo.type = 'lowpass';
      sinFilo.frequency.value = 3200;
      cuerpo.connect(sinFilo).connect(mezcla);
      efectos = cuerpo;

      musicaGeneral = ctx.createGain();
      musicaGeneral.gain.value = 0;
      musicaGeneral.connect(cuerpo);

      ruido = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
      const datos = ruido.getChannelData(0);
      for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
    },

    tocar(nombre, volumen) {
      if (!ctx || !efectos) return;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      // El oído percibe el volumen de forma logarítmica: el cuadrado da un control más parejo.
      const k = volumen * volumen;
      const t = ctx.currentTime + 0.02;
      switch (nombre) {
        case 'clic':
          madera(t, 900, 0.1 * k, 0.03, efectos);
          break;
        case 'carta':
          cartaSobreMadera(t, k, efectos);
          break;
        case 'baza':
          pulsar(N.B3, t, efectos, 0.4 * k, { duracion: 1 });
          pulsar(N.E4, t + 0.12, efectos, 0.4 * k, { duracion: 1.3 });
          break;
        case 'turno':
          // Leve demora: si justo se tiró una carta, se oye después del golpe.
          pulsar(N.E5, t + 0.18, efectos, 0.28 * k, { duracion: 1.4, brillo: 0.3, sostenido: 0.997 });
          pulsar(N.B5, t + 0.18, efectos, 0.07 * k, { duracion: 0.8, brillo: 0.3 });
          break;
        case 'finPartida':
          bombo(t, 0.5 * k, efectos);
          rasguear([N.G2, N.B2, N.D3, N.G3, N.B3, N.G4], t + 0.02, efectos, 0.24 * k);
          break;
        case 'podio':
          bombo(t, 0.5 * k, efectos);
          rasguear([N.C3, N.E3, N.G3, N.C4, N.E4], t, efectos, 0.22 * k, 0.9);
          bombo(t + 0.5, 0.45 * k, efectos);
          rasguear([N.D3, N.A3, N.D4, N.F4s], t + 0.5, efectos, 0.22 * k, 0.9);
          bombo(t + 1.0, 0.5 * k, efectos);
          rasguear([N.G2, N.B2, N.D3, N.G3, N.B3, N.G4], t + 1.0, efectos, 0.26 * k, 2.6);
          break;
        case 'chat':
          madera(t, 1250, 0.09 * k, 0.035, efectos);
          break;
      }
    },

    musica(activa, volumen) {
      if (!ctx || !musicaGeneral) return;
      musicaGeneral.gain.setTargetAtTime(activa ? volumen * volumen * 0.4 : 0, ctx.currentTime, 0.3);
      if (!activa) {
        apagarMusica();
        return;
      }
      if (sesion) return;
      sesion = ctx.createGain();
      sesion.connect(musicaGeneral);
      siguienteCompas = ctx.currentTime + 0.1;
      indiceCompas = 0;
      programarMusica();
      programador = setInterval(programarMusica, 500);
    },
  };
}
