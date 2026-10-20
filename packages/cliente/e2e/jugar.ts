/**
 * Prueba de punta a punta con navegadores reales: levanta el servidor y el
 * cliente, abre un navegador por jugador y juega un juego completo tocando la
 * pantalla como lo haría una persona.
 *
 * Además prueba las ausencias (etapa 6): a mitad del juego un jugador recarga
 * la página (vuelve solo a su asiento) y otro cierra la pestaña (el piloto
 * automático juega por él) y después vuelve desde una pestaña nueva.
 *
 * Uso (desde la raíz del repositorio):
 *   npm run e2e -w @tokinoto/cliente -- [--jugadores 4] [--capturas carpeta]
 *
 * Con --publicado prueba la versión publicada: no usa Vite sino la carpeta
 * dist (hay que correr antes `npm run build`) y el mismo servidor entrega la
 * página en modo producción, con los orígenes limitados a su propia dirección
 * y la política de contenido activa.
 *
 * Si está definida DATABASE_URL, el servidor guarda el historial en esa base
 * (etapa 7) y al final se verifica que el juego quedó guardado y es consistente.
 *
 * Necesita un Chromium instalado (npx playwright-core install chromium) o la
 * variable CHROMIUM_PATH apuntando a uno.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer as crearServidorTcp, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { abrirRepositorioPostgres, verificarJuego } from '@tokinoto/persistencia';
import { crearServidor } from '@tokinoto/servidor';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer } from 'vite';

const { values } = parseArgs({
  options: { jugadores: { type: 'string', default: '4' }, capturas: { type: 'string', default: '' }, corto: { type: 'boolean', default: false }, barrido: { type: 'boolean', default: false }, dispositivos: { type: 'boolean', default: false }, ventanas: { type: 'string', default: '' }, publicado: { type: 'boolean', default: false }, auditoria: { type: 'boolean', default: false } },
});
const cantidad = Number(values.jugadores);
const carpeta = values.capturas || '';
if (carpeta) mkdirSync(carpeta, { recursive: true });
if (!Number.isInteger(cantidad) || cantidad < 4 || cantidad > 7) throw new Error('--jugadores debe ser de 4 a 7');

const problemas: string[] = [];
const verificar = (condicion: boolean, mensaje: string) => {
  if (!condicion) problemas.push(mensaje);
};

const urlBase = process.env['DATABASE_URL'];
const repositorio = urlBase ? await abrirRepositorioPostgres(urlBase) : null;
/** Un puerto libre (para saber la dirección propia antes de crear el servidor). */
async function puertoLibre(): Promise<number> {
  const tcp = crearServidorTcp();
  await new Promise<void>((resolver) => tcp.listen(0, '127.0.0.1', resolver));
  const { port } = tcp.address() as AddressInfo;
  await new Promise<void>((resolver) => tcp.close(() => resolver()));
  return port;
}

