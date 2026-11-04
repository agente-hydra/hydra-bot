#!/usr/bin/env node
// @ts-check
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { git } from '../../lib/git.mjs';

/**
 * Scan all specs in specs/ and specs/archive/, auditing their latest commit scope and hygiene.
 * @param {string} [repoRoot]
 * @returns {Promise<{ auditRows: any[]; multiSpecCommits: { sha: string; specs: string[]; subject: string }[]; report: string }>}
 */
export async function auditCommitLog(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const auditRows = [];

  const dirsToScan = [];
  const activeSpecsDir = join(root, 'specs');
  if (existsSync(activeSpecsDir)) {
    for (const ent of readdirSync(activeSpecsDir, { withFileTypes: true })) {
      if (ent.isDirectory() && ent.name !== 'archive') {
        dirsToScan.push({ relPath: `specs/${ent.name}`, specId: ent.name });
      }
    }
  }

  const archiveSpecsDir = join(root, 'specs/archive');
  if (existsSync(archiveSpecsDir)) {
    for (const ent of readdirSync(archiveSpecsDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        dirsToScan.push({ relPath: `specs/archive/${ent.name}`, specId: ent.name });
      }
    }
  }

  for (const item of dirsToScan) {
    const { stdout, exitCode } = await git(['log', '-1', '--format=%h|%s', '--', item.relPath], { cwd: root });
    if (exitCode === 0 && stdout.trim().length > 0) {
      const [sha, ...subjectParts] = stdout.trim().split('|');
      const subject = subjectParts.join('|');
      const scopeMatch = subject.match(/^[a-zA-Z]+\(([^)]+)\):/);
      const scope = scopeMatch ? scopeMatch[1] : 'none';

      // Extract numeric prefix from specId, e.g. "042-hydra-rede..." -> "042"
      const numPrefix = item.specId.match(/^(\d+)/)?.[1] || item.specId;
      const isDivergent = scope !== item.specId && scope !== numPrefix;

      auditRows.push({
        specId: item.specId,
        path: item.relPath,
        lastCommitSha: sha,
        subject,
        scope,
        isDivergent,
      });
    }
  }

  // Scan recent 200 commits to find multi-spec pollution
  const { stdout: commitLog } = await git(['log', '-n', '200', '--format=COMMIT:%h|%s', '--name-only'], { cwd: root });
  const multiSpecCommits = [];
  const blocks = commitLog.split('COMMIT:').filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const [header, ...files] = lines;
    const [sha, subject] = header.split('|');

    const touchedSpecs = new Set();
    for (const f of files) {
      const m = f.match(/^specs\/(?:archive\/)?([^\/]+)/);
      if (m && m[1] !== 'archive') {
        touchedSpecs.add(m[1]);
      }
    }

    if (touchedSpecs.size > 1) {
      multiSpecCommits.push({
        sha,
        subject: subject || '',
        specs: Array.from(touchedSpecs),
      });
    }
  }

  // Generate Markdown report
  const lines = [
    '# Auditoria de Higiene de Commits em Specs',
    '',
    `- **Data da Análise:** ${new Date().toISOString()}`,
    `- **Specs Analisadas:** ${auditRows.length}`,
    `- **Specs com Escopo Divergente:** ${auditRows.filter((r) => r.isDivergent).length}`,
    `- **Commits que Tocaram Múltiplas Specs Simultaneamente:** ${multiSpecCommits.length}`,
    '',
    '## Commits Contaminados Multi-Spec Detectados',
    '',
    '| SHA | Assunto | Specs Afetadas |',
    '| :-- | :-- | :-- |',
    ...multiSpecCommits.map((c) => `| \`${c.sha}\` | ${c.subject} | ${c.specs.length} specs (${c.specs.slice(0, 3).join(', ')}...) |`),
    '',
    '## Detalhamento por Spec',
    '',
    '| Spec | Último SHA | Escopo | Divergente? | Assunto |',
    '| :-- | :-- | :-- | :-- | :-- |',
    ...auditRows.map((r) => `| \`${r.specId}\` | \`${r.lastCommitSha}\` | \`${r.scope}\` | ${r.isDivergent ? '⚠️ SIM' : '✅ NÃO'} | ${r.subject.slice(0, 50)} |`),
    '',
  ];

  const report = lines.join('\n');
  const outPath = join(root, 'specs/archive/COMMIT_AUDIT.md');
  if (existsSync(join(root, 'specs/archive'))) {
    writeFileSync(outPath, report, 'utf-8');
  }

  return { auditRows, multiSpecCommits, report };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { report, multiSpecCommits, auditRows } = await auditCommitLog();
  console.log(`Audited ${auditRows.length} specs. Found ${multiSpecCommits.length} multi-spec commits.`);
  console.log('Report saved to specs/archive/COMMIT_AUDIT.md');
}
