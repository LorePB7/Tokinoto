/**
 * Pruebas del modo publicado: el servidor entrega el cliente web con
 * cabeceras de seguridad, no expone archivos fuera de la carpeta y limita
 * las conexiones simultáneas.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as conectarCliente, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { crearServidor, type OpcionesServidor, type ServidorTokinoto } from '../src/servidor';

let carpeta: string;
const servidores: ServidorTokinoto[] = [];
const sockets: Socket[] = [];

beforeAll(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'tokinoto-cliente-'));
  mkdirSync(join(carpeta, 'assets'));
  writeFileSync(join(carpeta, 'index.html'), '<!doctype html><title>Tokinoto</title>' + ' '.repeat(2000));
  writeFileSync(join(carpeta, 'assets', 'app-abc123.js'), 'console.log("hola");');
  writeFileSync(join(carpeta, 'assets', 'app-abc123.js.map'), '{}');
  // Un archivo fuera de la carpeta del cliente, que nunca debe poder leerse.
  writeFileSync(join(carpeta, '..', 'secreto-tokinoto.txt'), 'no');
});

afterAll(() => {
  rmSync(carpeta, { recursive: true, force: true });
  rmSync(join(carpeta, '..', 'secreto-tokinoto.txt'), { force: true });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const servidor of servidores.splice(0)) await servidor.cerrar();
});

async function levantar(opciones: OpcionesServidor = {}): Promise<number> {
  const servidor = crearServidor({ carpetaCliente: carpeta, produccion: true, ...opciones });
  servidores.push(servidor);
  return servidor.escuchar(0, '127.0.0.1');
}

interface Respuesta {
  estado: number;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo: string;
}

/** Pedido HTTP crudo (sin normalizar la ruta, para probar rutas maliciosas). */
function pedir(puerto: number, ruta: string, cabeceras: Record<string, string> = {}, metodo = 'GET'): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const pedido = request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: cabeceras }, (r) => {
      const partes: Buffer[] = [];
      r.on('data', (parte: Buffer) => partes.push(parte));
      r.on('end', () =>
        resolver({ estado: r.statusCode ?? 0, cabeceras: r.headers, cuerpo: Buffer.concat(partes).toString() }),
      );
    });
    pedido.on('error', rechazar);
    pedido.end();
  });
}

describe('cliente web servido por el juego', () => {
  it('entrega index.html con la política de contenido y sin caché', async () => {
    const puerto = await levantar();
    const r = await pedir(puerto, '/');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toContain('<title>Tokinoto</title>');
    expect(r.cabeceras['content-type']).toBe('text/html; charset=utf-8');
    expect(r.cabeceras['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.cabeceras['content-security-policy']).toContain("script-src 'self'");
    expect(r.cabeceras['cache-control']).toBe('no-cache');
    expect(r.cabeceras['x-content-type-options']).toBe('nosniff');
    expect(r.cabeceras['referrer-policy']).toBe('no-referrer');
    expect(r.cabeceras['strict-transport-security']).toBe('max-age=31536000');
  });

  it('el enlace de invitación (/?sala=CODIGO) abre la página', async () => {
    const puerto = await levantar();
    const r = await pedir(puerto, '/?sala=ABCDEFGH');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toContain('Tokinoto');
  });

  it('los archivos con código en el nombre se guardan en caché por un año', async () => {
    const puerto = await levantar();
    const r = await pedir(puerto, '/assets/app-abc123.js');
    expect(r.estado).toBe(200);
    expect(r.cabeceras['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.cabeceras['cache-control']).toContain('immutable');
  });

  it('comprime con gzip si el navegador lo acepta', async () => {
    const puerto = await levantar();
    const r = await pedir(puerto, '/', { 'accept-encoding': 'gzip, br' });
    expect(r.cabeceras['content-encoding']).toBe('gzip');
    const sinGzip = await pedir(puerto, '/');
    expect(sinGzip.cabeceras['content-encoding']).toBeUndefined();
  });

  it('no publica mapas de código ni archivos fuera de la carpeta', async () => {
    const puerto = await levantar();
    expect((await pedir(puerto, '/assets/app-abc123.js.map')).estado).toBe(404);
    for (const ruta of ['/../secreto-tokinoto.txt', '/%2e%2e/secreto-tokinoto.txt', '/assets/..%2f..%2fsecreto-tokinoto.txt']) {
      const r = await pedir(puerto, ruta);
      expect(r.estado).toBe(404);
      expect(r.cuerpo).not.toBe('no');
    }
  });

  it('solo responde GET y HEAD', async () => {
    const puerto = await levantar();
    expect((await pedir(puerto, '/', {}, 'POST')).estado).toBe(404);
    const cabeza = await pedir(puerto, '/', {}, 'HEAD');
    expect(cabeza.estado).toBe(200);
    expect(cabeza.cuerpo).toBe('');
  });

  it('la ruta de estado responde ok con cabeceras de seguridad', async () => {
    const puerto = await levantar();
    const r = await pedir(puerto, '/salud');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toBe('ok');
    expect(r.cabeceras['x-frame-options']).toBe('DENY');
  });

  it('falla al arrancar si el cliente no está construido', () => {
    const vacia = mkdtempSync(join(tmpdir(), 'tokinoto-vacia-'));
    try {
      expect(() => crearServidor({ carpetaCliente: vacia })).toThrow(/index\.html/);
    } finally {
      rmSync(vacia, { recursive: true, force: true });
    }
  });
});

function conectar(puerto: number, origen?: string): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = conectarCliente(`http://127.0.0.1:${puerto}`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000,
      ...(origen ? { extraHeaders: { origin: origen } } : {}),
    });
    sockets.push(socket);
    socket.once('connect', () => resolver(true));
    socket.once('connect_error', () => resolver(false));
  });
}

describe('conexiones', () => {
  it('rechaza conexiones nuevas al llegar al límite y las vuelve a aceptar al liberarse', async () => {
    const puerto = await levantar({ maxConexiones: 2 });
    expect(await conectar(puerto)).toBe(true);
    expect(await conectar(puerto)).toBe(true);
    expect(await conectar(puerto)).toBe(false);
    sockets[0]?.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(await conectar(puerto)).toBe(true);
  });

  it('con orígenes configurados rechaza otros sitios', async () => {
    const puerto = await levantar({ origenes: ['https://tokinoto.onrender.com'] });
    expect(await conectar(puerto, 'https://tokinoto.onrender.com')).toBe(true);
    expect(await conectar(puerto, 'https://sitio-malo.com')).toBe(false);
  });
});
