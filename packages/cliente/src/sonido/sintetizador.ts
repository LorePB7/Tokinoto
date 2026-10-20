/**
 * Sonidos generados con Web Audio: osciladores, ruido y envolventes cortas.
 * Sin archivos de audio (no hay licencias ni peso extra, y la CSP no cambia).
 *
 * Si el navegador no tiene Web Audio, no suena nada y no falla.
 */
import type { NombreSonido, Sintetizador } from './control';

type CtorAudio = new () => AudioContext;

interface OpcionesNota {
  tipo?: OscillatorType;
  pico: number;
  ataque?: number;
  destino: AudioNode;
}

/** Notas de la música de fondo (Hz): La m, Fa, Do, Sol. Cada acorde dura un compás. */
const ACORDES: { bajo: number; notas: number[] }[] = [
  { bajo: 110.0, notas: [220.0, 261.63, 329.63] },
  { bajo: 87.31, notas: [174.61, 220.0, 261.63] },
  { bajo: 130.81, notas: [196.0, 261.63, 329.63] },
  { bajo: 98.0, notas: [196.0, 246.94, 293.66] },
];
const COMPAS_S = 4;
const ANTICIPACION_S = 2;

export function crearSintetizadorWebAudio(): Sintetizador {
  let ctx: AudioContext | null = null;
  let efectos: GainNode | null = null;
  let musicaGeneral: GainNode | null = null;
  let ruido: AudioBuffer | null = null;

  // Música: cada vez que se prende, una "sesión" con su propio volumen, para apagarla limpio.
  let sesion: GainNode | null = null;
  let programador: ReturnType<typeof setInterval> | null = null;
  let siguienteCompas = 0;
  let indiceAcorde = 0;

  function nota(frecuencia: number, inicio: number, duracion: number, o: OpcionesNota): void {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.tipo ?? 'sine';
    osc.frequency.setValueAtTime(frecuencia, inicio);
    const ataque = o.ataque ?? 0.005;
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.linearRampToValueAtTime(o.pico, inicio + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    osc.connect(g).connect(o.destino);
    osc.start(inicio);
    osc.stop(inicio + duracion + 0.05);
  }

  function golpeDeRuido(inicio: number, duracion: number, pico: number, frecuencia: number): void {
    if (!ctx || !efectos || !ruido) return;
    const fuente = ctx.createBufferSource();
    fuente.buffer = ruido;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = frecuencia;
    filtro.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(pico, inicio);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    fuente.connect(filtro).connect(g).connect(efectos);
    fuente.start(inicio);
    fuente.stop(inicio + duracion + 0.02);
  }

  function arpegio(frecuencias: number[], inicio: number, paso: number, k: number, duracionFinal: number): void {
    if (!efectos) return;
    frecuencias.forEach((f, i) => {
      const ultima = i === frecuencias.length - 1;
      nota(f, inicio + i * paso, ultima ? duracionFinal : 0.35, { tipo: 'triangle', pico: 0.16 * k, destino: efectos! });
      nota(f * 2, inicio + i * paso, ultima ? duracionFinal * 0.6 : 0.2, { pico: 0.03 * k, destino: efectos! });
    });
  }

  function programarAcorde(indice: number, inicio: number, destino: AudioNode): void {
    if (!ctx) return;
    const acorde = ACORDES[indice % ACORDES.length]!;
    const fin = inicio + COMPAS_S + 1;
    // Colchón suave: triángulo filtrado, entrada y salida lentas.
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 700;
    filtro.connect(destino);
    for (const f of acorde.notas) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, inicio);
      g.gain.linearRampToValueAtTime(0.09, inicio + 1.2);
      g.gain.setValueAtTime(0.09, inicio + COMPAS_S - 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, fin);
      osc.connect(g).connect(filtro);
      osc.start(inicio);
      osc.stop(fin + 0.05);
    }
    nota(acorde.bajo, inicio, COMPAS_S, { pico: 0.12, ataque: 0.4, destino });
    // Dos notas sueltas, agudas y cortas, sobre el acorde.
    const [a, b, c] = acorde.notas;
    nota(c! * 2, inicio + 1, 1.4, { pico: 0.035, ataque: 0.02, destino });
    nota((indice % 2 === 0 ? a! : b!) * 2, inicio + 2.5, 1.4, { pico: 0.03, ataque: 0.02, destino });
  }

  function programarMusica(): void {
    if (!ctx || !sesion) return;
    while (siguienteCompas < ctx.currentTime + ANTICIPACION_S) {
      programarAcorde(indiceAcorde, siguienteCompas, sesion);
      siguienteCompas += COMPAS_S;
      indiceAcorde++;
    }
  }

  function apagarMusica(): void {
    if (programador) clearInterval(programador);
    programador = null;
    const vieja = sesion;
    sesion = null;
    if (!ctx || !vieja) return;
    vieja.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => vieja.disconnect(), 1500);
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
      compresor.connect(ctx.destination);
      efectos = ctx.createGain();
      efectos.connect(compresor);
      musicaGeneral = ctx.createGain();
      musicaGeneral.gain.value = 0;
      musicaGeneral.connect(compresor);
      ruido = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
      const datos = ruido.getChannelData(0);
      for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
    },

    tocar(nombre, volumen) {
      if (!ctx || !efectos) return;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      // El oído percibe el volumen de forma logarítmica: el cuadrado da un control más parejo.
      const k = volumen * volumen;
      const t = ctx.currentTime + 0.01;
      switch (nombre) {
        case 'clic':
          nota(1100, t, 0.045, { tipo: 'triangle', pico: 0.1 * k, destino: efectos });
          break;
        case 'carta':
          golpeDeRuido(t, 0.08, 0.5 * k, 2200);
          nota(150, t, 0.09, { pico: 0.22 * k, destino: efectos });
          break;
        case 'baza':
          nota(659.25, t, 0.16, { tipo: 'triangle', pico: 0.16 * k, destino: efectos });
          nota(987.77, t + 0.09, 0.28, { tipo: 'triangle', pico: 0.16 * k, destino: efectos });
          break;
        case 'turno':
          // Leve demora: si justo se tiró una carta, se oye después del golpe.
          nota(880, t + 0.15, 0.6, { pico: 0.12 * k, destino: efectos });
          nota(1760, t + 0.15, 0.3, { pico: 0.025 * k, destino: efectos });
          nota(1318.5, t + 0.3, 0.7, { pico: 0.1 * k, destino: efectos });
          break;
        case 'finPartida':
          arpegio([523.25, 659.25, 783.99], t, 0.12, k, 0.7);
          break;
        case 'podio':
          arpegio([523.25, 659.25, 783.99, 1046.5], t, 0.14, k, 1.3);
          nota(261.63, t + 0.42, 1.4, { tipo: 'triangle', pico: 0.1 * k, ataque: 0.05, destino: efectos });
          break;
        case 'chat':
          nota(1500, t, 0.07, { pico: 0.07 * k, destino: efectos });
          break;
      }
    },

    musica(activa, volumen) {
      if (!ctx || !musicaGeneral) return;
      musicaGeneral.gain.setTargetAtTime(activa ? volumen * volumen * 0.5 : 0, ctx.currentTime, 0.3);
      if (!activa) {
        apagarMusica();
        return;
      }
      if (sesion) return;
      sesion = ctx.createGain();
      sesion.connect(musicaGeneral);
      siguienteCompas = ctx.currentTime + 0.1;
      indiceAcorde = 0;
      programarMusica();
      programador = setInterval(programarMusica, 500);
    },
  };
}
