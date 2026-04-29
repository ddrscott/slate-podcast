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
  // Legacy-URL redirects for the speakers→hosts / suggestions→topics rename
  // live in public/_redirects rather than here. Astro's `redirects` map
  // appends /index.html to destinations under the Cloudflare adapter, which
  // breaks redirects to server-rendered pages. Cloudflare's _redirects file
  // is honored at the edge with no such mangling.
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
