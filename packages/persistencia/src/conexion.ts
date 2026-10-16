/** Apertura de conexiones: PostgreSQL real (`pg`) y PGlite (pruebas). */
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migrarPg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as esquema from './esquema';
import { crearRepositorioSql } from './sql';
import type { Repositorio } from './tipos';

/** Carpeta con las migraciones SQL generadas por drizzle-kit (`npm run generar`). */
export const CARPETA_MIGRACIONES = fileURLToPath(new URL('../migraciones', import.meta.url));

export interface OpcionesPostgres {
  /** Conexiones máximas del pool (por defecto 5). */
  maxConexiones?: number;
}

/** Abre PostgreSQL, aplica las migraciones pendientes y devuelve el repositorio. */
export async function abrirRepositorioPostgres(url: string, opciones: OpcionesPostgres = {}): Promise<Repositorio> {
  const pool = new pg.Pool({ connectionString: url, max: opciones.maxConexiones ?? 5 });
  // Un error de una conexión ociosa no debe tumbar el servidor.
  pool.on('error', () => {});
  try {
    const bd = drizzlePg(pool, { schema: esquema });
    await migrarPg(bd, { migrationsFolder: CARPETA_MIGRACIONES });
    return crearRepositorioSql(bd, () => pool.end());
  } catch (problema) {
    await pool.end().catch(() => {});
    throw problema;
  }
}

/**
 * PostgreSQL embebido (PGlite), solo para pruebas. Sin `carpeta` vive en memoria.
 * Se importa a pedido para no cargarlo en producción.
 */
export async function abrirRepositorioPglite(carpeta?: string): Promise<Repositorio> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const cliente = carpeta === undefined ? new PGlite() : new PGlite(carpeta);
  const bd = drizzle(cliente, { schema: esquema });
  await migrate(bd, { migrationsFolder: CARPETA_MIGRACIONES });
  return crearRepositorioSql(bd, () => cliente.close());
}
