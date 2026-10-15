/**
 * Punto de entrada: `npm run iniciar -w @tokinoto/servidor`.
 *
 * Variables de entorno:
 *   PUERTO              Puerto HTTP (por defecto 3001)
 *   TOKINOTO_ORIGENES   Sitios web permitidos, separados por coma
 *                       (por defecto "*": cualquiera; solo para desarrollo)
 */
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

const servidor = crearServidor({ origenes });
const puertoReal = await servidor.escuchar(puerto);
console.log(`Servidor de Tokinoto escuchando en el puerto ${puertoReal}`);
if (origenes === '*') console.log('Atención: se aceptan conexiones de cualquier origen (modo desarrollo).');

async function apagar(): Promise<void> {
  console.log('Apagando el servidor...');
  await servidor.cerrar();
  process.exit(0);
}
process.once('SIGINT', () => void apagar());
process.once('SIGTERM', () => void apagar());
