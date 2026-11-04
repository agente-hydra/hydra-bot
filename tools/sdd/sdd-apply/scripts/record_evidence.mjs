#!/usr/bin/env node
// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { git } from '../../lib/git.mjs';

const execFileAsync = promisify(execFile);

/**
 * Record evidence of task verification.
 * @param {string} specId
 * @param {number | string} taskId
 * @param {string} criterion
 * @param {readonly string[]} command
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<{ exitCode: number; outputTail: string; diffStat: string; evidencePath: string }>}
 */
export async function recordEvidence(specId, taskId, criterion, command, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const evidenceDir = join(root, 'specs', specId, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });

  let exitCode = 0;
  let stdout = '';
  let stderr = '';

  const [bin, ...args] = command;
  try {
    const res = await execFileAsync(bin, args, { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    stdout = res.stdout.toString();
    stderr = res.stderr.toString();
    exitCode = 0;
  } catch (err) {
    const error = /** @type {any} */ (err);
    stdout = error.stdout ? error.stdout.toString() : '';
    stderr = error.stderr ? error.stderr.toString() : error.message;
    exitCode = typeof error.code === 'number' ? error.code : 1;
  }

  const combinedOutput = `${stdout}\n${stderr}`.trim();
  const outputLines = combinedOutput.split('\n');
  const outputTail = outputLines.slice(-30).join('\n');

  // Diffstat
  let diffStat = '';
  try {
    const { stdout: diffOut } = await git(['diff', '--stat'], { cwd: root });
    diffStat = diffOut.trim();
  } catch {
    diffStat = '';
  }

  const taskFileName = `t${String(taskId).replace(/^t/i, '')}.md`;
  const evidencePath = join(evidenceDir, taskFileName);

  const content = [
    `# Evidência — Tarefa ${taskId} (Spec ${specId})`,
    '',
    `- **Data:** ${new Date().toISOString()}`,
    `- **Critério:** ${criterion}`,
    `- **Comando:** \`${command.join(' ')}\``,
    `- **Exit Code:** ${exitCode}`,
    `- **Status:** ${exitCode === 0 ? '✅ SUCESSO' : '⛔ FALHA'}`,
    '',
    '## Saída (Tail)',
    '```',
    outputTail,
    '```',
    '',
    '## DiffStat',
    '```',
    diffStat || 'Sem alterações uncommitted',
    '```',
    '',
  ].join('\n');

  writeFileSync(evidencePath, content, 'utf-8');

  return {
    exitCode,
    outputTail,
    diffStat,
    evidencePath,
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const [specId, taskId, criterion, ...cmd] = process.argv.slice(2);
  if (!specId || !taskId || cmd.length === 0) {
    console.error('Usage: record_evidence.mjs <specId> <taskId> <criterion> <cmd...>');
    process.exit(1);
  }
  const res = await recordEvidence(specId, taskId, criterion, cmd);
  console.log(`Evidence recorded at ${res.evidencePath} (exit ${res.exitCode})`);
  process.exit(res.exitCode);
}
