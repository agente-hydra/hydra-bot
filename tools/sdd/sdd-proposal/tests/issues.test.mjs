// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTempGitRepo } from '../../lib/fixtures.mjs';
import { getNextSpecId } from '../scripts/next_spec_id.mjs';
import { syncIssues } from '../scripts/sync_issues.mjs';
import { recordEvidence } from '../../sdd-apply/scripts/record_evidence.mjs';
import { closeIssues } from '../../sdd-apply/scripts/close_issues.mjs';

test('proposal/next_spec_id: computes max ID + 1 across specs', async () => {
  const repo = await createTempGitRepo('sdd-id-');
  try {
    repo.writeFile('specs/005-feature-x/proposal.md', '# Feature X');
    repo.writeFile('specs/archive/012-feature-old/proposal.md', '# Old');

    const res = await getNextSpecId(repo.dir);
    assert.equal(res.nextId, '013');
    assert.equal(res.maxFound, 12);
  } finally {
    repo.cleanup();
  }
});

test('proposal/sync_issues: markdown-only mode and secret rejection', async () => {
  const repo = await createTempGitRepo('sdd-issues-');
  try {
    const planText = [
      '# Plan',
      '- [ ] **T1 — Implement database query**',
      '  - **Aceite:** Query returns results',
      '- [ ] **T2 — UI Component**',
      '  - **Aceite:** Component renders button',
    ].join('\n');

    repo.writeFile('specs/099/spec-plan.md', planText);
    repo.writeFile('specs/099/proposal.md', '# Feature 099');

    const res = await syncIssues('099', { repoRoot: repo.dir, forceMarkdownOnly: true });
    assert.equal(res.mode, 'markdown-only');
    assert.equal(res.issues.length, 3); // Epic + T1 + T2

    // Test secret rejection in plan
    repo.writeFile('specs/099/spec-plan.md', `${planText}\nToken: ghp_1234567890123456789012345`);
    await assert.rejects(async () => {
      await syncIssues('099', { repoRoot: repo.dir, forceMarkdownOnly: true });
    }, /Secret detected/);
  } finally {
    repo.cleanup();
  }
});

test('apply/evidence & close_issues: records evidence and closes verified issues', async () => {
  const repo = await createTempGitRepo('sdd-ev-close-');
  try {
    const planText = [
      '# Plan',
      '- [ ] **T1 — Add test file**',
      '  - **Aceite:** Node runs file',
    ].join('\n');

    repo.writeFile('specs/050/spec-plan.md', planText);
    await syncIssues('050', { repoRoot: repo.dir, forceMarkdownOnly: true });

    // Initial check: issue is open
    const initialIssues = JSON.parse(readFileSync(resolve(repo.dir, 'specs/050/issues.json'), 'utf-8'));
    assert.equal(initialIssues.issues.find((i) => i.task === 1).state, 'open');

    // Record success evidence for T1
    await recordEvidence('050', 1, 'Node runs file', [process.execPath, '-e', 'console.log("ok")'], { repoRoot: repo.dir });

    // Close issues
    const closeRes = await closeIssues('050', { repoRoot: repo.dir });
    assert.equal(closeRes.closedCount, 1);
    assert.equal(closeRes.epicClosed, true);

    // Verify issues.json was updated
    const afterIssues = JSON.parse(readFileSync(resolve(repo.dir, 'specs/050/issues.json'), 'utf-8'));
    assert.equal(afterIssues.issues.find((i) => i.task === 1).state, 'closed');
    assert.equal(afterIssues.issues.find((i) => i.task === 'epic').state, 'closed');
  } finally {
    repo.cleanup();
  }
});
