import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // supertest serves each request from an OS-assigned port bound to `::`; on macOS that can land
    // on a port some other local app holds on 127.0.0.1, and the request dies with "socket hang up".
    // Rare and outside our control, so retry rather than fail the pre-push gate.
    retry: 2,
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