const pausas = { pausaBazaMs: 700, pausaResumenMs: 1500, pausaPilotoMs: 300 };
let vite: Awaited<ReturnType<typeof createServer>> | null = null;
let urlCliente: string | undefined;
let servidor: ReturnType<typeof crearServidor>;
if (values.publicado) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  if (!existsSync(dist)) throw new Error('Falta construir el cliente: npm run build');
  const puerto = await puertoLibre();
  urlCliente = `http://127.0.0.1:${puerto}/`;
  servidor = crearServidor({
    sala: pausas,
    produccion: true,
    carpetaCliente: dist,
    origenes: [`http://127.0.0.1:${puerto}`],
    ...(repositorio ? { repositorio } : {}),
  });
  await servidor.escuchar(puerto, '127.0.0.1');
} else {
  servidor = crearServidor({ sala: pausas, ...(repositorio ? { repositorio } : {}) });
  const puertoServidor = await servidor.escuchar(0, '127.0.0.1');
  process.env['VITE_SERVIDOR'] = `http://127.0.0.1:${puertoServidor}`;
  vite = await createServer({
    root: new URL('..', import.meta.url).pathname,
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await vite.listen();
  urlCliente = vite.resolvedUrls?.local[0];
}
if (!urlCliente) throw new Error('Vite no devolvió su dirección');

const navegador: Browser = await chromium.launch(
  process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {},
);

/** Pantallas que prueba cada navegador: compu, notebook, tablet, celulares y un celular acostado. */
const TAMANOS_ESCRITORIO = [
  // Ventanas de navegador reales: pantalla completa con barras, notebooks con zoom y ventanas en mosaico (para probar con varias pestañas).
  { ancho: 1920, alto: 937 },
  { ancho: 1536, alto: 730 },
  { ancho: 1366, alto: 625 },
  { ancho: 1280, alto: 585 },
  { ancho: 960, alto: 470 },
  { ancho: 960, alto: 540 },
  { ancho: 800, alto: 600 },
];

const TAMANOS_BASE = [
  { ancho: 1280, alto: 800 },
  { ancho: 390, alto: 844 },
  { ancho: 360, alto: 640 },
  { ancho: 1366, alto: 768 },
  { ancho: 1024, alto: 768 },
  { ancho: 844, alto: 390 },
  { ancho: 1920, alto: 1080 },
];

const TAMANOS = values.ventanas === 'escritorio'
  ? TAMANOS_ESCRITORIO
  : /^\d+x\d+(,\d+x\d+)*$/.test(values.ventanas)
    ? values.ventanas.split(',').map((t) => ({ ancho: Number(t.split('x')[0]), alto: Number(t.split('x')[1]) }))
    : TAMANOS_BASE;

interface Jugador {
  nombre: string;
  contexto: BrowserContext;
  pagina: Page;
  movil: boolean;
  tamano: string;
}

/** Con --dispositivos se emulan equipos reales: pantalla táctil, densidad de píxeles y navegador de celular. */
const DISPOSITIVOS = [
  { nombre: 'Notebook 125% (1536x730)', opciones: { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 } },
  { nombre: 'iPhone SE', opciones: devices['iPhone SE']! },
  { nombre: 'iPhone 13', opciones: devices['iPhone 13']! },
  { nombre: 'Pixel 7', opciones: devices['Pixel 7']! },
  { nombre: 'Galaxy S9+', opciones: devices['Galaxy S9+']! },
  { nombre: 'iPad Mini acostado', opciones: devices['iPad Mini landscape']! },
  { nombre: 'iPad Mini', opciones: devices['iPad Mini']! },
];

const jugadores: Jugador[] = [];
for (let i = 0; i < cantidad; i++) {
  const t = TAMANOS[i]!;
  const perfil = values.dispositivos ? DISPOSITIVOS[i]! : null;
  const vp = perfil?.opciones.viewport ?? { width: t.ancho, height: t.alto };
  const movil = vp.width <= 820;
  const contexto = await navegador.newContext({
    ...(perfil ? perfil.opciones : {}),
    viewport: vp,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // tsx agrega una ayuda interna (__name) a las funciones; el navegador no la tiene y hay que dársela.
  await contexto.addInitScript('globalThis.__name = (f) => f;');
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => problemas.push(`Error de página (${i}): ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`Consola (${i}): ${m.text()}`);
  });
  jugadores.push({ nombre: `Jugador ${i + 1}`, contexto, pagina, movil, tamano: perfil ? perfil.nombre : `${t.ancho}x${t.alto}` });
}

/** Cuánto se pasa la página del alto de la pantalla (si es más de 0, hay que hacer scroll). */
async function excesoDeScroll(j: Jugador): Promise<number> {
  return j.pagina.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

/** Peor exceso de scroll visto en cada combinación de pantalla y vista. */
const peor = new Map<string, number>();
const medidas = new Set<string>();

/** Mide una sola vez por jugador y vista cuánto se pasa la página (o su ventana) del alto de la pantalla. */
async function medir(j: Jugador, vista: string, exceso?: number, repetida = vista): Promise<void> {
  const clave = `${j.nombre}|${repetida}`;
  if (medidas.has(clave)) return;
  medidas.add(clave);
  const valor = exceso ?? (await excesoDeScroll(j));
  const k = `${j.tamano} · ${vista}`;
  peor.set(k, Math.max(peor.get(k) ?? -Infinity, valor));
  if (j === jugadores[0]) {
    await barrer(j, repetida);
    await barrerAuditoria(j, repetida);
  }
}

/** Tamaños de ventana reales: notebooks con zoom, navegadores con barras, celulares con y sin barra de direcciones. */
const BARRIDO = [
  [2560, 1300], [1920, 1080], [1920, 950], [1920, 900], [1680, 900], [1600, 800], [1536, 730], [1536, 864], [1440, 900],
  [1440, 700], [1366, 768], [1366, 650], [1280, 720], [1280, 600], [1280, 560], [1152, 648], [1024, 768], [1024, 600],
  [820, 1180], [768, 1024], [430, 932], [412, 915], [414, 896], [393, 852], [390, 844], [390, 664], [375, 812], [375, 667],
  [360, 800], [360, 740], [360, 640], [360, 560], [320, 568], [932, 430], [844, 390], [740, 360], [667, 375], [568, 320],
] as const;
const barrido = new Map<string, { v: number; h: number; culpables: string[] }>();

/** Cambia el tamaño de la ventana por todos los valores de BARRIDO y mide scroll vertical y horizontal. */
async function barrer(j: Jugador, vista: string): Promise<void> {
  if (!values.barrido) return;
  const original = j.pagina.viewportSize()!;
  for (const [w, h] of BARRIDO) {
    await j.pagina.setViewportSize({ width: w, height: h });
    await j.pagina.waitForTimeout(120);
    const r = await j.pagina.evaluate(() => {
      const W = innerWidth;
      const H = innerHeight;
      const culpables: string[] = [];
      for (const e of Array.from(document.querySelectorAll('body *'))) {
        const caja = e.getBoundingClientRect();
        const estilo = getComputedStyle(e);
        if (caja.width === 0 || caja.height === 0 || estilo.visibility === 'hidden') continue;
        if (estilo.position === 'fixed' || e.closest('.superposicion,.panel-reglas,.registro,.mano')) continue;
        if (caja.bottom > H + 1 || caja.right > W + 1 || caja.left < -1) {
          culpables.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} abajo=${Math.round(caja.bottom)} der=${Math.round(caja.right)}`);
        }
      }
      let v = document.documentElement.scrollHeight - H;
      for (const sel of ['.superposicion', '.panel-reglas']) {
        const e = document.querySelector(sel);
        if (e) v = Math.max(v, e.scrollHeight - e.clientHeight);
      }
      return { v, h: document.documentElement.scrollWidth - W, culpables: culpables.slice(0, 3) };
    });
    const k = `${w}x${h} · ${vista}`;
    const antes = barrido.get(k);
    if (!antes || r.v > antes.v || r.h > antes.h) barrido.set(k, r);
  }
  await j.pagina.setViewportSize(original);
  await j.pagina.waitForTimeout(100);
}

