#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getStatusPorcelain, hashObject } from '../../lib/git.mjs';
import { validateSchema } from '../../lib/schema.mjs';

/**
 * Record baseline blobs for all currently dirty or untracked files.
 * @param {string} specId
 * @param {string} [repoRoot]
 * @returns {Promise<string>} baselineFilePath
 */
export async function beginChangeset(specId, repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const specDir = join(root, 'specs', specId);
  mkdirSync(specDir, { recursive: true });

  const status = await getStatusPorcelain(root);
  /** @type {Record<string, string>} */
  const baseline = {};

  for (const item of status) {
    const fullPath = join(root, item.path);
    if (existsSync(fullPath)) {
      try {
        const hash = await hashObject(fullPath, { cwd: root });
        baseline[item.path] = hash;
      } catch {
        baseline[item.path] = 'untracked';
      }
    } else {
      baseline[item.path] = 'deleted';
    }
  }

  const baselinePath = join(specDir, '.baseline.json');
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2), 'utf-8');
  return baselinePath;
}

/**
 * Compare current status with baseline and write changeset.json.
 * @param {string} specId
 * @param {string} [repoRoot]
 * @returns {Promise<any>} changeset
 */
export async function endChangeset(specId, repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const specDir = join(root, 'specs', specId);
  const baselinePath = join(specDir, '.baseline.json');

  /** @type {Record<string, string>} */
  let baseline = {};
  if (existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    } catch {
      baseline = {};
    }
  }

  const currentStatus = await getStatusPorcelain(root);
  /** @type {string[]} */
  const owned = [];
  /** @type {string[]} */
  const shared = [];
  /** @type {string[]} */
  const baselineDirty = Object.keys(baseline);

  for (const item of currentStatus) {
    const fullPath = join(root, item.path);
    if (!(item.path in baseline)) {
      // Path was clean when baseline was taken -> 100% owned by this spec
      owned.push(item.path);
    } else {
      // Path was already dirty at baseline
      if (existsSync(fullPath)) {
        try {
          const currentHash = await hashObject(fullPath, { cwd: root });
          if (currentHash !== baseline[item.path]) {
            // Changed during this spec
            shared.push(item.path);
          }
        } catch {
          shared.push(item.path);
        }
      }
    }
  }

  const changeset = {
    specId,
    owned: Array.from(new Set(owned)).sort(),
    shared: Array.from(new Set(shared)).sort(),
    baselineDirty: Array.from(new Set(baselineDirty)).sort(),
  };

  const changesetPath = join(specDir, 'changeset.json');
  writeFileSync(changesetPath, JSON.stringify(changeset, null, 2), 'utf-8');
  return changeset;
}

/**
 * Reconstruct a changeset for legacy specs by reading files referenced in their docs.
 * @param {string} specId
 * @param {string} [repoRoot]
 * @returns {Promise<any>}
 */
export async function reconstructChangeset(specId, repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const specDir = join(root, 'specs', specId);
  if (!existsSync(specDir)) {
    throw new Error(`Spec directory not found: ${specDir}`);
  }

  const docFiles = ['proposal.md', 'design.md', 'spec-plan.md'];
  /** @type {Set<string>} */
  const mentionedPaths = new Set();

  for (const doc of docFiles) {
    const p = join(specDir, doc);
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      const matches = content.matchAll(/(?:`|")([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)(?:`|")/g);
      for (const m of matches) {
        const candidate = m[1].replace(/^\.\//, '');
        if (existsSync(join(root, candidate)) && !candidate.startsWith('node_modules/')) {
          mentionedPaths.add(candidate);
        }
      }
    }
  }

  const status = await getStatusPorcelain(root);
  /** @type {string[]} */
  const owned = [];
  /** @type {string[]} */
  const shared = [];

  for (const item of status) {
    if (item.path.startsWith(`specs/${specId}/`)) {
      owned.push(item.path);
    } else if (mentionedPaths.has(item.path)) {
      owned.push(item.path);
    }
  }

  const changeset = {
    specId,
    owned: Array.from(new Set(owned)).sort(),
    shared: [],
    baselineDirty: [],
  };

  const changesetPath = join(specDir, 'changeset.json');
  writeFileSync(changesetPath, JSON.stringify(changeset, null, 2), 'utf-8');
  return changeset;
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const cmd = process.argv[2];
  const specId = process.argv[3];
  if (!specId) {
    console.error('Usage: changeset.mjs <begin|end|--reconstruct> <specId>');
    process.exit(1);
  }
  if (cmd === 'begin') {
    const path = await beginChangeset(specId);
    console.log(`Changeset baseline created at ${path}`);
  } else if (cmd === 'end') {
    const cs = await endChangeset(specId);
    console.log(`Changeset completed for ${specId}: ${cs.owned.length} owned, ${cs.shared.length} shared`);
  } else if (cmd === '--reconstruct') {
    const cs = await reconstructChangeset(specId);
    console.log(`Changeset reconstructed for ${specId}: ${cs.owned.length} owned`);
  }
}
