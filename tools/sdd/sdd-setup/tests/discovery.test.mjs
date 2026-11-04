// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTempGitRepo } from '../../lib/fixtures.mjs';
import { git } from '../../lib/git.mjs';
import { collectEvidence } from '../scripts/collect_evidence.mjs';
import { verifyRoster } from '../scripts/verify_roster.mjs';
import { installRoster } from '../scripts/install_roster.mjs';

test('setup/collect_evidence: gathers evidence and matches schema', async () => {
  const repo = await createTempGitRepo('sdd-ev-');
  try {
    repo.writeFile('package.json', JSON.stringify({ dependencies: { playwright: '^1.40.0', react: '^18.2.0' } }));
    repo.writeFile('src/crawler/index.ts', 'console.log("crawler");');
    repo.writeFile('src/ui/Button.tsx', 'export const Button = () => null;');

    const evidence = await collectEvidence(repo.dir);
    assert.ok(evidence.items.length >= 2);
    const depItem = evidence.items.find((it) => it.id === 'dep-playwright');
    assert.ok(depItem);
    assert.equal(depItem.payload.category, 'browser-automation');
  } finally {
    repo.cleanup();
  }
});

test('setup/verify_roster: passes valid roster and catches ghost anchors', async () => {
  const repo = await createTempGitRepo('sdd-verify-');
  try {
    repo.writeFile('package.json', '{}');
    repo.writeFile('src/crawler/main.ts', 'const a = 1;');
    repo.writeFile('src/ui/page.tsx', 'const b = 2;');
    await git(['add', 'src/', 'package.json'], { cwd: repo.dir });
    await git(['commit', '-m', 'feat: add source files'], { cwd: repo.dir });

    const evidence = {
      items: [
        { id: 'dep-crawler', kind: 'dependency', ref: 'package.json#deps', weight: 1, payload: {} },
        { id: 'mem-rule-1', kind: 'memory', ref: 'src/crawler/main.ts#1', weight: 1, payload: {} },
      ],
    };

    const validRoster = {
      specialists: [
        {
          id: 'specialist-crawler',
          name: 'Crawler Specialist',
          role: 'Browser Automation',
          filePatterns: ['src/crawler/**', 'crawler/**'],
          domainKeywords: ['crawler', 'scrape'],
          goldenRules: [{ text: 'Always use headless', provenance: { evidenceIds: ['mem-rule-1'], origin: 'memory' } }],
        },
        {
          id: 'specialist-ui',
          name: 'UI Specialist',
          role: 'Frontend UI',
          filePatterns: ['src/ui/**', 'components/**'],
          domainKeywords: ['react', 'component'],
          goldenRules: [{ text: 'Strict tsx', provenance: { evidenceIds: ['dep-crawler'], origin: 'code-anchor' } }],
        },
      ],
    };

    const checkValid = await verifyRoster(validRoster, evidence, repo.dir);
    if (!checkValid.ok) {
      console.error('Violations:', checkValid.violations);
    }
    assert.equal(checkValid.ok, true);

    // Test ghost anchor detection (fx-ghost-anchor)
    const ghostRoster = {
      specialists: [
        {
          id: 'specialist-ghost',
          name: 'Ghost Specialist',
          role: 'Imaginary',
          filePatterns: ['src/crawler/**'],
          goldenRules: [
            { text: 'Fake rule', provenance: { evidenceIds: ['nonexistent-evidence-id'], origin: 'memory' } },
          ],
        },
        {
          id: 'specialist-two',
          name: 'Second',
          role: 'Second',
          filePatterns: ['src/ui/**'],
          goldenRules: [],
        },
      ],
    };

    const checkGhost = await verifyRoster(ghostRoster, evidence, repo.dir);
    assert.equal(checkGhost.ok, false);
    assert.ok(checkGhost.violations.some((v) => v.includes('nonexistent-evidence-id')));
  } finally {
    repo.cleanup();
  }
});

test('setup/install_roster: installs and guarantees idempotency (noop on rerun)', async () => {
  const repo = await createTempGitRepo('sdd-install-');
  try {
    const evidence = { items: [{ id: '1', kind: 'ops', ref: 'deploy', weight: 1, payload: {} }] };
    const roster = {
      specialists: [
        {
          id: 'specialist-ops',
          name: 'Ops Specialist',
          role: 'Infra & Deploy',
          filePatterns: ['deploy/**'],
          domainKeywords: ['docker', 'deploy'],
          goldenRules: [{ text: 'Never leak tokens', provenance: { evidenceIds: ['1'], origin: 'ops' } }],
        },
        {
          id: 'specialist-core',
          name: 'Core Specialist',
          role: 'Core Engine',
          filePatterns: ['src/**'],
          domainKeywords: ['engine'],
          goldenRules: [],
        },
      ],
    };

    // First run
    const res1 = await installRoster(roster, evidence, { repoRoot: repo.dir });
    assert.equal(res1.mode, 'first-run');

    // Add custom human note outside managed block in SPECIALIST.md
    const specPath = resolve(repo.dir, '.agent/specialists/specialist-ops/SPECIALIST.md');
    const specContent = readFileSync(specPath, 'utf-8');
    const customized = `${specContent}\n\n## Custom Human Note\nThis note must never be lost.`;
    repo.writeFile('.agent/specialists/specialist-ops/SPECIALIST.md', customized);

    // Second run with identical evidence
    const res2 = await installRoster(roster, evidence, { repoRoot: repo.dir });
    assert.equal(res2.mode, 'noop');

    // Verify human note survived
    const specAfter = readFileSync(specPath, 'utf-8');
    assert.match(specAfter, /Custom Human Note/);
  } finally {
    repo.cleanup();
  }
});
