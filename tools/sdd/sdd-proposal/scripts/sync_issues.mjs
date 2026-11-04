#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scanSecrets } from '../../lib/secrets.mjs';
import { validateSchema } from '../../lib/schema.mjs';

const execFileAsync = promisify(execFile);

/**
 * Execute gh CLI safely with array arguments.
 * @param {readonly string[]} args
 * @param {string} [cwd]
 * @returns {Promise<{ stdout: string; stderr: string; exitCode: number }>}
 */
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
 * Parse tasks and acceptance criteria from spec-plan.md.
 * @param {string} planText
 * @returns {{ task: number | string; title: string; criteria: { text: string; command: string }[] }[]}
 */
export function parseSpecPlan(planText) {
  const lines = planText.split('\n');
  const tasks = [];
  let currentTask = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const taskMatch = line.match(/^-\s*\[([ xX])\]\s*(?:\[([^\]]+)\]\s*)?\*\*(?:Task\s+)?(T\d+|\d+)\s*—\s*([^*]+)\*\*/i);
    if (taskMatch) {
      if (currentTask) tasks.push(currentTask);
      const taskNum = taskMatch[3].replace(/^T/i, '');
      currentTask = {
        task: parseInt(taskNum, 10) || taskMatch[3],
        title: taskMatch[4].trim(),
        criteria: [],
      };
      continue;
    }

    if (currentTask) {
      const critMatch = line.match(/^\s*-\s*\*\*Aceite:\*\*\s*(.+)$/i);
      if (critMatch) {
        currentTask.criteria.push({ text: critMatch[1].trim(), command: '' });
      } else {
        const subCrit = line.match(/^\s*-\s*([A-Z0-9_\-]+)\s*(?:—|:)\s*(.+)$/);
        if (subCrit) {
          currentTask.criteria.push({ text: `${subCrit[1]}: ${subCrit[2].trim()}`, command: '' });
        }
      }
    }
  }
  if (currentTask) tasks.push(currentTask);

  return tasks;
}

/**
 * Synchronize spec tasks to GitHub issues with idempotent markers.
 * @param {string} specId
 * @param {{ repoRoot?: string; forceMarkdownOnly?: boolean }} [options]
 * @returns {Promise<{ mode: 'github' | 'markdown-only'; issues: any[]; specId: string }>}
 */
