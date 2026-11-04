#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function gh(args, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('gh', args, { cwd, windowsHide: true });
    return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 };
  } catch (err) {
    const error = /** @type {any} */ (err);
    return {
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : error.message,
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

/**
 * Verify evidence and close completed task issues.
 * @param {string} specId
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<{ closedCount: number; remainingCount: number; epicClosed: boolean }>}
 */
export async function closeIssues(specId, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const specDir = join(root, 'specs', specId);
  const issuesFile = join(specDir, 'issues.json');
  const evidenceDir = join(specDir, 'evidence');

  if (!existsSync(issuesFile)) {
    throw new Error(`issues.json not found in ${specDir}`);
  }

  const issuesData = JSON.parse(readFileSync(issuesFile, 'utf-8'));
  const isGh = issuesData.mode === 'github';

  let closedCount = 0;
  let remainingCount = 0;

  for (const issue of issuesData.issues || []) {
    if (issue.task === 'epic') continue;

    const taskKey = String(issue.task).toLowerCase().replace(/^t/, '');
    const evidencePath = join(evidenceDir, `t${taskKey}.md`);
    const altEvidencePath = join(evidenceDir, `${taskKey}.md`);
    const resolvedPath = existsSync(evidencePath) ? evidencePath : existsSync(altEvidencePath) ? altEvidencePath : null;

    let isVerified = false;
    let evidenceSnippet = '';
    if (resolvedPath && existsSync(resolvedPath)) {
      const evText = readFileSync(resolvedPath, 'utf-8');
      if (evText.includes('Exit Code: 0') || evText.includes('SUCESSO')) {
        isVerified = true;
        evidenceSnippet = evText.slice(0, 400);
      }
    }

    if (isVerified) {
      if (issue.state !== 'closed') {
        issue.state = 'closed';
        closedCount++;
        if (isGh && issue.number) {
          const comment = `✅ **Tarefa ${issue.task} Concluída e Verificada com Sucesso.**\n\n\`\`\`\n${evidenceSnippet}\n\`\`\`\n_Verificado no workspace; aguardando \`/sdd-archive\`._`;
          await gh(['issue', 'comment', String(issue.number), '--body', comment], root);
          await gh(['issue', 'close', String(issue.number)], root);
        }
      }
    } else {
      remainingCount++;
      if (isGh && issue.number && issue.state !== 'closed') {
        const comment = `⚠️ **Tentativa de verificação da Tarefa ${issue.task} incompleta.**\nFalta evidência de build/testes com exitCode 0.`;
        await gh(['issue', 'comment', String(issue.number), '--body', comment], root);
      }
    }
  }

  // Check Epic closure
  let epicClosed = false;
  const epicIssue = (issuesData.issues || []).find((i) => i.task === 'epic');
  if (epicIssue && remainingCount === 0 && closedCount > 0) {
    epicIssue.state = 'closed';
    epicClosed = true;
    if (isGh && epicIssue.number) {
      await gh(['issue', 'comment', String(epicIssue.number), '--body', '🎉 **Todas as tarefas da spec foram verificadas e concluídas.**'], root);
      await gh(['issue', 'close', String(epicIssue.number)], root);
    }
  }

  // Save updated issues.json and issues.md
  writeFileSync(issuesFile, JSON.stringify(issuesData, null, 2), 'utf-8');

  const mdLines = [
    `# Issues — Spec ${specId} (${issuesData.mode.toUpperCase()})`,
    '',
    '| Task | Número | Estado | Título |',
    '| :-- | :-- | :-- | :-- |',
    ...issuesData.issues.map((r) => `| ${r.task} | ${r.number ? `#${r.number}` : '-'} | \`${r.state}\` | ${r.title} |`),
    '',
  ];
  writeFileSync(join(specDir, 'issues.md'), mdLines.join('\n'), 'utf-8');

  return { closedCount, remainingCount, epicClosed };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const specId = process.argv[2];
  if (!specId) {
    console.error('Usage: close_issues.mjs <specId>');
    process.exit(1);
  }
  const res = await closeIssues(specId);
  console.log(`Closed ${res.closedCount} issues (${res.remainingCount} remaining). Epic closed: ${res.epicClosed}`);
}
