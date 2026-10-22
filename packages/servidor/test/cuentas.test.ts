/**
 * Fase 6: ingreso con Google y como invitado, sesiones firmadas y una sala
 * activa por persona.
 */
import { spawnSync } from 'node:child_process';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { io as conectarCliente, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { crearRepositorioEnMemoria } from '@tokinoto/persistencia';
import { CANAL_COMANDOS, CANAL_MENSAJES, VERSION_PROTOCOLO, type MensajeServidor } from '@tokinoto/protocolo';
import {
  Sesiones,
  crearServidor,
  crearVerificadorGoogle,
  limpiarNombre,
  verificadorDePrueba,
  type OpcionesServidor,
  type ServidorTokinoto,
} from '../src';

// ---------------------------------------------------------------------------
// Sesiones firmadas
// ---------------------------------------------------------------------------

describe('sesiones firmadas', () => {
  const SECRETO = 'un-secreto-de-prueba-bastante-largo-1234';

  it('una sesión válida se lee; adulterada, con otra clave o vencida, no', () => {
    let ahora = 1_000;
    const sesiones = new Sesiones(SECRETO, () => ahora, 10_000);
    const deCuenta = sesiones.deCuenta('cuenta-1');
    expect(sesiones.leer(deCuenta)).toMatchObject({ t: 'g', c: 'cuenta-1' });
    const invitado = sesiones.nuevoInvitado('  Lu  ');
    expect(invitado.identidad).toMatchObject({ tipo: 'invitado', nombre: 'Lu', cuentaId: null });
    expect(sesiones.leer(invitado.sesion)).toMatchObject({ t: 'i', n: 'Lu' });

    // Cambiar el cuerpo (por ejemplo, para hacerse pasar por otra cuenta) rompe la firma.
    const [cuerpo, firma] = deCuenta.split('.') as [string, string];
    const otroCuerpo = Buffer.from(JSON.stringify({ t: 'g', c: 'cuenta-2', exp: 999_999 })).toString('base64url');
    expect(sesiones.leer(`${otroCuerpo}.${firma}`)).toBeNull();
    expect(sesiones.leer(`${cuerpo}.${firma.slice(1)}`)).toBeNull();
    expect(sesiones.leer('basura')).toBeNull();
    expect(sesiones.leer('a.b.c')).toBeNull();
    expect(new Sesiones(`${SECRETO}-otro`, () => ahora).leer(deCuenta)).toBeNull();

    ahora += 10_000;
    expect(sesiones.leer(deCuenta)).toBeNull();
  });

  it('exige un secreto de al menos 32 caracteres', () => {
    expect(() => new Sesiones('corto')).toThrow(/32/);
  });

  it('limpia los nombres como los acepta una sala', () => {
    expect(limpiarNombre('  Ana   María  ')).toBe('Ana María');
    expect(limpiarNombre('x'.repeat(30))).toBe('x'.repeat(20));
    expect(limpiarNombre('Ana\u0000​')).toBe('Ana');
    expect(limpiarNombre('   ')).toBe('Jugador');
  });
});

// ---------------------------------------------------------------------------
// Verificación de tokens de Google (con claves propias, sin red)
// ---------------------------------------------------------------------------

describe('verificador de Google', () => {
  const ID_CLIENTE = '1234-abc.apps.googleusercontent.com';
  const clave = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otraClave = generateKeyPairSync('rsa', { modulusLength: 2048 });

  /** Cliente de Google que usa nuestra clave pública en vez de pedir las de Google. */
  class ClienteSinRed extends OAuth2Client {
    override async getFederatedSignonCertsAsync(): ReturnType<OAuth2Client['getFederatedSignonCertsAsync']> {
      const pem = clave.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      // "PEM" es el valor del enum interno CertificateFormat, que la librería no exporta.
      const format = 'PEM' as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>['format'];
      return { certs: { 'kid-1': pem }, format };
    }
  }

  function firmar(datos: Record<string, unknown>, privada = clave.privateKey): string {
    const b64 = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const cuerpo = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'kid-1' })}.${b64(datos)}`;
    const firma = createSign('RSA-SHA256').update(cuerpo).sign(privada).toString('base64url');
    return `${cuerpo}.${firma}`;
  }

  const ahora = () => Math.floor(Date.now() / 1000);
  const valido = (cambios: Record<string, unknown> = {}) => ({
    iss: 'https://accounts.google.com',
    aud: ID_CLIENTE,
    sub: '10987654321',
    email: 'no-se-guarda@example.com',
    name: 'Ana Pérez',
    iat: ahora() - 10,
    exp: ahora() + 3600,
    ...cambios,
  });

  it('acepta un token bueno y devuelve el sub y el nombre (nunca el email)', async () => {
    const verificar = await crearVerificadorGoogle(ID_CLIENTE, new ClienteSinRed());
    expect(await verificar(firmar(valido()))).toEqual({ sub: '10987654321', nombre: 'Ana Pérez' });
  });

  it('rechaza audiencia equivocada, token vencido, otro emisor y firma ajena', async () => {
    const verificar = await crearVerificadorGoogle(ID_CLIENTE, new ClienteSinRed());
    await expect(verificar(firmar(valido({ aud: 'otra-app.apps.googleusercontent.com' })))).rejects.toThrow();
    await expect(verificar(firmar(valido({ iat: ahora() - 7200, exp: ahora() - 3600 })))).rejects.toThrow();
    await expect(verificar(firmar(valido({ iss: 'https://malo.example.com' })))).rejects.toThrow();
    await expect(verificar(firmar(valido(), otraClave.privateKey))).rejects.toThrow();
    await expect(verificar('no-es-un-jwt')).rejects.toThrow();
  });

  it('el verificador de prueba solo acepta "prueba:<nombre>"', async () => {
    expect(await verificadorDePrueba('prueba:Ana')).toEqual({ sub: 'prueba-ana', nombre: 'Ana' });
    await expect(verificadorDePrueba('eyJhbGciOi.x.y')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Por red
// ---------------------------------------------------------------------------

const abiertos: { servidores: ServidorTokinoto[]; sockets: Socket[] } = { servidores: [], sockets: [] };
afterEach(async () => {
  for (const socket of abiertos.sockets) socket.disconnect();
  for (const servidor of abiertos.servidores) await servidor.cerrar();
  abiertos.sockets = [];
  abiertos.servidores = [];
});

async function levantar(opciones: OpcionesServidor = {}): Promise<{ url: string; servidor: ServidorTokinoto }> {
  const servidor = crearServidor({ verificadorGoogle: verificadorDePrueba, ...opciones });
  abiertos.servidores.push(servidor);
  return { url: `http://127.0.0.1:${await servidor.escuchar(0, '127.0.0.1')}`, servidor };
}