export async function syncIssues(specId, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const specDir = join(root, 'specs', specId);
  const planPath = join(specDir, 'spec-plan.md');
  const proposalPath = join(specDir, 'proposal.md');

  if (!existsSync(planPath)) {
    throw new Error(`spec-plan.md not found in ${specDir}`);
  }

  const planText = readFileSync(planPath, 'utf-8');
  const propText = existsSync(proposalPath) ? readFileSync(proposalPath, 'utf-8') : '';

  // Secret scanning check
  const secretsInPlan = scanSecrets(planText);
  if (secretsInPlan.hasSecret) {
    throw new Error(`Secret detected in spec-plan.md: ${secretsInPlan.matches.map((m) => m.pattern).join(', ')}`);
  }

  const tasks = parseSpecPlan(planText);
  let isGhAvailable = !options.forceMarkdownOnly;

  if (isGhAvailable) {
    const authCheck = await gh(['auth', 'status'], root);
    if (authCheck.exitCode !== 0) {
      isGhAvailable = false;
    }
  }

  const mode = isGhAvailable ? 'github' : 'markdown-only';
  /** @type {any[]} */
  const issueRecords = [];

  if (mode === 'markdown-only') {
    // Generate local markdown records
    issueRecords.push({
      task: 'epic',
      number: null,
      url: null,
      title: `[Spec ${specId}] Épico de Implementação`,
      state: 'open',
      criteria: [],
    });

    for (const t of tasks) {
      issueRecords.push({
        task: t.task,
        number: null,
        url: null,
        title: `[Spec ${specId} / T${t.task}] ${t.title}`,
        state: 'open',
        criteria: t.criteria.length > 0 ? t.criteria : [{ text: 'Aceite conforme spec-plan', command: '' }],
      });
    }
  } else {
    // GitHub mode: search existing issues for this spec
    const listRes = await gh(['issue', 'list', '--search', `sdd:spec=${specId}`, '--state', 'all', '--json', 'number,title,body'], root);
    const existing = listRes.exitCode === 0 ? JSON.parse(listRes.stdout || '[]') : [];
    const markerMap = new Map();

    for (const item of existing) {
      const match = (item.body || '').match(/<!--\s*sdd:spec=([^\s]+)\s+task=([^\s]+)\s*-->/);
      if (match) {
        markerMap.set(match[2], item);
      }
    }

    // Process tasks
    for (const t of tasks) {
      const taskKey = String(t.task);
      const marker = `<!-- sdd:spec=${specId} task=${taskKey} -->`;
      const issueTitle = `[Spec ${specId} / T${t.task}] ${t.title}`;
      const issueBody = [
        `## Tarefa ${t.task} — Spec ${specId}`,
        '',
        `**Título:** ${t.title}`,
        '',
        '### Critérios de Aceite',
        ...(t.criteria.map((c) => `- [ ] ${c.text}`)),
        '',
        marker,
      ].join('\n');

      let issueNumber = null;
      let issueUrl = null;

      if (markerMap.has(taskKey)) {
        const prev = markerMap.get(taskKey);
        issueNumber = prev.number;
        await gh(['issue', 'edit', String(issueNumber), '--title', issueTitle, '--body', issueBody], root);
      } else {
        const createRes = await gh(['issue', 'create', '--title', issueTitle, '--body', issueBody], root);
        if (createRes.exitCode === 0) {
          const urlMatch = createRes.stdout.trim().match(/\/issues\/(\d+)/);
          if (urlMatch) issueNumber = parseInt(urlMatch[1], 10);
          issueUrl = createRes.stdout.trim();
        }
      }

      issueRecords.push({
        task: t.task,
        number: issueNumber,
        url: issueUrl,
        title: issueTitle,
        state: 'open',
        criteria: t.criteria.length > 0 ? t.criteria : [{ text: 'Aceite conforme spec-plan', command: '' }],
      });
    }

    // Epic issue
    const epicMarker = `<!-- sdd:spec=${specId} task=epic -->`;
    const epicTitle = `[Spec ${specId}] Épico de Implementação`;
    const epicBody = [
      `# Épico — Spec ${specId}`,
      '',
      '## Tarefas',
      ...issueRecords.map((r) => `- [ ] ${r.number ? `#${r.number}` : `Task ${r.task}`}: ${r.title}`),
      '',
      epicMarker,
    ].join('\n');

    let epicNumber = null;
    let epicUrl = null;
    if (markerMap.has('epic')) {
      const prev = markerMap.get('epic');
      epicNumber = prev.number;
      await gh(['issue', 'edit', String(epicNumber), '--title', epicTitle, '--body', epicBody], root);
    } else {
      const createRes = await gh(['issue', 'create', '--title', epicTitle, '--body', epicBody], root);
      if (createRes.exitCode === 0) {
        const urlMatch = createRes.stdout.trim().match(/\/issues\/(\d+)/);
        if (urlMatch) epicNumber = parseInt(urlMatch[1], 10);
        epicUrl = createRes.stdout.trim();
      }
    }

    issueRecords.unshift({
      task: 'epic',
      number: epicNumber,
      url: epicUrl,
      title: epicTitle,
      state: 'open',
      criteria: [],
    });
  }

  // Write issues.json and issues.md
  const result = {
    specId,
    mode,
    issues: issueRecords,
  };

  writeFileSync(join(specDir, 'issues.json'), JSON.stringify(result, null, 2), 'utf-8');

  const mdLines = [
    `# Issues — Spec ${specId} (${mode.toUpperCase()})`,
    '',
    '| Task | Número | Estado | Título |',
    '| :-- | :-- | :-- | :-- |',
    ...issueRecords.map((r) => `| ${r.task} | ${r.number ? `#${r.number}` : '-'} | \`${r.state}\` | ${r.title} |`),
    '',
  ];
  writeFileSync(join(specDir, 'issues.md'), mdLines.join('\n'), 'utf-8');

  return result;
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const specId = process.argv[2];
  if (!specId) {
    console.error('Usage: sync_issues.mjs <specId>');
    process.exit(1);
  }
  const res = await syncIssues(specId);
  console.log(`Synced ${res.issues.length} issues in ${res.mode} mode -> specs/${specId}/issues.json`);
}