/** Peor caso visto de scroll vertical y horizontal en cada vista, muestreando durante toda la partida. */
const muestreos = new Map<string, { v: number; h: number; mano: number; culpables: string[] }>();
const ultimoMuestreo = new Map<string, number>();
const lugaresMesa = new Map<string, { lugar: string; vista: string; detalle: string }>();
const mesaMovida = new Set<string>();
const recortes = new Set<string>();
const desbordes = new Map<string, { arriba: number; abajo: number; izq: number; der: number; lado: number }>();

async function muestrear(j: Jugador, vista: string): Promise<void> {
  const ahora = Date.now();
  if (ahora - (ultimoMuestreo.get(j.nombre) ?? 0) < 350) return;
  ultimoMuestreo.set(j.nombre, ahora);
  const r = await j.pagina.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const culpables: string[] = [];
    for (const e of Array.from(document.querySelectorAll('body *'))) {
      const caja = e.getBoundingClientRect();
      const estilo = getComputedStyle(e);
      if (caja.width === 0 || caja.height === 0 || estilo.visibility === 'hidden') continue;
      if (estilo.position === 'fixed' || e.closest('.superposicion,.panel-reglas,.registro')) continue;
      if (caja.bottom > H + 1 || caja.right > W + 1 || caja.left < -1 || caja.top < -1) {
        culpables.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} arriba=${Math.round(caja.top)} abajo=${Math.round(caja.bottom)} izq=${Math.round(caja.left)} der=${Math.round(caja.right)}`);
      }
    }
    const mano = document.querySelector('.mano');
    const acciones = document.querySelector('.acciones-turno');
    const mesaEl = document.querySelector('.mesa');
    const caja = mesaEl?.getBoundingClientRect();
    const lugarMesa = caja ? [caja.left, caja.top, caja.width, caja.height].map((n) => Math.round(n)).join(',') : '';
    const d = { arriba: 0, abajo: 0, izq: 0, der: 0, lado: 0 };
    if (mesaEl) {
      const m = mesaEl.getBoundingClientRect();
      d.lado = Math.round(m.width);
      for (const e of Array.from(document.querySelectorAll('.asiento, .montones'))) {
        const c = e.getBoundingClientRect();
        d.arriba = Math.max(d.arriba, Math.round(m.top - c.top));
        d.abajo = Math.max(d.abajo, Math.round(c.bottom - m.bottom));
        d.izq = Math.max(d.izq, Math.round(m.left - c.left));
        d.der = Math.max(d.der, Math.round(c.right - m.right));
      }
    }
    const pm = document.querySelector('.pantalla-mesa');
    const detalle = pm ? `columnas ${getComputedStyle(pm).gridTemplateColumns} filas ${getComputedStyle(pm).gridTemplateRows}` : '';
    return {
      detalle,
      lugarMesa,
      recorteAcciones: acciones ? acciones.scrollHeight - acciones.clientHeight : 0,
      desborde: d,
      v: document.documentElement.scrollHeight - H,
      h: document.documentElement.scrollWidth - W,
      mano: mano ? mano.scrollWidth - mano.clientWidth : 0,
      culpables: culpables.slice(0, 4),
    };
  });
  // La mesa nunca debe moverse ni cambiar de tamaño: ni al apostar, ni al tirar, ni al esperar.
  if (r.lugarMesa && !values.barrido) {
    const primero = lugaresMesa.get(j.nombre);
    if (!primero) lugaresMesa.set(j.nombre, { lugar: r.lugarMesa, vista, detalle: r.detalle });
    else if (
      primero.lugar.split(',').some((n, i) => Math.abs(Number(n) - Number(r.lugarMesa.split(',')[i])) > 1) &&
      !mesaMovida.has(j.nombre)
    ) {
      mesaMovida.add(j.nombre);
      problemas.push(`La mesa de ${j.nombre} (${j.tamano}) se movió: ${primero.lugar} en "${primero.vista}" (${primero.detalle}) y ${r.lugarMesa} en "${vista}" (${r.detalle})`);
    }
  }
  if (r.recorteAcciones > 0 && !recortes.has(`${j.tamano}|${vista}`)) recortes.add(`${j.tamano}|${vista}`), problemas.push(`El recuadro del turno de ${j.tamano} recorta ${r.recorteAcciones} px en "${vista}"`);
  const dk = `${j.tamano}`;
  const dd = desbordes.get(dk) ?? { arriba: 0, abajo: 0, izq: 0, der: 0, lado: 0 };
  desbordes.set(dk, {
    arriba: Math.max(dd.arriba, r.desborde.arriba),
    abajo: Math.max(dd.abajo, r.desborde.abajo),
    izq: Math.max(dd.izq, r.desborde.izq),
    der: Math.max(dd.der, r.desborde.der),
    lado: Math.max(dd.lado, r.desborde.lado),
  });
  const k = `${j.tamano} · ${vista}`;
  const antes = muestreos.get(k);
  if (!antes || r.v > antes.v || r.h > antes.h || r.mano > antes.mano) muestreos.set(k, { v: Math.max(r.v, antes?.v ?? -9e9), h: Math.max(r.h, antes?.h ?? -9e9), mano: Math.max(r.mano, antes?.mano ?? 0), culpables: r.culpables.length ? r.culpables : (antes?.culpables ?? []) });
}


/**
 * Auditoría de diseño (--auditoria): no hace fallar la prueba, solo mide y informa.
 * Mira tres cosas en cada vista: elementos que se pisan entre sí, textos más chicos
 * que el mínimo legible y botones más chicos que el mínimo táctil.
 */
const MINIMO_TEXTO_PX = 12;
const MINIMO_TOQUE_PX = 44;
interface HallazgosAuditoria {
  solapes: Set<string>;
  textos: Set<string>;
  toques: Set<string>;
}
const hallazgos = new Map<string, HallazgosAuditoria>();

async function auditarMedidas(j: Jugador, vista: string, tamano = j.tamano): Promise<void> {
  if (!values.auditoria) return;
  const r = await j.pagina.evaluate(
    ([minimoTexto, minimoToque]) => {
      const visible = (e: Element) => {
        const c = e.getBoundingClientRect();
        const est = getComputedStyle(e);
        return c.width > 0 && c.height > 0 && est.visibility !== 'hidden' && est.display !== 'none';
      };
      const interseccion = (a: DOMRect, b: DOMRect) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 1 && h > 1 ? { w: Math.round(w), h: Math.round(h) } : null;
      };
      const solapes: string[] = [];
      const textos: string[] = [];
      const toques: string[] = [];
      const placas = Array.from(document.querySelectorAll<HTMLElement>('.asiento')).filter(visible);
      const etiqueta = (e: Element) => `${e.className.toString().split(' ')[0]}`;
      const nombreDe = (e: HTMLElement) => `asiento ${e.dataset['asiento'] ?? '?'}`;
      for (let i = 0; i < placas.length; i++) {
        for (let k = i + 1; k < placas.length; k++) {
          const a = placas[i]!.querySelector('.placa') ?? placas[i]!;
          const b = placas[k]!.querySelector('.placa') ?? placas[k]!;
          const x = interseccion(a.getBoundingClientRect(), b.getBoundingClientRect());
          if (x) solapes.push(`${nombreDe(placas[i]!)} pisa a ${nombreDe(placas[k]!)} (${x.w}×${x.h} px)`);
        }
      }
      for (const asiento of placas) {
        const placa = asiento.querySelector('.placa');
        if (!placa) continue;
        const caja = placa.getBoundingClientRect();
        const partes = Array.from(placa.querySelectorAll('.nombre, .insignias, .cuenta-regresiva, .marcador, .dorsos')).filter(visible);
        for (let i = 0; i < partes.length; i++) {
          const c = partes[i]!.getBoundingClientRect();
          if (c.left < caja.left - 1 || c.right > caja.right + 1 || c.top < caja.top - 1 || c.bottom > caja.bottom + 1) {
            solapes.push(`${nombreDe(asiento)}: ${etiqueta(partes[i]!)} sobresale de su placa`);
          }
          for (let k = i + 1; k < partes.length; k++) {
            const x = interseccion(c, partes[k]!.getBoundingClientRect());
            if (x) solapes.push(`${nombreDe(asiento)}: ${etiqueta(partes[i]!)} pisa a ${etiqueta(partes[k]!)} (${x.w}×${x.h} px)`);
          }
        }
        for (const el of Array.from(placa.querySelectorAll('.nombre, .marcador, .bazas, .insignias i, .cuenta-regresiva')).filter(visible)) {
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < minimoTexto) textos.push(`${etiqueta(el)} ${px}px`);
        }
      }
      const tiradas = Array.from(document.querySelectorAll('.tirada')).filter(visible);
      for (const t of tiradas) {
        for (const asiento of placas) {
          const placa = asiento.querySelector('.placa') ?? asiento;
          const x = interseccion(t.getBoundingClientRect(), placa.getBoundingClientRect());
          if (x) solapes.push(`carta de la baza pisa a ${nombreDe(asiento)} (${x.w}×${x.h} px)`);
        }
      }
      for (const m of Array.from(document.querySelectorAll('.montones')).filter(visible)) {
        const dueno = m.closest('.asiento');
        for (const asiento of placas) {
          if (asiento === dueno) continue;
          const placa = asiento.querySelector('.placa') ?? asiento;
          const x = interseccion(m.getBoundingClientRect(), placa.getBoundingClientRect());
          if (x) solapes.push(`montón pisa a ${nombreDe(asiento)} (${x.w}×${x.h} px)`);
        }
      }
      for (const b of Array.from(document.querySelectorAll('button, a[href]')).filter(visible)) {
        if (b.closest('.mano')) continue;
        const c = b.getBoundingClientRect();
        const lado = Math.min(c.width, c.height);
        if (lado < minimoToque) {
          const texto = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 18);
          toques.push(`"${texto}" ${Math.round(c.width)}×${Math.round(c.height)}`);
        }
      }
      for (const t of Array.from(document.querySelectorAll('.turno, .acciones-turno button, .datos-partida span')).filter(visible)) {
        const px = parseFloat(getComputedStyle(t).fontSize);
        if (px < minimoTexto) textos.push(`${etiqueta(t)} ${px}px`);
      }
      return { solapes, textos, toques };
    },
    [MINIMO_TEXTO_PX, MINIMO_TOQUE_PX] as const,
  );
  const k = `${tamano} · ${vista}`;
  const h = hallazgos.get(k) ?? { solapes: new Set<string>(), textos: new Set<string>(), toques: new Set<string>() };
  r.solapes.forEach((x) => h.solapes.add(x));
  r.textos.forEach((x) => h.textos.add(x));
  r.toques.forEach((x) => h.toques.add(x));
  hallazgos.set(k, h);
}

/** Con --auditoria, repite la medición de diseño en todos los tamaños del barrido. */
async function barrerAuditoria(j: Jugador, vista: string): Promise<void> {
  if (!values.auditoria) return;
  const original = j.pagina.viewportSize()!;
  for (const [w, h] of BARRIDO) {
    await j.pagina.setViewportSize({ width: w, height: h });
    await j.pagina.waitForTimeout(120);
    await auditarMedidas(j, vista, `${w}x${h}`);
  }
  await j.pagina.setViewportSize(original);
  await j.pagina.waitForTimeout(100);
}

function informarAuditoria(): void {
  if (!values.auditoria) return;
  const filas = [...hallazgos].sort(([a], [b]) => a.localeCompare(b));
  const conProblemas = filas.filter(([, h]) => h.solapes.size + h.textos.size + h.toques.size > 0);
  console.log(`\nAuditoría de diseño: ${filas.length} combinaciones medidas, ${conProblemas.length} con hallazgos.`);
  for (const [k, h] of conProblemas) {
    console.log(`  ${k}: ${h.solapes.size} solapes, ${h.textos.size} textos chicos, ${h.toques.size} toques chicos`);
    for (const x of [...h.solapes].slice(0, 4)) console.log(`      solape: ${x}`);
    for (const x of [...h.textos].slice(0, 4)) console.log(`      texto: ${x}`);
    for (const x of [...h.toques].slice(0, 4)) console.log(`      toque: ${x}`);
  }
  if (carpeta) {
    const salida = Object.fromEntries(filas.map(([k, h]) => [k, { solapes: [...h.solapes], textos: [...h.textos], toques: [...h.toques] }]));
    writeFileSync(`${carpeta}/auditoria.json`, JSON.stringify(salida, null, 2));
  }
}

/** Cuánto se pasa el contenido de un elemento de su propio alto (0 si no existe o entra). */
async function excesoDe(j: Jugador, selector: string): Promise<number> {
  return j.pagina.evaluate((sel) => {
    const e = document.querySelector(sel);
    return e ? e.scrollHeight - e.clientHeight : 0;
  }, selector);
}

async function captura(j: Jugador, nombre: string): Promise<void> {
  if (!carpeta) return;
  await j.pagina.screenshot({ path: `${carpeta}/${j.movil ? 'movil-' : ''}${nombre}.png` });
}

// Celular acostado: se pide girar el teléfono en lugar de mostrar la pantalla apretada.
{
  const acostado = await navegador.newContext(devices['iPhone 13 landscape']!);
  const pagina = await acostado.newPage();
  await pagina.goto(urlCliente);
  verificar(await pagina.getByText('Girá el teléfono para jugar.').isVisible(), 'Con el celular acostado no aparece el aviso de girar');
  await acostado.close();
  const parado = await navegador.newContext(devices['iPhone 13']!);
  const otra = await parado.newPage();
  await otra.goto(urlCliente);
  verificar(!(await otra.getByText('Girá el teléfono para jugar.').isVisible()), 'Con el celular parado aparece el aviso de girar');
  await parado.close();
}

// Entrada: el primero crea la sala y los demás se unen con el código.
const [anfitrion, ...invitados] = jugadores as [Jugador, ...Jugador[]];
await anfitrion.pagina.goto(urlCliente);
await captura(anfitrion, '1-inicio');
await medir(anfitrion, 'inicio');
await anfitrion.pagina.getByLabel('Tu nombre').fill(anfitrion.nombre);
await anfitrion.pagina.getByRole('button', { name: 'Crear sala' }).click();
const codigo = (await anfitrion.pagina.getByTestId('codigo').textContent())?.trim() ?? '';
verificar(/^[A-Z2-9]{8}$/.test(codigo), `Código de sala inesperado: "${codigo}"`);

for (const j of invitados) {
  await j.pagina.goto(`${urlCliente}?sala=${codigo}`);
  await medir(j, 'inicio con ?sala=');
  await j.pagina.getByLabel('Tu nombre').fill(j.nombre);
  await j.pagina.getByRole('button', { name: 'Unirme' }).click();
  await j.pagina.getByTestId('codigo').waitFor();
}
await anfitrion.pagina.getByText(`Jugadores (${cantidad} de 7)`).waitFor();
await captura(anfitrion, '2-sala-de-espera');
for (const j of jugadores) {
  await medir(j, `sala de espera (${cantidad} jugadores)`);
  await captura(j, `2-sala-${j.tamano}`);
  await j.pagina.getByRole('button', { name: 'Reglas' }).click();
  await j.pagina.getByRole('dialog', { name: 'Reglas del juego' }).waitFor();
  for (const pestana of ['Juego', 'Cartas', 'Puntos', 'El Pié']) {
    await j.pagina.getByRole('tab', { name: pestana }).click();
    await medir(j, `reglas: ${pestana}`, await excesoDe(j, '.panel-reglas'));
    await captura(j, `2c-reglas-${pestana.slice(0, 3)}-${j.tamano}`);
  }
  await j.pagina.keyboard.press('Escape');
  await j.pagina.getByRole('dialog', { name: 'Reglas del juego' }).waitFor({ state: 'detached' });
}

// Copiar: el código y el enlace llegan bien al portapapeles.
await anfitrion.pagina.getByRole('button', { name: 'Copiar código' }).click();
await anfitrion.pagina.getByRole('button', { name: 'Código copiado' }).waitFor();
verificar((await anfitrion.pagina.evaluate(() => navigator.clipboard.readText())) === codigo, 'Copiar código no copió el código');
await anfitrion.pagina.getByRole('button', { name: 'Copiar enlace' }).click();
await anfitrion.pagina.getByRole('button', { name: 'Enlace copiado' }).waitFor();
const enlace = new URL(await anfitrion.pagina.evaluate(() => navigator.clipboard.readText()));
verificar(enlace.origin === new URL(urlCliente).origin && enlace.searchParams.get('sala') === codigo, `Copiar enlace copió "${enlace}"`);

// Reglas: el botón abre un panel al costado con el valor de las cartas, y se cierra.
await anfitrion.pagina.getByRole('button', { name: 'Reglas' }).click();
await anfitrion.pagina.getByRole('dialog', { name: 'Reglas del juego' }).waitFor();
await anfitrion.pagina.getByRole('tab', { name: 'Cartas' }).click();
verificar((await anfitrion.pagina.locator('.panel-reglas .carta').count()) === 14, 'El panel de reglas no muestra las 14 cartas');
await captura(anfitrion, '2b-reglas');
await anfitrion.pagina.keyboard.press('Escape');
await anfitrion.pagina.getByRole('dialog', { name: 'Reglas del juego' }).waitFor({ state: 'detached' });

if (values.corto) {
  // Modo rápido: solo la entrada, la sala de espera y las reglas.
  const malos = [...barrido].filter(([, r]) => r.v > 0 || r.h > 0).sort();
  console.log(`\nBarrido: ${barrido.size} combinaciones, ${malos.length} con scroll.`);
  for (const [k, r] of malos) console.log(`  MAL ${k}: vertical ${r.v} px, horizontal ${r.h} px  ${r.culpables.join(' | ')}`);
  console.log('\nScroll de más por pantalla y vista (0 o menos = entra completo):');
  for (const [k, v] of [...peor].sort()) console.log(`  ${v <= 0 ? 'OK ' : 'MAL'} ${k}: ${v} px`);
  informarAuditoria();
  await navegador.close();
  await vite?.close();
  await servidor.cerrar();
  process.exit([...peor.values()].some((v) => v > 0) ? 1 : 0);
}

await anfitrion.pagina.getByRole('button', { name: 'Iniciar juego' }).click();

// Juego: cada jugador mira su pantalla y actúa cuando le toca.
const capturado = new Set<string>();
async function auditarVista(j: Jugador): Promise<void> {
  const p = j.pagina;
  const cartas = await p.locator('.mano .carta').count();
  if ((await p.locator('.superposicion').count()) > 0) {
    const final = (await p.locator('.ranking').count()) > 0;
    const vista = final ? 'resultado final' : 'resumen de partida';
    await medir(j, vista, Math.max(await excesoDeScroll(j), await excesoDe(j, '.superposicion')));
    if (final) {
      await captura(j, '6-resultado-final-' + j.tamano);
      if (!capturado.has(`${j.nombre}-det`)) {
        capturado.add(`${j.nombre}-det`);
        await p.getByText('Puntos de cada partida').click();
        await medir(j, 'resultado final con la tabla abierta', Math.max(await excesoDeScroll(j), await excesoDe(j, '.superposicion')));
        await captura(j, '6b-tabla-' + j.tamano);
        await p.getByText('Puntos de cada partida').click();
      }
    }
    else if (!capturado.has(`${j.nombre}-res`)) {
      capturado.add(`${j.nombre}-res`);
      await captura(j, '5-resumen-' + j.tamano);
    }
    return;
  }
  if ((await p.locator('.pantalla-mesa').count()) === 0) return;
  const botones = await p.locator('.boton-apuesta').count();
  const vista = botones > 0 ? `apostar (${botones - 1} cartas)` : 'mesa';
  await muestrear(j, vista);
  if (values.auditoria && !capturado.has(`${j.nombre}-aud-${vista}`) && (botones === 8 || botones === 2 || (botones === 0 && (await p.locator('.tirada').count()) >= Math.min(3, cantidad - 1) && (await p.locator('.monton').count()) >= 2))) {
    capturado.add(`${j.nombre}-aud-${vista}`);
    await auditarMedidas(j, vista);
    if (j === jugadores[0]) await barrerAuditoria(j, vista);
  }
  if (!capturado.has(`${j.nombre}-v-${vista}`) && (botones === 8 || botones === 2 || (botones === 0 && cartas === 7))) {
    capturado.add(`${j.nombre}-v-${vista}`);
    await captura(j, `m-${vista.replace(/[ ()]/g, '-')}-${j.tamano}`);
  }
  if (!capturado.has(`${j.nombre}-salir`) && botones === 0) {
    // El cartel de confirmación de "Salir" tampoco debe hacer scroll.
    capturado.add(`${j.nombre}-salir`);
    const salir = p.getByRole('button', { name: 'Salir', exact: true });
    if ((await salir.count()) > 0) {
      await salir.click();
      await medir(j, 'confirmar salida', await excesoDeScroll(j));
      await p.getByRole('button', { name: 'Seguir jugando' }).click();
    }
    const registro = p.getByRole('button', { name: 'Registro', exact: true });
    if (await registro.isVisible()) {
      await registro.click();
      await medir(j, 'registro (cajón)', await excesoDeScroll(j));
      await captura(j, `registro-${j.tamano}`);
      await p.getByRole('button', { name: 'Cerrar' }).click();
    }
  }
}

async function actuar(j: Jugador): Promise<void> {
  const p = j.pagina;
  await auditarVista(j);
  const fichas = p.locator('.boton-apuesta:not([disabled])');
  if ((await fichas.count()) > 0) {
    if (!capturado.has(`${j.nombre}-apuesta`) && (await p.locator('.boton-apuesta').count()) >= 3) {
      capturado.add(`${j.nombre}-apuesta`);
      await captura(j, '3-apuesta');
    }
    if (!capturado.has(`${j.nombre}-apuesta-grande`) && (await p.locator('.boton-apuesta').count()) >= 8) {
      capturado.add(`${j.nombre}-apuesta-grande`);
      await captura(j, '3b-apuesta-con-7-cartas');
    }
    // En pantallas de computadora, apostar y ver tu mano no debe pedir scroll.
    if (false && !capturado.has(`${j.nombre}-sin-scroll-${await p.locator('.boton-apuesta').count()}`)) {
      capturado.add(`${j.nombre}-sin-scroll-${await p.locator('.boton-apuesta').count()}`);
      const exceso = await excesoDeScroll(j);
      console.log(`Apuesta con ${(await p.locator('.boton-apuesta').count()) - 1} cartas: exceso de scroll ${exceso} px`);
      verificar(exceso <= 0, `Al apostar con ${(await p.locator('.boton-apuesta').count()) - 1} cartas hay que hacer scroll (${exceso} px de más)`);
    }
    const elegido = Math.floor(Math.random() * (await fichas.count()));
    await fichas.nth(elegido).click({ timeout: 2000 }).catch(() => {});
    return;
  }
  const cartas = p.locator('.mano.activa button.carta.jugable:not([disabled])');
  if ((await cartas.count()) > 0) {
    const enMesa = await p.locator('.tirada').count();
    const nombreCaptura = `${j.nombre}-mesa`;
    if (!capturado.has(nombreCaptura) && enMesa >= Math.min(3, cantidad - 1) && (await p.locator('.monton').count()) >= 2) {
      capturado.add(nombreCaptura);
      await captura(j, '4-mesa-en-juego');
    }
    const elegida = Math.floor(Math.random() * (await cartas.count()));
    await cartas.nth(elegida).click({ timeout: 2000 }).catch(() => {});
    return;
  }
  if (!capturado.has(`${j.nombre}-resumen`) && (await p.locator('.resumen').count()) > 0) {
    capturado.add(`${j.nombre}-resumen`);
    await captura(j, '5-resumen');
  }
}

/** Partida en curso según la pantalla del anfitrión. */
async function partidaActual(): Promise<number> {
  const texto = await anfitrion.pagina.locator('.datos-partida').innerText().catch(() => '');
  return Number(/Partida (\d+)/.exec(texto)?.[1] ?? 0);
}

/** Ausencias: recargar una pestaña, cerrar otra y volver desde una nueva. */
let etapaAusencias = 0;
const ausentes = new Set<Jugador>();
async function probarAusencias(): Promise<void> {
  const partida = await partidaActual();
  const recarga = invitados[0]!;
  const ausente = invitados[1]!;
  if (etapaAusencias === 0 && partida >= 3) {
    etapaAusencias = 1;
    ausentes.add(recarga);
    await recarga.pagina.reload();
    await recarga.pagina.locator('.pantalla-mesa').waitFor({ timeout: 10_000 });
    const yo = await recarga.pagina.locator('.asiento.yo .nombre').innerText();
    verificar(yo.includes(recarga.nombre), `Tras recargar volvió con otro nombre: "${yo}"`);
    ausentes.delete(recarga);
    console.log(`Partida ${partida}: ${recarga.nombre} recargó la página y volvió a su asiento.`);
  } else if (etapaAusencias === 1 && partida >= 5) {
    etapaAusencias = 2;
    ausentes.add(ausente);
    await ausente.pagina.close();
    await anfitrion.pagina.locator('.asiento .insignias i.piloto').first().waitFor({ timeout: 10_000 });
    await captura(anfitrion, '7-piloto-automatico');
    console.log(`Partida ${partida}: ${ausente.nombre} cerró la pestaña; juega el piloto automático.`);
  } else if (etapaAusencias === 2 && partida >= 7) {
    etapaAusencias = 3;
    ausente.pagina = await ausente.contexto.newPage();
    ausente.pagina.on('pageerror', (e) => problemas.push(`Error de página (${ausente.nombre}): ${e.message}`));
    await ausente.pagina.goto(urlCliente!);
    await ausente.pagina.getByRole('button', { name: 'Volver a esa partida' }).click();
    await ausente.pagina.locator('.pantalla-mesa').waitFor({ timeout: 10_000 });
    await anfitrion.pagina.locator('.asiento .insignias i.piloto').waitFor({ state: 'detached', timeout: 10_000 });
    ausentes.delete(ausente);
    console.log(`Partida ${partida}: ${ausente.nombre} volvió desde una pestaña nueva y retomó el control.`);
  }
}

const limite = Date.now() + (values.barrido ? 1_500_000 : 300_000);
let terminado = false;
while (!terminado && Date.now() < limite) {
  await Promise.all(jugadores.filter((j) => !ausentes.has(j)).map(actuar));
  if (etapaAusencias < 3) await probarAusencias();
  terminado = (await Promise.all(jugadores.filter((j) => !ausentes.has(j)).map((j) => j.pagina.locator('.ranking').count()))).every((c) => c > 0) && ausentes.size === 0;
  await new Promise((r) => setTimeout(r, 60));
}
verificar(terminado, 'El juego no terminó a tiempo');

if (values.barrido) {
  const malos = [...barrido].filter(([, r]) => r.v > 0 || r.h > 0).sort();
  console.log(`\nBarrido: ${barrido.size} combinaciones, ${malos.length} con scroll.`);
  for (const [k, r] of malos) console.log(`  MAL ${k}: vertical ${r.v} px, horizontal ${r.h} px  ${r.culpables.join(' | ')}`);
}
{
  const malos = [...muestreos].filter(([, r]) => r.v > 0 || r.h > 0 || r.mano > 0).sort();
  for (const [k, d] of desbordes) console.log(`  Sobresale de la mesa (${k}, mesa de ${d.lado}px): arriba ${d.arriba}, abajo ${d.abajo}, izq ${d.izq}, der ${d.der}`);
  console.log(`\nMuestreo durante toda la partida: ${muestreos.size} vistas, ${malos.length} con problemas.`);
  for (const [k, r] of malos) console.log(`  MAL ${k}: vertical ${r.v} px, horizontal ${r.h} px, mano ${r.mano} px  ${r.culpables.join(' | ')}`);
  for (const [k, r] of malos) verificar(false, `Muestreo: ${k} (v ${r.v}, h ${r.h}, mano ${r.mano})`);
}
informarAuditoria();
console.log('\nScroll de más por pantalla y vista (0 o menos = entra completo):');
for (const [k, v] of [...peor].sort()) console.log(`  ${v <= 0 ? 'OK ' : 'MAL'} ${k}: ${v} px`);
for (const [k, v] of peor) verificar(v <= 0, `Hay que hacer scroll en ${k} (${v} px de más)`);

if (terminado) {
  await captura(anfitrion, '6-resultado-final');
  await captura(jugadores[jugadores.length - 1]!, '6-resultado-final');
  const rankings = await Promise.all(jugadores.map((j) => j.pagina.locator('.ranking').innerText()));
  verificar(rankings.every((r) => r === rankings[0]), 'Los jugadores ven rankings distintos');
  console.log('Ranking final:\n' + rankings[0]);
  const avisos = await Promise.all(jugadores.map((j) => j.pagina.locator('.aviso').count()));
  verificar(avisos.every((a) => a === 0), 'Algún jugador vio un aviso de error');

  // Revancha: el anfitrión vuelve a empezar y todos pasan a un juego nuevo.
  await anfitrion.pagina.getByRole('button', { name: 'Jugar de nuevo' }).click();
  await Promise.all(jugadores.map((j) => j.pagina.locator('.ranking').waitFor({ state: 'detached', timeout: 10_000 })));
  await anfitrion.pagina.getByText('Partida 1 de 14').waitFor();
}

await navegador.close();
await vite?.close();
await servidor.cerrar();

if (repositorio) {
  const juegos = await repositorio.listarJuegos({ sala: codigo });
  verificar(juegos.length === 2, `Se esperaban 2 juegos guardados (el jugado y la revancha) y hay ${juegos.length}`);
  const estados = juegos.map((j) => j.estado).sort();
  verificar(estados.join() === 'ABORTADO,TERMINADO', `Estados guardados inesperados: ${estados.join()}`);
  for (const juego of juegos) {
    const detalle = await repositorio.obtenerJuego(juego.id);
    if (juego.estado === 'TERMINADO') {
      verificar(detalle?.ranking.length === cantidad, 'El ranking guardado no tiene a todos los jugadores');
      verificar(detalle?.puntajes.length === 14 * cantidad, 'Faltan puntajes de partida en el historial');
    }
    for (const problema of await verificarJuego(repositorio, juego.id)) problemas.push(`Historial ${juego.id}: ${problema}`);
  }
  console.log(`Historial en PostgreSQL: ${juegos.length} juegos guardados y verificados.`);
  await repositorio.cerrar();
}

if (problemas.length > 0) {
  console.error('\nProblemas:\n- ' + problemas.join('\n- '));
  process.exit(1);
}
verificar(etapaAusencias === 3, 'No se llegó a probar todas las ausencias');
console.log(`\nListo: ${cantidad} navegadores jugaron un juego completo sin problemas, con recarga, abandono y regreso.`);
process.exit(0);
