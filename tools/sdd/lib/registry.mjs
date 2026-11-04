// @ts-check
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * @typedef {{
 *   backend: 'agy-subagent' | 'alethe-session' | 'orca-worker';
 *   handle: string;
 *   lastUsed: string;
 *   memoryHash: string;
 *   activations: number;
 *   spawns: number;
 *   status: 'alive' | 'stopped' | 'missing';
 * }} RegistryEntry
 */

/**
 * Load or initialize local registry.
 * @param {string} [repoRoot]
 * @returns {Record<string, RegistryEntry>}
 */
export function loadRegistry(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const regPath = join(root, '.agent/specialists/registry.local.json');
  if (existsSync(regPath)) {
    try {
      return JSON.parse(readFileSync(regPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Save local registry to .agent/specialists/registry.local.json.
 * @param {Record<string, RegistryEntry>} registry
 * @param {string} [repoRoot]
 */
export function saveRegistry(registry, repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const regDir = join(root, '.agent/specialists');
  mkdirSync(regDir, { recursive: true });
  writeFileSync(join(regDir, 'registry.local.json'), JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Get or spawn a specialist session ensuring singleton per specialist ID.
 * @param {string} specialistId
 * @param {{
 *   backend?: 'agy-subagent' | 'alethe-session' | 'orca-worker';
 *   memoryHash?: string;
 *   repoRoot?: string;
 *   spawnFn?: (id: string) => Promise<string>;
 * }} [options]
 * @returns {Promise<{ handle: string; isNewSpawn: boolean; entry: RegistryEntry }>}
 */
export async function getOrSpawnSpecialist(specialistId, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const registry = loadRegistry(root);
  const backend = options.backend || 'alethe-session';
  const memHash = options.memoryHash || 'initial';

  let entry = registry[specialistId];
  let isNewSpawn = false;

  if (entry && entry.status === 'alive' && entry.handle) {
    // Reuse existing alive session without spawning a new one
    entry.activations = (entry.activations || 0) + 1;
    entry.lastUsed = new Date().toISOString();
    saveRegistry(registry, root);
    return { handle: entry.handle, isNewSpawn: false, entry };
  }

  // Not alive or not exists: spawn once
  isNewSpawn = true;
  let handle = `session-${specialistId}-${Date.now()}`;
  if (options.spawnFn) {
    handle = await options.spawnFn(specialistId);
  }

  entry = {
    backend,
    handle,
    lastUsed: new Date().toISOString(),
    memoryHash: memHash,
    activations: (entry?.activations || 0) + 1,
    spawns: (entry?.spawns || 0) + 1,
    status: 'alive',
  };

  registry[specialistId] = entry;
  saveRegistry(registry, root);

  return { handle, isNewSpawn: true, entry };
}
