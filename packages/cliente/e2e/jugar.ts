/**
 * Prueba de punta a punta con navegadores reales: levanta el servidor y el
 * cliente, abre un navegador por jugador y juega un juego completo tocando la
 * pantalla como lo haría una persona.
 *
 * Uso (desde la raíz del repositorio):
 *   npm run e2e -w @tokinoto/cliente -- [--jugadores 4] [--capturas carpeta]
 *
 * Necesita un Chromium instalado (npx playwright-core install chromium) o la
 * variable CHROMIUM_PATH apuntando a uno.
 */
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
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

const servidor = crearServidor({ sala: { pausaBazaMs: 700, pausaResumenMs: 1500 } });
const puertoServidor = await servidor.escuchar(0, '127.0.0.1');
process.env['VITE_SERVIDOR'] = `http://127.0.0.1:${puertoServidor}`;
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  server: { port: 0, host: '127.0.0.1' },
  logLevel: 'error',
});
await vite.listen();
const urlCliente = vite.resolvedUrls?.local[0];
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
  const contexto = await navegador.newContext({ viewport: movil ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => problemas.push(`Error de página (${i}): ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`Consola (${i}): ${m.text()}`);
  });
  jugadores.push({ nombre: `Jugador ${i + 1}`, contexto, pagina, movil });
}

async function captura(j: Jugador, nombre: string): Promise<void> {
  if (!carpeta) return;
  await j.pagina.screenshot({ path: `${carpeta}/${j.movil ? 'movil-' : ''}${nombre}.png` });
}

// Entrada: el primero crea la sala y los demás se unen con el código.
const [anfitrion, ...invitados] = jugadores as [Jugador, ...Jugador[]];
await anfitrion.pagina.goto(urlCliente);
await captura(anfitrion, '1-inicio');
await anfitrion.pagina.getByLabel('Tu nombre').fill(anfitrion.nombre);
await anfitrion.pagina.getByRole('button', { name: 'Crear sala' }).click();
const codigo = (await anfitrion.pagina.getByTestId('codigo').textContent())?.trim() ?? '';
verificar(/^[A-Z2-9]{8}$/.test(codigo), `Código de sala inesperado: "${codigo}"`);

for (const j of invitados) {
  await j.pagina.goto(`${urlCliente}?sala=${codigo}`);
  await j.pagina.getByLabel('Tu nombre').fill(j.nombre);
  await j.pagina.getByRole('button', { name: 'Unirme' }).click();
  await j.pagina.getByTestId('codigo').waitFor();
}
await anfitrion.pagina.getByText(`Jugadores (${cantidad} de 7)`).waitFor();
await captura(anfitrion, '2-sala-de-espera');
await anfitrion.pagina.getByRole('button', { name: 'Iniciar juego' }).click();

// Juego: cada jugador mira su pantalla y actúa cuando le toca.
const capturado = new Set<string>();
async function actuar(j: Jugador): Promise<void> {
  const p = j.pagina;
  const fichas = p.locator('.boton-ficha:not([disabled])');
  if ((await fichas.count()) > 0) {
    if (!capturado.has(`${j.nombre}-apuesta`) && (await p.locator('.boton-ficha').count()) >= 3) {
      capturado.add(`${j.nombre}-apuesta`);
      await captura(j, '3-apuesta');
    }
    if (!capturado.has(`${j.nombre}-apuesta-grande`) && (await p.locator('.boton-ficha').count()) >= 8) {
      capturado.add(`${j.nombre}-apuesta-grande`);
      await captura(j, '3b-apuesta-con-7-cartas');
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

const limite = Date.now() + 240_000;
let terminado = false;
while (!terminado && Date.now() < limite) {
  await Promise.all(jugadores.map(actuar));
  terminado = (await Promise.all(jugadores.map((j) => j.pagina.locator('.ranking').count()))).every((c) => c > 0);
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

if (problemas.length > 0) {
  console.error('\nProblemas:\n- ' + problemas.join('\n- '));
  process.exit(1);
}
console.log(`\nListo: ${cantidad} navegadores jugaron un juego completo sin problemas.`);
process.exit(0);
