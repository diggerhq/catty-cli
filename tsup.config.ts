import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  minify: true,
  sourcemap: true,
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version || 'dev'),
  },
});
