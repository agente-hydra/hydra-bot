#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getStatusPorcelain } from '../../lib/git.mjs';

/**
 * Triage working tree files into Buckets A, B, C and Shared.
 * @param {string} specId
 * @param {{ repoRoot?: string; include?: string[]; exclude?: string[] }} [options]
 * @returns {Promise<{
 *   status: 'OK' | 'NEEDS_DECISION';
 *   include: string[];
 *   otherSpecs: string[];
 *   orphans: string[];
 *   needsDecision: string[];
 * }>}
 */
export async function triageFiles(specId, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const userInclude = new Set(options.include || []);
  const userExclude = new Set(options.exclude || []);

  const specDir = join(root, 'specs', specId);
  const archivedSpecDir = join(root, 'specs', 'archive', specId);
  const activeCsFile = join(specDir, 'changeset.json');
  const archivedCsFile = join(archivedSpecDir, 'changeset.json');
  const csFile = existsSync(activeCsFile) ? activeCsFile : existsSync(archivedCsFile) ? archivedCsFile : null;

  let currentCs = { owned: [], shared: [] };
  if (csFile && existsSync(csFile)) {
    try {
      currentCs = JSON.parse(readFileSync(csFile, 'utf-8'));
    } catch {
      // ignore
    }
  }

  // Find all other active spec changesets (Bucket B)
  /** @type {Map<string, string>} */
  const otherSpecFiles = new Map();
  const specsParent = join(root, 'specs');
  if (existsSync(specsParent)) {
    const entries = readdirSync(specsParent, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name !== specId && ent.name !== 'archive') {
        const otherCsFile = join(specsParent, ent.name, 'changeset.json');
        if (existsSync(otherCsFile)) {
          try {
            const otherCs = JSON.parse(readFileSync(otherCsFile, 'utf-8'));
            for (const f of otherCs.owned || []) {
              otherSpecFiles.set(f, ent.name);
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  const status = await getStatusPorcelain(root);
  const currentOwned = new Set(currentCs.owned || []);
  const currentShared = new Set(currentCs.shared || []);

  /** @type {string[]} */
  const include = [];
  /** @type {string[]} */
  const otherSpecs = [];
  /** @type {string[]} */
  const orphans = [];
  /** @type {string[]} */
  const needsDecision = [];

  for (const item of status) {
    const p = item.path;
    // Always include the current spec directory itself (active or archived)
    if (p.startsWith(`specs/${specId}/`) || p.startsWith(`specs/archive/${specId}/`)) {
      include.push(p);
      continue;
    }

    if (userExclude.has(p)) {
      continue;
    }

    if (userInclude.has(p)) {
      include.push(p);
      continue;
    }

    if (currentOwned.has(p)) {
      include.push(p);
    } else if (otherSpecFiles.has(p)) {
      otherSpecs.push(p);
    } else if (currentShared.has(p)) {
      needsDecision.push(p);
    } else {
      orphans.push(p);
    }
  }

  const finalStatus = needsDecision.length > 0 ? 'NEEDS_DECISION' : 'OK';

  return {
    status: finalStatus,
    include: Array.from(new Set(include)).sort(),
    otherSpecs: Array.from(new Set(otherSpecs)).sort(),
    orphans: Array.from(new Set(orphans)).sort(),
    needsDecision: Array.from(new Set(needsDecision)).sort(),
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const specId = process.argv[2];
  if (!specId) {
    console.error('Usage: triage.mjs <specId> [--include <path>] [--exclude <path>]');
    process.exit(1);
  }
  const result = await triageFiles(specId);
  console.log(JSON.stringify(result, null, 2));
}
