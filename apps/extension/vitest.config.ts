import { defineConfig } from 'vitest/config';

/**
 * jsdom (not the default node environment, and not happy-dom) — nearly every test in this
 * package exercises real DOM parsing (adapters, field detection), and jsdom's more complete
 * DOMParser/querySelectorAll/<script type="application/ld+json"> text-node handling matters
 * more here than happy-dom's faster startup.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
