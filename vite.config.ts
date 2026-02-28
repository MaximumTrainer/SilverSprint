import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { logger } from './api/logger';

/**
 * Vite dev plugin: receives client-side log entries via POST /__client-log
 * and writes them to the server-side log file + stdout.
 */
function clientLogPlugin(): Plugin {
  return {
    name: 'client-log-relay',
    configureServer(server) {
      server.middlewares.use('/__client-log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { level, message, athleteId, data } = JSON.parse(body);
            const prefix = '[CLIENT]';
            if (level === 'error') {
              logger.error(`${prefix} ${message}`, athleteId, data);
            } else if (level === 'warn') {
              logger.warn(`${prefix} ${message}`, athleteId, data);
            } else {
              logger.info(`${prefix} ${message}`, athleteId, data);
            }
          } catch {
            logger.error('[CLIENT] Failed to parse client log payload');
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'INTERVALS_'],
  plugins: [react(), tailwindcss(), clientLogPlugin()],
  server: {
    proxy: {
      '/intervals': {
        target: 'https://intervals.icu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/intervals/, ''),
      },
      '/api': 'http://localhost:3000',
    },
  },
});
