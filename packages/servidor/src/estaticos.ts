/**
 * Archivos del cliente web (la carpeta `dist` que arma Vite), servidos por el
 * mismo servidor del juego. Así la página y Socket.IO comparten dirección y no
 * hace falta permitir otros orígenes.
 *
 * Todos los archivos se cargan en memoria al arrancar: nunca se arma una ruta
 * de disco con lo que pide el navegador, así que no hay forma de leer archivos
 * fuera de la carpeta. Los de texto se guardan también comprimidos (gzip).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const COMPRIMIBLES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest']);

interface Archivo {
  tipo: string;
  contenido: Buffer;
  comprimido: Buffer | null;
  cache: string;
}

/**
 * Lo que necesita el botón "Entrar con Google" (fase 6), según la guía de
 * Google Identity Services: su script, sus estilos, su marco y sus pedidos.
 */
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_ESTILOS = 'https://accounts.google.com/gsi/style';
const GOOGLE_GSI = 'https://accounts.google.com/gsi/';

/**
 * Política de contenido de la página: solo se cargan scripts, estilos y
 * fuentes del propio sitio (más lo justo de Google para entrar con tu cuenta),
 * y la página no se puede incrustar en otra.
 */
export const POLITICA_CONTENIDO = [
  "default-src 'self'",
  `script-src 'self' ${GOOGLE_SCRIPT}`,
  `style-src 'self' ${GOOGLE_ESTILOS}`,
  "font-src 'self' data:",
  "img-src 'self' data:",
  `connect-src 'self' ${GOOGLE_GSI}`,
  `frame-src ${GOOGLE_GSI}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Cabeceras de seguridad que llevan todas las respuestas HTTP. */
export function cabecerasDeSeguridad(produccion: boolean): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // A otros sitios solo se manda el origen, nunca la ruta (el enlace de
    // invitación lleva el código de la sala). Google lo necesita para validar el botón.
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // Permite la ventana emergente de Google cuando el navegador no usa FedCM.
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    ...(produccion ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}

export type AtenderEstaticos = (pedido: IncomingMessage, respuesta: ServerResponse) => boolean;

function listarArchivos(carpeta: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...listarArchivos(ruta));
    else salida.push(ruta);
  }
  return salida;
}

/**
 * Carga la carpeta del cliente y devuelve una función que atiende los pedidos
 * GET/HEAD de esos archivos. Devuelve false si el pedido no es para ella.
 * Lanza un error si la carpeta no tiene `index.html` (falta construir el cliente).
 */
export function crearAtenderEstaticos(carpeta: string, produccion = true): AtenderEstaticos {
  const archivos = new Map<string, Archivo>();
  for (const ruta of listarArchivos(carpeta)) {
    const extension = extname(ruta).toLowerCase();
    const tipo = TIPOS[extension];
    if (!tipo) continue; // mapas de código y otros archivos no se publican
    const url = '/' + relative(carpeta, ruta).split(sep).join('/');
    const contenido = readFileSync(ruta);
    archivos.set(url, {
      tipo,
      contenido,
      comprimido: COMPRIMIBLES.has(extension) && contenido.length > 1024 ? gzipSync(contenido) : null,
      // Los archivos de /assets llevan un código en el nombre: cambian de nombre cuando cambian.
      cache: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }
  const indice = archivos.get('/index.html');
  if (!indice) throw new Error(`No se encontró index.html en ${carpeta}. Falta construir el cliente.`);

  const seguridad = cabecerasDeSeguridad(produccion);

  return (pedido, respuesta) => {
    if (pedido.method !== 'GET' && pedido.method !== 'HEAD') return false;
    let camino: string;
    try {
      camino = decodeURIComponent(new URL(pedido.url ?? '/', 'http://x').pathname);
    } catch {
      return false;
    }
    if (camino.startsWith('/socket.io')) return false;
    const archivo = camino === '/' ? indice : archivos.get(camino);
    if (!archivo) return false;

    const aceptaGzip = /\bgzip\b/.test(String(pedido.headers['accept-encoding'] ?? ''));
    const cuerpo = archivo.comprimido && aceptaGzip ? archivo.comprimido : archivo.contenido;
    respuesta.writeHead(200, {
      ...seguridad,
      'content-type': archivo.tipo,
      'content-length': cuerpo.length,
      'cache-control': archivo.cache,
      vary: 'accept-encoding',
      ...(cuerpo === archivo.comprimido ? { 'content-encoding': 'gzip' } : {}),
      ...(archivo.tipo.startsWith('text/html') ? { 'content-security-policy': POLITICA_CONTENIDO } : {}),
    });
    respuesta.end(pedido.method === 'HEAD' ? undefined : cuerpo);
    return true;
  };
}
