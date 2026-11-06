// Builds the browser assets shipped inside the Python package:
//   craggy_charts/static/widget.js              anywidget ESM front end
//   craggy_charts/static/craggy-charts.global.js IIFE bundle for to_html() / Streamlit
// Run from anywhere: node python/build.mjs (needs `npm install` in js/).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { build } = createRequire(join(here, '../js/package.json'))('esbuild');
const common = { bundle: true, minify: true, target: 'es2020', legalComments: 'none', logLevel: 'error' };
const out = join(here, 'craggy_charts/static');

await build({ ...common, format: 'esm', entryPoints: [join(here, 'js/widget.ts')], outfile: join(out, 'widget.js') });
await build({ ...common, format: 'iife', globalName: 'CraggyCharts', entryPoints: [join(here, '../js/src/global.ts')], outfile: join(out, 'craggy-charts.global.js') });
console.log('built python/craggy_charts/static/');
