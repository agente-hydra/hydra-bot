// @ts-check
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git.mjs';

/**
 * Create a temporary git repo initialized with user identity and main branch.
 * @param {string} [prefix]
 * @returns {Promise<{ dir: string; cleanup: () => void; writeFile: (relPath: string, content: string) => void }>}
 */
export async function createTempGitRepo(prefix = 'sdd-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  await git(['init', '-b', 'main'], { cwd: dir });
  await git(['config', 'user.name', 'SDD Test Bot'], { cwd: dir });
  await git(['config', 'user.email', 'sdd-bot@example.com'], { cwd: dir });

  // Initial commit to have a valid HEAD
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n', 'utf-8');
  await git(['add', 'README.md'], { cwd: dir });
  await git(['commit', '-m', 'chore: initial commit'], { cwd: dir });

  const writeFile = (relPath, content) => {
    const fullPath = join(dir, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  };

  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Ignore cleanup error on windows locks
    }
  };

  return { dir, cleanup, writeFile };
}