let contador = 0;
interface Conexion {
  pedir(tipo: string, datos?: unknown): Promise<MensajeServidor>;
  recibidos: MensajeServidor[];
}

async function conectar(url: string): Promise<Conexion> {
  const socket = conectarCliente(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  abiertos.sockets.push(socket);
  const recibidos: MensajeServidor[] = [];
  const esperas = new Map<string, (m: MensajeServidor) => void>();
  socket.on(CANAL_MENSAJES, (m: MensajeServidor) => {
    recibidos.push(m);
    if ((m.tipo === 'ok' || m.tipo === 'error') && m.idPedido) esperas.get(m.idPedido)?.(m);
  });
  await new Promise<void>((resolver, rechazar) => {
    socket.once('connect', () => resolver());
    socket.once('connect_error', rechazar);
  });
  return {
    recibidos,
    pedir(tipo, datos) {
      const idPedido = `k${++contador}`;
      const respuesta = new Promise<MensajeServidor>((resolver) => esperas.set(idPedido, resolver));
      socket.emit(CANAL_COMANDOS, { v: VERSION_PROTOCOLO, tipo, idPedido, ...(datos === undefined ? {} : { datos }) });
      return respuesta;
    },
  };
}

const datos = (m: MensajeServidor) => m.datos as Record<string, unknown>;

describe('ingreso por red', () => {
  it('con Google: la misma persona vuelve a la misma cuenta y conserva el nombre editado', async () => {
    const { url } = await levantar();
    const a = await conectar(url);
    const primera = await a.pedir('cuenta.entrar', { credencial: 'prueba:Ana' });
    expect(primera).toMatchObject({ tipo: 'ok', datos: { cuenta: { tipo: 'google', nombre: 'Ana' } } });
    const cambio = await a.pedir('cuenta.cambiarNombre', { nombre: '  La Ana  ' });
    expect(datos(cambio)['cuenta']).toEqual({ tipo: 'google', nombre: 'La Ana' });

    const b = await conectar(url);
    expect(datos(await b.pedir('cuenta.entrar', { credencial: 'prueba:Ana' }))['cuenta']).toEqual({ tipo: 'google', nombre: 'La Ana' });
    // La sesión vieja también sirve, y trae el nombre actual.
    const c = await conectar(url);
    expect(datos(await c.pedir('cuenta.reanudar', { sesion: datos(primera)['sesion'] }))['cuenta']).toEqual({
      tipo: 'google',
      nombre: 'La Ana',
    });
  });

  it('rechaza credenciales inválidas y avisa si Google no está configurado', async () => {
    const { url } = await levantar();
    const a = await conectar(url);
    expect(datos(await a.pedir('cuenta.entrar', { credencial: 'eyJhbGciOi.falso.token' }))).toMatchObject({
      codigo: 'CREDENCIAL_INVALIDA',
    });
    const sinGoogle = await levantar({ verificadorGoogle: null });
    const b = await conectar(sinGoogle.url);
    expect(datos(await b.pedir('cuenta.entrar', { credencial: 'prueba:Ana' }))).toMatchObject({ codigo: 'LOGIN_NO_DISPONIBLE' });
    // Como invitado se entra igual.
    expect((await b.pedir('cuenta.entrarInvitado', { nombre: 'Beto' })).tipo).toBe('ok');
  });

  it('una sesión de otro servidor (otro secreto) no sirve', async () => {
    const uno = await levantar();
    const otro = await levantar();
    const a = await conectar(uno.url);
    const sesion = datos(await a.pedir('cuenta.entrarInvitado', { nombre: 'Ana' }))['sesion'];
    const b = await conectar(otro.url);
    expect(datos(await b.pedir('cuenta.reanudar', { sesion }))).toMatchObject({ codigo: 'SESION_INVALIDA' });
  });

  it('con el mismo secreto la sesión sobrevive a un reinicio (como en Render)', async () => {
    const secreto = 'secreto-compartido-entre-reinicios-123456';
    const cuentas = crearRepositorioEnMemoria();
    const uno = await levantar({ sesiones: new Sesiones(secreto), cuentas });
    const a = await conectar(uno.url);
    const sesion = datos(await a.pedir('cuenta.entrar', { credencial: 'prueba:Ana' }))['sesion'];
    const otro = await levantar({ sesiones: new Sesiones(secreto), cuentas });
    const b = await conectar(otro.url);
    expect(datos(await b.pedir('cuenta.reanudar', { sesion }))['cuenta']).toEqual({ tipo: 'google', nombre: 'Ana' });
  });

  it('no se cambia de nombre ni de cuenta con una sala abierta', async () => {
    const { url } = await levantar();
    const a = await conectar(url);
    await a.pedir('cuenta.entrarInvitado', { nombre: 'Ana' });
    expect((await a.pedir('sala.crear', {})).tipo).toBe('ok');
    expect(datos(await a.pedir('cuenta.cambiarNombre', { nombre: 'Otra' }))).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
    expect(datos(await a.pedir('cuenta.entrar', { credencial: 'prueba:Beto' }))).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
  });

  it('limita los ingresos por conexión y los invitados nuevos en todo el servidor', async () => {
    const { url } = await levantar({
      limiteIngresos: { capacidad: 2, porSegundo: 0.001 },
      limiteInvitados: { capacidad: 3, porSegundo: 0.001 },
    });
    const a = await conectar(url);
    expect((await a.pedir('cuenta.entrarInvitado', { nombre: 'A1' })).tipo).toBe('ok');
    expect((await a.pedir('cuenta.entrarInvitado', { nombre: 'A2' })).tipo).toBe('ok');
    expect(datos(await a.pedir('cuenta.entrarInvitado', { nombre: 'A3' }))).toMatchObject({ codigo: 'DEMASIADOS_MENSAJES' });
    const b = await conectar(url);
    expect((await b.pedir('cuenta.entrarInvitado', { nombre: 'B1' })).tipo).toBe('ok');
    expect(datos(await b.pedir('cuenta.entrarInvitado', { nombre: 'B2' }))).toMatchObject({ codigo: 'DEMASIADOS_MENSAJES' });
  });

  it('una cuenta ocupa un solo asiento: entrar dos veces a la misma sala reemplaza la conexión', async () => {
    const { url, servidor } = await levantar();
    const anfitrion = await conectar(url);
    await anfitrion.pedir('cuenta.entrarInvitado', { nombre: 'Anfitrión' });
    const codigo = datos(await anfitrion.pedir('sala.crear', {}))['codigo'];

    const celular = await conectar(url);
    await celular.pedir('cuenta.entrar', { credencial: 'prueba:Ana' });
    const primero = datos(await celular.pedir('sala.unirse', { codigo }));
    const compu = await conectar(url);
    await compu.pedir('cuenta.entrar', { credencial: 'prueba:Ana' });
    const segundo = datos(await compu.pedir('sala.unirse', { codigo }));
    expect(segundo['idJugador']).toBe(primero['idJugador']);
    expect(servidor.gestor.buscar(String(codigo))!.cantidadJugadores).toBe(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(celular.recibidos.some((m) => m.tipo === 'error' && datos(m)['codigo'] === 'SESION_REEMPLAZADA')).toBe(true);
  });

  it('quien abandona un juego en curso puede entrar a otra sala; quien sigue sentado, no', async () => {
    const { url } = await levantar();
    const conexiones = await Promise.all([0, 1, 2, 3].map(() => conectar(url)));
    for (const [i, c] of conexiones.entries()) expect((await c.pedir('cuenta.entrar', { credencial: `prueba:Jugador ${i}` })).datos).toMatchObject({ cuenta: { nombre: `Jugador ${i}` } });
    const codigo = datos(await conexiones[0]!.pedir('sala.crear', {}))['codigo'];
    for (const c of conexiones.slice(1)) expect((await c.pedir('sala.unirse', { codigo })).datos).toMatchObject({ codigo });
    expect((await conexiones[0]!.pedir('sala.iniciar')).tipo).toBe('ok');

    // Beto se va sin salir (se corta): sigue sentado y no puede abrir otra sala.
    const otraDeBeto = await conectar(url);
    await otraDeBeto.pedir('cuenta.entrar', { credencial: 'prueba:Jugador 1' });
    expect(datos(await otraDeBeto.pedir('sala.crear', {}))).toMatchObject({ codigo: 'YA_ESTAS_EN_UNA_SALA' });
    expect(datos(await otraDeBeto.pedir('sala.consultar'))).toMatchObject({ vigente: true, codigo });

    // Cata abandona a propósito: el piloto juega por ella y queda libre.
    expect((await conexiones[2]!.pedir('sala.salir')).tipo).toBe('ok');
    expect((await conexiones[2]!.pedir('sala.crear', {})).tipo).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Arranque en producción
// ---------------------------------------------------------------------------

describe('arranque', () => {
  const principal = fileURLToPath(new URL('../src/principal.ts', import.meta.url));
  const arrancar = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', principal], {
      env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production', TOKINOTO_ORIGENES: 'https://x.test', PUERTO: '0', ...env },
      encoding: 'utf8',
      timeout: 30_000,
    });

  it('en producción no arranca con el ingreso de prueba', () => {
    const r = arrancar({ TOKINOTO_AUTH_PRUEBA: '1', GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/TOKINOTO_AUTH_PRUEBA no se permite en producción/);
  }, 40_000);

  it('en producción no arranca sin GOOGLE_CLIENT_ID', () => {
    const r = arrancar({});
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/GOOGLE_CLIENT_ID/);
  }, 40_000);
});
