// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempGitRepo } from '../../lib/fixtures.mjs';
import { loadRegistry, saveRegistry, getOrSpawnSpecialist } from '../../lib/registry.mjs';
import { matchRoster } from '../scripts/match_roster.mjs';
import { verifyScout } from '../scripts/verify_scout.mjs';

test('runtime/registry: singleton per id and session reuse (spawns == 1 on rerun)', async () => {
  const repo = await createTempGitRepo('sdd-reg-');
  try {
    // First call: spawns
    const first = await getOrSpawnSpecialist('crawler-bot', { repoRoot: repo.dir });
    assert.equal(first.isNewSpawn, true);
    assert.equal(first.entry.spawns, 1);
    assert.equal(first.entry.activations, 1);

    // Second call for same specialist: must reuse handle without spawning new session
    const second = await getOrSpawnSpecialist('crawler-bot', { repoRoot: repo.dir });
    assert.equal(second.isNewSpawn, false);
    assert.equal(second.handle, first.handle);
    assert.equal(second.entry.spawns, 1); // Spawns remained 1!
    assert.equal(second.entry.activations, 2); // Activations incremented!
  } finally {
    repo.cleanup();
  }
});

test('runtime/match_roster: computes scores and detects roster gap', async () => {
  const repo = await createTempGitRepo('sdd-match-');
  try {
    const crawlerDoc = [
      '# Especialista Crawler',
      '## Escopo e Padrões de Arquivo',
      '- `src/crawler/**`',
      '',
      '## Palavras-Chave de Domínio',
      '`crawler, playwright, scraping`',
      '',
    ].join('\n');

    repo.writeFile('.agent/specialists/specialist-crawler/SPECIALIST.md', crawlerDoc);

    // Match demand matching crawler
    const res = await matchRoster('ajustar o crawler no arquivo `src/crawler/job.ts` usando playwright', { repoRoot: repo.dir });
    assert.equal(res.k, 1);
    assert.equal(res.selected[0].id, 'specialist-crawler');
    assert.equal(res.mode, 'single');
    assert.equal(res.hasRosterGap, false);

    // Match completely unrelated demand -> gap
    const gapRes = await matchRoster('fazer um shader 3d no blender e animação procedural', { repoRoot: repo.dir });
    assert.equal(gapRes.k, 0);
    assert.equal(gapRes.hasRosterGap, true);
  } finally {
    repo.cleanup();
  }
});

test('runtime/verify_scout: validates scout rules and catches ghost anchors', async () => {
  const repo = await createTempGitRepo('sdd-scout-');
  try {
    repo.writeFile('src/crawler/engine.ts', 'line1\nline2\nline3\n');

    const validScout = [
      '---',
      'specialistId: specialist-crawler',
      'specId: 042',
      'complexity: MEDIA',
      'anchors: ["src/crawler/engine.ts:2"]',
      '---',
      'Diagnóstico inicial: O crawler falha na reinicialização.',
      'Recomendação: Injetar retry com backoff exponencial.',
    ].join('\n');

    const checkValid = verifyScout(validScout, { repoRoot: repo.dir });
    assert.equal(checkValid.ok, true);

    // Ghost anchor test (file doesn't exist)
    const ghostScout = [
      '---',
      'specialistId: specialist-crawler',
      'specId: 042',
      'complexity: MEDIA',
      'anchors: ["src/nonexistent.ts:10"]',
      '---',
      'Diagnóstico.',
    ].join('\n');

    const checkGhost = verifyScout(ghostScout, { repoRoot: repo.dir });
    assert.equal(checkGhost.ok, false);
    assert.ok(checkGhost.violations.some((v) => v.includes('Ghost anchor')));
  } finally {
    repo.cleanup();
  }
});
