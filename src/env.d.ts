/// <reference types="astro/client" />

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime { }
}
