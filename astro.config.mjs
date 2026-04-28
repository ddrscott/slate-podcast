import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
      // Honors `remote = true` on bindings in wrangler.toml so the dev
      // server proxies D1 queries to the production database.
      remoteBindings: true,
    },
  }),
  integrations: [
    react(),
    tailwind({ applyBaseStyles: true }),
  ],
  vite: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'ag-grid': ['ag-grid-community', 'ag-grid-react'],
            'md-editor': ['@uiw/react-md-editor'],
          },
        },
      },
    },
  },
});
