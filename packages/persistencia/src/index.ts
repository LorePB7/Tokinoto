export * from './tipos';
export { crearRepositorioEnMemoria } from './memoria';
export { crearRepositorioSql, type BaseDeDatos } from './sql';
export { abrirRepositorioPostgres, abrirRepositorioPglite, CARPETA_MIGRACIONES, type OpcionesPostgres } from './conexion';
export { reconstruirJuego, verificarJuego, verificarJuegoGuardado } from './reconstruccion';
export * as esquema from './esquema';
