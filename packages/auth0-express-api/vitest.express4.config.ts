import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Runs the tests on Express 4. The peer range is `^4.18.0 || ^5.0.0`, but the dev dependency is Express 5, so this
// points `express` at an Express 4 that is installed somewhere else. See the `Express 4` job in
// `.github/workflows/test.yml`. Express 4 ignores a promise that a middleware rejects, which ends the process, so only
// a run on Express 4 can show that a middleware never rejects.
const entry = process.env.EXPRESS_4_ENTRY;

if (!entry) {
  throw new Error('Set EXPRESS_4_ENTRY to the index.js of an Express 4 install.');
}

const { version } = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as { version: string };

if (!version.startsWith('4.')) {
  throw new Error(`EXPRESS_4_ENTRY is Express ${version}, not Express 4.`);
}

export default mergeConfig(base, defineConfig({ resolve: { alias: [{ find: /^express$/, replacement: entry }] } }));
