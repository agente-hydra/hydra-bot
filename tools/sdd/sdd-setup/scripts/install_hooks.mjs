#!/usr/bin/env node
// @ts-check
import { existsSync, copyFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { git } from '../../lib/git.mjs';

/**
 * Install commit-msg hook into .githooks and configure core.hooksPath.
 * @param {string} [repoRoot]
 * @returns {Promise<{ installed: boolean; hooksPath: string }>}
 */
export async function installHooks(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const hooksDir = join(root, '.githooks');
  mkdirSync(hooksDir, { recursive: true });

  const srcHook = resolve(dirname(import.meta.url.replace(/^file:\/\/\/?/, '')), '../hooks/commit-msg');
  const destHook = join(hooksDir, 'commit-msg');

  if (existsSync(srcHook)) {
    copyFileSync(srcHook, destHook);
    try {
      chmodSync(destHook, 0o755);
    } catch {
      // ignore on windows
    }
  }

  // Configure core.hooksPath
  await git(['config', 'core.hooksPath', '.githooks'], { cwd: root });

  return { installed: true, hooksPath: hooksDir };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const res = await installHooks();
  console.log(`Hooks installed to ${res.hooksPath} and core.hooksPath configured.`);
}
