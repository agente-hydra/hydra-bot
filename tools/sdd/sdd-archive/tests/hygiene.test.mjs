// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempGitRepo } from '../../lib/fixtures.mjs';
import { git } from '../../lib/git.mjs';
import { beginChangeset, endChangeset } from '../../sdd-apply/scripts/changeset.mjs';
import { triageFiles } from '../scripts/triage.mjs';
import { commitLint } from '../scripts/commit_lint.mjs';
import { buildCommit } from '../scripts/build_commit.mjs';

test('archive/commit_lint: enforces R1, R3 duplicate subject, R7 secrets', async () => {
  const repo = await createTempGitRepo('sdd-lint-');
  try {
    // R1 Invalid format
    const badFmt = await commitLint('bad subject', ['file.txt'], { specId: '001', owned: ['file.txt'] }, { repoRoot: repo.dir });
    assert.equal(badFmt.ok, false);
    assert.ok(badFmt.violations.some((v) => v.rule === 'R1'));

    // Valid commit
    const validMsg = 'feat(001): add high performance parser\n\nEvidência: Build gate 100% ok';
    const good = await commitLint(validMsg, ['file.txt'], { specId: '001', owned: ['file.txt'] }, { repoRoot: repo.dir });
    assert.equal(good.ok, true);

    // Commit to repo to test R3 duplicate detection
    repo.writeFile('file.txt', 'content 1');
    await git(['add', 'file.txt'], { cwd: repo.dir });
    await git(['commit', '-m', validMsg], { cwd: repo.dir });

    // Now test duplicate subject
    const dup = await commitLint(validMsg, ['file.txt'], { specId: '001', owned: ['file.txt'] }, { repoRoot: repo.dir });
    assert.equal(dup.ok, false);
    assert.ok(dup.violations.some((v) => v.rule === 'R3'));

    // R7 secret leak
    const leakMsg = 'feat(001): fix auth\n\nToken: ghp_1234567890123456789012345\nEvidência: ok';
    const leak = await commitLint(leakMsg, ['file.txt'], { specId: '001', owned: ['file.txt'] }, { repoRoot: repo.dir });
    assert.equal(leak.ok, false);
    assert.ok(leak.violations.some((v) => v.rule === 'R7'));
  } finally {
    repo.cleanup();
  }
});

test('archive/hygiene: fx-three-dirty-specs isolation regression test', async () => {
  const repo = await createTempGitRepo('sdd-hygiene-');
  try {
    // Other dirty specs already present in working tree
    repo.writeFile('specs/002-feature-b/proposal.md', '# Feature B');
    repo.writeFile('src/feature-b.ts', 'export const b = 2;');

    repo.writeFile('specs/003-feature-c/proposal.md', '# Feature C');
    repo.writeFile('src/feature-c.ts', 'export const c = 3;');

    // Now Spec 001 begins
    repo.writeFile('specs/001-feature-a/proposal.md', '# Feature A');
    await beginChangeset('001-feature-a', repo.dir);

    // Spec 001 implements its own feature file
    repo.writeFile('src/feature-a.ts', 'export const a = 1;');
    const csA = await endChangeset('001-feature-a', repo.dir);

    assert.ok(csA.owned.includes('src/feature-a.ts'));

    // Triage for Spec 001
    const triageA = await triageFiles('001-feature-a', { repoRoot: repo.dir });
    // Triage must isolate: feature-a belongs to include; feature-b and feature-c must NOT be in include!
    assert.ok(triageA.include.includes('src/feature-a.ts'));
    assert.ok(!triageA.include.includes('src/feature-b.ts'));
    assert.ok(!triageA.include.includes('src/feature-c.ts'));

    // Archive spec 001 via buildCommit
    const commitResult = await buildCommit('001-feature-a', {
      repoRoot: repo.dir,
      summary: 'implement feature a with clean isolation',
      evidence: 'Evidência: Build gate OK',
    });

    assert.equal(commitResult.ok, true);

    // Check git log for spec 002 — must NOT have any commits yet!
    const { stdout: logB } = await git(['log', '-1', '--format=%s', '--', 'specs/002-feature-b'], { cwd: repo.dir });
    assert.equal(logB.trim(), ''); // Zero commits touched Spec 002!

    // Check that feature-b.ts and feature-c.ts remain dirty in working tree untouched!
    const { stdout: statusAfter } = await git(['status', '--porcelain=v1'], { cwd: repo.dir });
    assert.match(statusAfter, /src\/feature-b\.ts/);
    assert.match(statusAfter, /src\/feature-c\.ts/);
    assert.doesNotMatch(statusAfter, /src\/feature-a\.ts/);
  } finally {
    repo.cleanup();
  }
});
