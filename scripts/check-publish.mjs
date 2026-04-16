import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packages = [
  {
    name: 'email-connect',
    cwd: rootDir,
    required: [
      'package.json',
      'README.md',
      'LICENSE',
      'VERSIONING.md',
      'RELEASING.md',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/server.js',
      'dist/server.d.ts',
    ],
    forbidden: ['dist/server/index.js', 'dist/server/index.d.ts'],
  },
  {
    name: '@email-connect/core',
    cwd: path.join(rootDir, 'packages/core'),
    required: ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'dist/server/index.js'],
  },
  {
    name: '@email-connect/gmail',
    cwd: path.join(rootDir, 'packages/gmail'),
    required: ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'],
  },
  {
    name: '@email-connect/graph',
    cwd: path.join(rootDir, 'packages/graph'),
    required: ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'],
  },
];

const disallowedPrefixes = ['src/', 'test/', 'examples/', 'packages/', 'node_modules/', 'coverage/'];

for (const pkg of packages) {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkg.cwd,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(raw);
  const packResult = Array.isArray(parsed) ? parsed[0] : parsed;
  const entries = (packResult.files || []).map((file) => String(file.path));
  const entrySet = new Set(entries);

  for (const required of pkg.required) {
    assert(entrySet.has(required), `${pkg.name} tarball is missing required file: ${required}`);
  }

  for (const forbidden of pkg.forbidden || []) {
    assert(!entrySet.has(forbidden), `${pkg.name} tarball includes stale file: ${forbidden}`);
  }

  for (const entry of entries) {
    for (const prefix of disallowedPrefixes) {
      assert(!entry.startsWith(prefix), `${pkg.name} tarball unexpectedly includes ${entry}`);
    }
  }
}

console.log('Publish hygiene checks passed.');
