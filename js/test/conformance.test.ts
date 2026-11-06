// The JS core against the committed conformance fields (the same files the Dart core is held to).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { snapshot, compare, type Fixture, type Snapshot } from '../../conformance/snapshot';

const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('../../conformance/fixtures.json', import.meta.url), 'utf8'));

describe('conformance', () => {
  it.each(fixtures.map(f => [f.name, f] as const))('%s matches expected/', (name, f) => {
    const expected: Snapshot = JSON.parse(readFileSync(new URL(`../../conformance/expected/${name}.json`, import.meta.url), 'utf8'));
    expect(compare(snapshot(f), expected)).toEqual([]);
  });
});
