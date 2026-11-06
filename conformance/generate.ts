// Writes conformance/expected/<fixture>.json from the JS core (the reference implementation).
// Run from js/: npm run conformance
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, type Fixture } from './snapshot';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures: Fixture[] = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
mkdirSync(join(here, 'expected'), { recursive: true });
for (const f of fixtures) writeFileSync(join(here, 'expected', f.name + '.json'), JSON.stringify(snapshot(f)) + '\n');
console.log(`wrote ${fixtures.length} expected fields`);
