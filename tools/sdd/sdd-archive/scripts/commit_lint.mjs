#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { git } from '../../lib/git.mjs';
import { scanSecrets } from '../../lib/secrets.mjs';

/**
 * Compute Sørensen–Dice coefficient over character bigrams.
 * @param {string} str1
 * @param {string} str2
 * @returns {number} 0.0 to 1.0
 */
export function diceSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const getBigrams = (str) => {
    const bg = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const pair = str.slice(i, i + 2);
      bg.set(pair, (bg.get(pair) || 0) + 1);
    }
    return bg;
  };

  const bg1 = getBigrams(s1);
  const bg2 = getBigrams(s2);

  let intersection = 0;
  for (const [pair, count] of bg1.entries()) {
    if (bg2.has(pair)) {
      intersection += Math.min(count, bg2.get(pair));
    }
  }

  const total = (s1.length - 1) + (s2.length - 1);
  return (2.0 * intersection) / total;
}

const STOPWORDS = new Set([
  'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma', 'os', 'no',
  'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele', 'das', 'à', 'seu', 'sua',
  'ou', 'quando', 'muito', 'nos', 'já', 'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso',
  'the', 'and', 'to', 'of', 'in', 'is', 'for', 'on', 'with', 'at', 'by', 'from', 'an', 'as',
]);

/**
 * Lint commit message, staged files, and changeset according to R1..R8.
 * @param {string} commitMessage
 * @param {string[]} stagedPaths
 * @param {any} changeset
 * @param {{ repoRoot?: string; isBatch?: boolean; specTitle?: string }} [options]
 * @returns {Promise<{ ok: boolean; violations: { rule: string; detail: string }[] }>}
 */
export async function commitLint(commitMessage, stagedPaths, changeset, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const isBatch = !!options.isBatch;
  /** @type {{ rule: string; detail: string }[]} */
  const violations = [];

  const lines = commitMessage.split('\n');
  const subject = lines[0].trim();
  const body = lines.slice(1).join('\n');

  // Rule R1: Format ^(feat|fix|docs|refactor|test|chore)\(<id>\): .{10,72}$
  const r1Regex = isBatch
    ? /^chore:\s*batch\s+deploy\s+specs\s+.{5,72}$/i
    : /^(feat|fix|docs|refactor|test|chore)\(([a-zA-Z0-9_\-]+)\):\s*(.{10,72})$/;

  const r1Match = subject.match(r1Regex);
  if (!r1Match) {
    violations.push({
      rule: 'R1',
      detail: `Subject does not match required format: "${subject}" (must be "type(<id>): summary" between 10-72 chars)`,
    });
  }

  // Rule R2: Scope must match spec ID
  if (!isBatch && r1Match && changeset?.specId) {
    const scope = r1Match[2];
    if (scope !== changeset.specId && !changeset.specId.startsWith(scope)) {
      violations.push({
        rule: 'R2',
        detail: `Scope "${scope}" does not match changeset specId "${changeset.specId}"`,
      });
    }
  }

  // Rule R3: Uniqueness against last 200 commits (Dice <= 0.85)
  try {
    const { stdout, exitCode } = await git(['log', '-n', '200', '--format=%s'], { cwd: root });
    if (exitCode === 0) {
      const pastSubjects = stdout.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
      for (const past of pastSubjects) {
        if (past === subject) {
          violations.push({
            rule: 'R3',
            detail: `Duplicate commit subject! Exactly matches recent commit: "${past}"`,
          });
          break;
        }
        const sim = diceSimilarity(past, subject);
        if (sim > 0.85) {
          violations.push({
            rule: 'R3',
            detail: `Commit subject too similar to past commit (${(sim * 100).toFixed(0)}% match): "${past}"`,
          });
          break;
        }
      }
    }
  } catch {
    // Ignore git log errors in fresh repo
  }

  // Rule R4: Subject relevance to spec title (>= 2 terms)
  if (options.specTitle && !isBatch) {
    const titleWords = options.specTitle
      .toLowerCase()
      .split(/[^\w\dáéíóúãõç]+/i)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

    const subjectWords = new Set(
      subject
        .toLowerCase()
        .split(/[^\w\dáéíóúãõç]+/i)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    );

    let hits = 0;
    for (const w of titleWords) {
      if (subjectWords.has(w)) hits++;
    }

    if (hits < 1 && titleWords.length > 0) {
      violations.push({
        rule: 'R4',
        detail: `Subject lacks relevance to spec title "${options.specTitle}" (found ${hits} matching keywords, required >= 1)`,
      });
    }
  }

  // Rule R5: Staged files match changeset
  if (changeset && Array.isArray(changeset.owned)) {
    const expectedSet = new Set([...changeset.owned]);
    for (const p of stagedPaths) {
      // allow archive rename or memory paths
      if (p.startsWith('specs/archive/') || p.startsWith('specs/') || p.startsWith('.agent/memory/')) {
        continue;
      }
      if (!expectedSet.has(p)) {
        violations.push({
          rule: 'R5',
          detail: `Staged path "${p}" is not declared in changeset owned files`,
        });
      }
    }
  }

  // Rule R6: Mono-spec — paths in specs/** belong to <= 1 spec
  if (!isBatch) {
    const specPaths = stagedPaths.filter((p) => p.startsWith('specs/'));
    const touchedSpecs = new Set();
    for (const sp of specPaths) {
      const parts = sp.split('/');
      if (parts[1] === 'archive' && parts.length > 2) {
        if (!parts[2].endsWith('.md')) {
          touchedSpecs.add(parts[2]);
        }
      } else if (parts[1] && parts[1] !== 'archive') {
        if (!parts[1].endsWith('.md')) {
          touchedSpecs.add(parts[1]);
        }
      }
    }
    if (touchedSpecs.size > 1) {
      violations.push({
        rule: 'R6',
        detail: `Commit touches multiple specs simultaneously: ${Array.from(touchedSpecs).join(', ')}`,
      });
    }
  }

  // Rule R7: Secret scanning
  const secretCheck = scanSecrets(commitMessage);
  if (secretCheck.hasSecret) {
    violations.push({
      rule: 'R7',
      detail: `Secret detected in commit message! Patterns: ${secretCheck.matches.map((m) => m.pattern).join(', ')}`,
    });
  }

  // Rule R8: Evidence in commit body
  if (!isBatch && !body.includes('Evidência:') && !body.includes('Evidencia:')) {
    violations.push({
      rule: 'R8',
      detail: 'Commit body must contain an "Evidência:" line with verification/build gate proof',
    });
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const msgFile = process.argv[2];
  if (!msgFile) {
    console.error('Usage: commit_lint.mjs <commit_msg_file>');
    process.exit(1);
  }
  const msg = readFileSync(msgFile, 'utf-8');
  const result = await commitLint(msg, [], null);
  if (!result.ok) {
    console.error('COMMIT LINT FAILED:');
    for (const v of result.violations) {
      console.error(`[${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }
  console.log('COMMIT LINT PASSED');
}
