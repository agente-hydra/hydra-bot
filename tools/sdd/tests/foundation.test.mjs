// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTempGitRepo } from '../lib/fixtures.mjs';
import { getStatusPorcelain, addPaths, getStagedFiles, hashObject } from '../lib/git.mjs';
import { scanSecrets } from '../lib/secrets.mjs';
import { hasManagedBlock, readManagedBlock, writeManagedBlock } from '../lib/managed-block.mjs';
import { validateSchema } from '../lib/schema.mjs';

test('lib/secrets: detects leaks and redacts', () => {
  const text = 'API_KEY="ghp_1234567890123456789012345" and sk-abcdef123456789012345678';
  const res = scanSecrets(text);
  assert.equal(res.hasSecret, true);
  assert.equal(res.matches.length, 2);
  assert.match(res.matches[0].redacted, /^ghp\.\.\.[0-9]{3}$/);
});

test('lib/managed-block: read and write blocks preserving outside text', () => {
  const original = '# Title\n\nSome text before.\n\n<!-- sdd:managed:begin id="test" -->\nold inner\n<!-- sdd:managed:end id="test" -->\n\nSome text after.\n';
  assert.equal(hasManagedBlock(original, 'test'), true);
  assert.equal(readManagedBlock(original, 'test')?.trim(), 'old inner');

  const updated = writeManagedBlock(original, 'new content here', 'test');
  assert.match(updated, /new content here/);
  assert.match(updated, /Some text before\./);
  assert.match(updated, /Some text after\./);

  // Append if not present
  const fresh = '# File\nNo block.';
  const appended = writeManagedBlock(fresh, 'added block', 'fresh');
  assert.equal(hasManagedBlock(appended, 'fresh'), true);
  assert.equal(readManagedBlock(appended, 'fresh')?.trim(), 'added block');
});

test('lib/schema: minimal JSON schema validator', () => {
  const schema = {
    type: 'object',
    required: ['name', 'count'],
    properties: {
      name: { type: 'string' },
      count: { type: 'integer', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  const valid = validateSchema({ name: 'test', count: 2, tags: ['a', 'b'] }, schema);
  assert.equal(valid.valid, true);

  const invalid = validateSchema({ name: 'test', count: 0 }, schema);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 1);
});

test('lib/fixtures & lib/git: safe git operations', async () => {
  const repo = await createTempGitRepo('git-test-');
  try {
    repo.writeFile('test.txt', 'hello git');
    const status = await getStatusPorcelain(repo.dir);
    assert.equal(status.length, 1);
    assert.equal(status[0].path, 'test.txt');

    // add explicit path
    await addPaths(['test.txt'], repo.dir);
    const staged = await getStagedFiles(repo.dir);
    assert.deepEqual(staged, ['test.txt']);

    // verify wildcard rejection
    await assert.rejects(async () => {
      await addPaths(['.'], repo.dir);
    }, /Forbidden wildcard/);

    const hash = await hashObject('hello git\n', { isContent: true, cwd: repo.dir });
    assert.match(hash, /^[0-9a-f]{40}$/);
  } finally {
    repo.cleanup();
  }
});

test('schemas: all 8 schemas exist and are valid json', () => {
  const schemaNames = [
    'evidence.schema.json',
    'roster-lock.schema.json',
    'sdd-config.schema.json',
    'scout.schema.json',
    'issues.schema.json',
    'changeset.schema.json',
    'evidence-record.schema.json',
    'memory-delta.schema.json',
  ];

  for (const name of schemaNames) {
    const raw = readFileSync(resolve('tools/sdd/schemas', name), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.equal(typeof parsed, 'object');
    assert.equal(parsed.$schema, 'http://json-schema.org/draft-07/schema#');
  }
});
