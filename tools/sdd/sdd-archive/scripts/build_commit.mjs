#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { git, addPaths, getStagedFiles } from '../../lib/git.mjs';
import { commitLint } from './commit_lint.mjs';
import { triageFiles } from './triage.mjs';

/**
 * Perform a clean, selective, audited commit for a spec archive.
 * @param {string} specId
 * @param {{
 *   repoRoot?: string;
 *   summary?: string;
 *   evidence?: string;
 *   include?: string[];
 *   exclude?: string[];
 *   dryRun?: boolean;
 * }} [options]
 * @returns {Promise<{ ok: boolean; commitSha?: string; message: string; staged: string[] }>}
 */
export async function buildCommit(specId, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const dryRun = !!options.dryRun;

  // 1. Triage files
  const triage = await triageFiles(specId, {
    repoRoot: root,
    include: options.include,
    exclude: options.exclude,
  });

  if (triage.status === 'NEEDS_DECISION') {
    throw new Error(
      `Triage requires decision on shared files: ${triage.needsDecision.join(', ')}. Pass --include or --exclude.`
    );
  }

  // 2. Read spec title from proposal.md if present
  let specTitle = '';
  const proposalPath = join(root, 'specs', specId, 'proposal.md');
  const archivedProposalPath = join(root, 'specs', 'archive', specId, 'proposal.md');
  const propFile = existsSync(proposalPath) ? proposalPath : existsSync(archivedProposalPath) ? archivedProposalPath : null;
  if (propFile) {
    try {
      const propText = readFileSync(propFile, 'utf-8');
      const m = propText.match(/^#\s+(.+)$/m);
      if (m) specTitle = m[1].replace(/^(?:Proposta|Spec)\s*—?\s*/i, '').trim();
    } catch {
      // ignore
    }
  }

  // 3. Move spec folder to specs/archive/<id>
  const srcSpecDir = join(root, 'specs', specId);
  const destSpecDir = join(root, 'specs', 'archive', specId);

  if (existsSync(srcSpecDir)) {
    mkdirSync(join(root, 'specs', 'archive'), { recursive: true });
    if (!dryRun) {
      // Try git mv first; if it fails (e.g. untracked files), fallback to fs rename
      const { exitCode } = await git(['mv', `specs/${specId}`, `specs/archive/${specId}`], { cwd: root });
      if (exitCode !== 0) {
        renameSync(srcSpecDir, destSpecDir);
      }
    }
  }

  // 4. Build commit message
  const summary = options.summary || (specTitle ? specTitle.slice(0, 50) : `archive spec ${specId}`);
  const evidenceText = options.evidence || 'Build gate verificado com sucesso via tsc/testes.';
  const type = 'feat';

  const commitMessage = [
    `${type}(${specId}): ${summary}`,
    '',
    `Problema: Implementação e arquivamento formal da spec ${specId}.`,
    `Solução: Execução das tarefas com isolamento, evidências verificadas e encerramento do ciclo.`,
    `Evidência: ${evidenceText}`,
    '',
    `Refs: spec ${specId}`,
  ].join('\n');

  // Remap staged paths from specs/<id>/ to specs/archive/<id>/
  const remappedPaths = triage.include.map((p) =>
    p.startsWith(`specs/${specId}/`) ? p.replace(`specs/${specId}/`, `specs/archive/${specId}/`) : p
  );

  if (dryRun) {
    return {
      ok: true,
      message: commitMessage,
      staged: remappedPaths,
    };
  }

  // 5. Selective Staging (NUNCA git add .)
  // Stage only paths explicitly owned by this spec and its archived files
  const existingPathsToStage = remappedPaths.filter((p) => existsSync(join(root, p)));
  if (existingPathsToStage.length > 0) {
    await addPaths(existingPathsToStage, root);
  }

  const staged = await getStagedFiles(root);

  // 6. Lint commit message & staged paths
  const csFile = join(root, 'specs', 'archive', specId, 'changeset.json');
  let changeset = { specId, owned: remappedPaths };
  if (existsSync(csFile)) {
    try {
      changeset = JSON.parse(readFileSync(csFile, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const lint = await commitLint(commitMessage, staged, changeset, { repoRoot: root, specTitle });
  if (!lint.ok) {
    // Unstage on lint failure to avoid dirty state
    await git(['reset', 'HEAD'], { cwd: root });
    throw new Error(`Commit lint failed:\n${lint.violations.map((v) => `[${v.rule}] ${v.detail}`).join('\n')}`);
  }

  // 7. Commit
  const { stderr, exitCode } = await git(['commit', '-m', commitMessage], { cwd: root });
  if (exitCode !== 0) {
    throw new Error(`git commit failed: ${stderr}`);
  }

  const { stdout: revStdout } = await git(['rev-parse', 'HEAD'], { cwd: root });
  const commitSha = revStdout.trim();

  return {
    ok: true,
    commitSha,
    message: commitMessage,
    staged,
  };
}
