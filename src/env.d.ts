/// <reference path="../.astro/types.d.ts" />
/// <reference path="../worker-configuration.d.ts" />

import type { Runtime } from '@astrojs/cloudflare';

// Augment the wrangler-generated Env with secrets (set via `wrangler secret put`).
// Vars (APP_BASE_URL, AUTH_BASE_URL) are already in worker-configuration.d.ts
// from wrangler.toml's [vars] block.
//
// Auth is delegated to auth.ljs.app — JWT_SECRET is the shared HMAC key.
declare global {
  interface Env {
    JWT_SECRET: string;
    RESEND_API_KEY: string;
    RESEND_FROM: string;
    CRON_SECRET: string;
  }

  namespace App {
    interface Locals extends Runtime<Env> {
      user?: {
        id: string;
        email: string;
        display_name: string | null;
        scopes: string[];
      };
      jwt?: import('./lib/auth').SessionPayload;
    }
  }
}

export {};
