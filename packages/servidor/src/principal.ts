/**
 * Punto de entrada: `npm run iniciar -w @tokinoto/servidor`.
 *
 * Variables de entorno:
 *   PUERTO / PORT       Puerto HTTP (por defecto 3001). Render define PORT.
 *   NODE_ENV            "production" activa el modo producción: el servidor
 *                       entrega también la página del juego y exige saber
 *                       qué sitios pueden conectarse.
 *   TOKINOTO_ORIGENES   Sitios web permitidos, separados por coma. En Render no
 *                       hace falta: se usa la dirección pública del servicio
 *                       (RENDER_EXTERNAL_URL). En desarrollo, sin ella se acepta
 *                       cualquiera ("*").
 *   TOKINOTO_CLIENTE    Carpeta del cliente construido. Por defecto, en
 *                       producción, packages/cliente/dist.
 *   DATABASE_URL        Conexión a PostgreSQL para guardar el historial de los
 *                       juegos (DP-21). Sin ella el servidor funciona igual,
 *                       pero no guarda nada.
 */
import { fileURLToPath } from 'node:url';
import { abrirRepositorioPostgres, type Repositorio } from '@tokinoto/persistencia';
import { MOTIVO_ABORTO_REINICIO } from './guardador';
import { crearServidor } from './servidor';

// Un error que nadie atrapó deja el proceso en un estado dudoso: se registra y
// se sale, y la plataforma lo vuelve a arrancar.
process.on('uncaughtException', (problema) => {
  console.error('[error] excepción no atrapada:', problema);
  process.exit(1);
});
process.on('unhandledRejection', (motivo) => {
  console.error('[error] promesa rechazada sin atender:', motivo);
  process.exit(1);
});

const produccion = process.env['NODE_ENV'] === 'production';
const puerto = Number(process.env['PUERTO'] ?? process.env['PORT'] ?? 3001);

function leerOrigenes(): readonly string[] | '*' {
  const texto = process.env['TOKINOTO_ORIGENES']?.trim();
  if (texto === '*') {
    if (produccion) throw new Error('TOKINOTO_ORIGENES="*" no se permite en producción.');
    return '*';
  }
  if (texto) {
    return texto
      .split(',')
      .map((origen) => origen.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  }
  const deRender = process.env['RENDER_EXTERNAL_URL']?.trim().replace(/\/+$/, '');
  if (deRender) return [deRender];
  if (produccion) {
    throw new Error('En producción hay que definir TOKINOTO_ORIGENES con la dirección pública del juego.');
  }
  return '*';
}

const origenes = leerOrigenes();
const carpetaCliente =
  process.env['TOKINOTO_CLIENTE']?.trim() ||
  (produccion ? fileURLToPath(new URL('../../cliente/dist', import.meta.url)) : undefined);

/**
 * Con `sslmode=require` (como la entrega Neon) el driver ya verifica el
 * certificado, pero avisa que en su próxima versión dejará de hacerlo. Se pide
 * la verificación completa de forma explícita para que siga siendo segura.
 */
function conVerificacionCompleta(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, '$1sslmode=verify-full');
}

const urlBase = process.env['DATABASE_URL']?.trim();
let repositorio: Repositorio | undefined;
if (urlBase) {
  repositorio = await abrirRepositorioPostgres(conVerificacionCompleta(urlBase));
  // Un reinicio no retoma juegos en curso (DT-05): los que quedaron abiertos se cierran como abortados.
  const abortados = await repositorio.abortarEnCurso(MOTIVO_ABORTO_REINICIO, new Date());
  console.log(`Historial en PostgreSQL listo.${abortados > 0 ? ` Se cerraron ${abortados} juego(s) que habían quedado en curso.` : ''}`);
} else {
  console.log('Atención: DATABASE_URL no está definida; el historial de los juegos no se guarda.');
}

const servidor = crearServidor({
  origenes,
  produccion,
  ...(carpetaCliente ? { carpetaCliente } : {}),
  ...(repositorio ? { repositorio } : {}),
});
const puertoReal = await servidor.escuchar(puerto);
console.log(`Servidor de Tokinoto escuchando en el puerto ${puertoReal}${produccion ? ' (producción)' : ''}`);
if (carpetaCliente) console.log(`Entregando el cliente web desde ${carpetaCliente}`);
if (origenes === '*') console.log('Atención: se aceptan conexiones de cualquier origen (modo desarrollo).');
else console.log(`Orígenes permitidos: ${origenes.join(', ')}`);

let apagando = false;
async function apagar(): Promise<void> {
  if (apagando) return;
  apagando = true;
  console.log('Apagando el servidor...');
  await servidor.cerrar();
  await repositorio?.cerrar();
  process.exit(0);
}
process.once('SIGINT', () => void apagar());
process.once('SIGTERM', () => void apagar());
