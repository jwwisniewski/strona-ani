// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // TODO: set to the real production URL once the subdomain is live (Phase 8)
  site: 'https://blog.herdomain.com',
  integrations: [sitemap()],
});
