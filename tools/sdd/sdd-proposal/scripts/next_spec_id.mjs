#!/usr/bin/env node
// @ts-check
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { listWorktrees } from '../../lib/git.mjs';

/**
 * Scan a directory for spec folders with numeric prefix, e.g. "042-foo" -> 42.
 * @param {string} dirPath
 * @returns {number[]}
 */
function scanDirForSpecIds(dirPath) {
  if (!existsSync(dirPath)) return [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const ids = [];
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const match = ent.name.match(/^(\d{3,})/);
      if (match) {
        ids.push(parseInt(match[1], 10));
      }
    }
  }
  return ids;
}

/**
 * Calculate the next spec ID across local workspace and all git worktrees.
 * @param {string} [repoRoot]
 * @returns {Promise<{ nextId: string; nextNum: number; maxFound: number; scannedLocations: string[] }>}
 */
export async function getNextSpecId(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const scannedLocations = [];
  const allIds = [];

  // 1. Scan current repo specs/ and specs/archive/
  const localSpecs = join(root, 'specs');
  if (existsSync(localSpecs)) {
    scannedLocations.push(localSpecs);
    allIds.push(...scanDirForSpecIds(localSpecs));
  }
  const localArchive = join(root, 'specs/archive');
  if (existsSync(localArchive)) {
    scannedLocations.push(localArchive);
    allIds.push(...scanDirForSpecIds(localArchive));
  }

  // 2. Scan all known worktrees
  try {
    const worktrees = await listWorktrees(root);
    for (const wt of worktrees) {
      if (wt.path && resolve(wt.path) !== root) {
        const wtSpecs = join(wt.path, 'specs');
        if (existsSync(wtSpecs)) {
          scannedLocations.push(wtSpecs);
          allIds.push(...scanDirForSpecIds(wtSpecs));
        }
        const wtArchive = join(wt.path, 'specs/archive');
        if (existsSync(wtArchive)) {
          scannedLocations.push(wtArchive);
          allIds.push(...scanDirForSpecIds(wtArchive));
        }
      }
    }
  } catch {
    // Ignore worktree listing failure
  }

  const maxFound = allIds.length > 0 ? Math.max(...allIds) : 0;
  const nextNum = maxFound + 1;
  const nextId = String(nextNum).padStart(3, '0');

  return { nextId, nextNum, maxFound, scannedLocations };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { nextId, maxFound, scannedLocations } = await getNextSpecId();
  console.log(`Next Spec ID: ${nextId} (max found: ${maxFound} across ${scannedLocations.length} locations)`);
}
