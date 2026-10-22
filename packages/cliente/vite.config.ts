import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/** Raíz del repositorio: ahí va el `.env` de desarrollo, compartido con el servidor. */
const raiz = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, raiz, ''), ...process.env };
  // El ID de cliente de Google es público (viaja en la página). En Render basta
  // con definir GOOGLE_CLIENT_ID una vez: lo usan el servidor y este build.
  const idGoogle = env['VITE_GOOGLE_CLIENT_ID'] || env['GOOGLE_CLIENT_ID'] || '';
  return {
    plugins: [react()],
    envDir: raiz,
    define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(idGoogle.trim()) },
    server: { host: true, port: 5173 },
  };
});
