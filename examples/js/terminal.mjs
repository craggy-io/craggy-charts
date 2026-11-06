// The headless core in Node: no DOM, no canvas. It lays out a settled tile field, which this script
// prints to the terminal with 24-bit colour, two characters per tile.
//
//   node examples/js/terminal.mjs [type]        e.g. bar, area, donut, heatmap, treemap
//
// From npm: import { ChartCore } from 'craggy-charts/core'
import { ChartCore } from '../../js/dist/core.js';

const type = process.argv[2] || 'area';
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wave = (i, k, a, b) => Math.round(b + Math.sin(i / k) * a + i * 2);
const data = {
  donut: [{ name: 'Search', value: 42 }, { name: 'Direct', value: 26 }, { name: 'Social', value: 18 }, { name: 'Email', value: 9 }],
  treemap: [{ name: 'Search', value: 42 }, { name: 'Direct', value: 26 }, { name: 'Social', value: 18 }, { name: 'Email', value: 9 }],
  heatmap: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].flatMap((day, d) =>
    Array.from({ length: 12 }, (_, h) => ({ x: `${h * 2}h`, y: day, value: Math.round(5 + Math.sin(h / 2 + d) * 4) }))),
}[type] ?? months.map((month, i) => ({ month, north: wave(i, 2, 12, 40), south: wave(i, 3, 8, 30), west: wave(i, 1.5, 6, 20) }));

const core = new ChartCore({ type, data, stack: type === 'area', cell: 8 });
core.setSize(400, 200);   // pixels: at cell 8 that is 50 × 25 tiles, 100 characters wide
core.settle();            // skip the entrance animation and jump to the final field

const { cols, rows } = core.grid;
const { cov, col } = core.field;   // coverage 0..1 and RGB 0..255 per tile, row-major
const bg = [0x11, 0x1a, 0x20];
const mix = (i, k) => Math.round(bg[k] + (col[i * 3 + k] - bg[k]) * Math.min(1, cov[i] * 1.4));
const glyph = c => (c > 0.66 ? '██' : c > 0.33 ? '▓▓' : c > 0.05 ? '░░' : '  ');

let out = '';
for (let r = 0; r < rows; r++) {
  out += `\x1b[48;2;${bg.join(';')}m`;
  for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    out += `\x1b[38;2;${mix(i, 0)};${mix(i, 1)};${mix(i, 2)}m${glyph(cov[i])}`;
  }
  out += '\x1b[0m\n';
}
process.stdout.write(out);
console.log(core.summary());   // the same text screen readers get
