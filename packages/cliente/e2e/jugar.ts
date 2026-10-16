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
 * Si está definida DATABASE_URL, el servidor guarda el historial en esa base
 * (etapa 7) y al final se verifica que el juego quedó guardado y es consistente.
 *
 * Necesita un Chromium instalado (npx playwright-core install chromium) o la
 * variable CHROMIUM_PATH apuntando a uno.
 */
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { abrirRepositorioPostgres, verificarJuego } from '@tokinoto/persistencia';
import { crearServidor } from '@tokinoto/servidor';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer } from 'vite';

const { values } = parseArgs({
  options: { jugadores: { type: 'string', default: '4' }, capturas: { type: 'string', default: '' } },
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
const servidor = crearServidor({
  sala: { pausaBazaMs: 700, pausaResumenMs: 1500, pausaPilotoMs: 300 },
  ...(repositorio ? { repositorio } : {}),
});
const puertoServidor = await servidor.escuchar(0, '127.0.0.1');
process.env['VITE_SERVIDOR'] = `http://127.0.0.1:${puertoServidor}`;
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  server: { port: 0, host: '127.0.0.1' },
  logLevel: 'error',
});
await vite.listen();
const urlCliente: string | undefined = vite.resolvedUrls?.local[0];
if (!urlCliente) throw new Error('Vite no devolvió su dirección');

const navegador: Browser = await chromium.launch(
  process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {},
);

interface Jugador {
  nombre: string;
  contexto: BrowserContext;
  pagina: Page;
  movil: boolean;
}

const jugadores: Jugador[] = [];
for (let i = 0; i < cantidad; i++) {
  const movil = i === cantidad - 1;
  const contexto = await navegador.newContext({
    viewport: movil ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => problemas.push(`Error de página (${i}): ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`Consola (${i}): ${m.text()}`);
  });
  jugadores.push({ nombre: `Jugador ${i + 1}`, contexto, pagina, movil });
}

/** Cuánto se pasa la página del alto de la pantalla (si es más de 0, hay que hacer scroll). */
async function excesoDeScroll(j: Jugador): Promise<number> {
  return j.pagina.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

async function captura(j: Jugador, nombre: string): Promise<void> {
  if (!carpeta) return;
  await j.pagina.screenshot({ path: `${carpeta}/${j.movil ? 'movil-' : ''}${nombre}.png` });
}

// Entrada: el primero crea la sala y los demás se unen con el código.
const [anfitrion, ...invitados] = jugadores as [Jugador, ...Jugador[]];
await anfitrion.pagina.goto(urlCliente);
await captura(anfitrion, '1-inicio');
{
  const exceso = await excesoDeScroll(anfitrion);
  verificar(exceso <= 0, `El inicio de ${anfitrion.nombre} hace scroll (${exceso} px de más).`);
}
await anfitrion.pagina.getByLabel('Tu nombre').fill(anfitrion.nombre);
await anfitrion.pagina.getByRole('button', { name: 'Crear sala' }).click();
const codigo = (await anfitrion.pagina.getByTestId('codigo').textContent())?.trim() ?? '';
verificar(/^[A-Z2-9]{8}$/.test(codigo), `Código de sala inesperado: "${codigo}"`);

for (const j of invitados) {
  await j.pagina.goto(`${urlCliente}?sala=${codigo}`);
  {
    const exceso = await excesoDeScroll(j);
    verificar(exceso <= 0, `El inicio con ?sala= de ${j.nombre} hace scroll (${exceso} px de más).`);
  }
  await j.pagina.getByLabel('Tu nombre').fill(j.nombre);
  await j.pagina.getByRole('button', { name: 'Unirme' }).click();
  await j.pagina.getByTestId('codigo').waitFor();
}
await anfitrion.pagina.getByText(`Jugadores (${cantidad} de 7)`).waitFor();
await captura(anfitrion, '2-sala-de-espera');

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
verificar((await anfitrion.pagina.locator('.panel-reglas .carta').count()) === 14, 'El panel de reglas no muestra las 14 cartas');
await captura(anfitrion, '2b-reglas');
await anfitrion.pagina.keyboard.press('Escape');
await anfitrion.pagina.getByRole('dialog', { name: 'Reglas del juego' }).waitFor({ state: 'detached' });
await anfitrion.pagina.getByRole('button', { name: 'Iniciar juego' }).click();

// Juego: cada jugador mira su pantalla y actúa cuando le toca.
const capturado = new Set<string>();
async function actuar(j: Jugador): Promise<void> {
  const p = j.pagina;
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
    if (!j.movil && !capturado.has(`${j.nombre}-sin-scroll-${await p.locator('.boton-apuesta').count()}`)) {
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

const limite = Date.now() + 300_000;
let terminado = false;
while (!terminado && Date.now() < limite) {
  await Promise.all(jugadores.filter((j) => !ausentes.has(j)).map(actuar));
  if (etapaAusencias < 3) await probarAusencias();
  terminado = (await Promise.all(jugadores.filter((j) => !ausentes.has(j)).map((j) => j.pagina.locator('.ranking').count()))).every((c) => c > 0) && ausentes.size === 0;
  await new Promise((r) => setTimeout(r, 60));
}
verificar(terminado, 'El juego no terminó a tiempo');

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
await vite.close();
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
