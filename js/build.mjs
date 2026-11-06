// Bundles: ESM entries (index, core, react, element) and an IIFE global `CraggyCharts` for <script> use.
import { build } from 'esbuild';
const common = { bundle: true, minify: true, sourcemap: true, target: 'es2020', legalComments: 'none' };
await build({ ...common, format: 'esm', outdir: 'dist', entryPoints: { 'craggy-charts': 'src/index.ts', core: 'src/core/index.ts', react: 'src/react.tsx', element: 'src/element.ts' }, external: ['react', 'react/jsx-runtime'], splitting: true, chunkNames: 'chunks/[name]-[hash]', jsx: 'automatic' });
await build({ ...common, format: 'iife', globalName: 'CraggyCharts', outfile: 'dist/craggy-charts.global.js', entryPoints: ['src/global.ts'] });
console.log('built dist/');
