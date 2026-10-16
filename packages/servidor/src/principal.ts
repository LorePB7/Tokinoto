/**
 * Punto de entrada: `npm run iniciar -w @tokinoto/servidor`.
 *
 * Variables de entorno:
 *   PUERTO              Puerto HTTP (por defecto 3001)
 *   TOKINOTO_ORIGENES   Sitios web permitidos, separados por coma
 *                       (por defecto "*": cualquiera; solo para desarrollo)
 *   DATABASE_URL        Conexión a PostgreSQL para guardar el historial de los
 *                       juegos (DP-21). Sin ella el servidor funciona igual,
 *                       pero no guarda nada.
 */
import { abrirRepositorioPostgres, type Repositorio } from '@tokinoto/persistencia';
import { MOTIVO_ABORTO_REINICIO } from './guardador';
import { crearServidor } from './servidor';

const puerto = Number(process.env['PUERTO'] ?? 3001);
const origenesTexto = process.env['TOKINOTO_ORIGENES']?.trim();
const origenes =
  !origenesTexto || origenesTexto === '*'
    ? '*'
    : origenesTexto
        .split(',')
        .map((origen) => origen.trim())
        .filter(Boolean);

const urlBase = process.env['DATABASE_URL']?.trim();
let repositorio: Repositorio | undefined;
if (urlBase) {
  repositorio = await abrirRepositorioPostgres(urlBase);
  // Un reinicio no retoma juegos en curso (DT-05): los que quedaron abiertos se cierran como abortados.
  const abortados = await repositorio.abortarEnCurso(MOTIVO_ABORTO_REINICIO, new Date());
  console.log(`Historial en PostgreSQL listo.${abortados > 0 ? ` Se cerraron ${abortados} juego(s) que habían quedado en curso.` : ''}`);
} else {
  console.log('Atención: DATABASE_URL no está definida; el historial de los juegos no se guarda.');
}

const servidor = crearServidor({ origenes, ...(repositorio ? { repositorio } : {}) });
const puertoReal = await servidor.escuchar(puerto);
console.log(`Servidor de Tokinoto escuchando en el puerto ${puertoReal}`);
if (origenes === '*') console.log('Atención: se aceptan conexiones de cualquier origen (modo desarrollo).');

async function apagar(): Promise<void> {
  console.log('Apagando el servidor...');
  await servidor.cerrar();
  await repositorio?.cerrar();
  process.exit(0);
}
process.once('SIGINT', () => void apagar());
process.once('SIGTERM', () => void apagar());
