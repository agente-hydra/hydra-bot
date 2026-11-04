// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

/**
 * Resolve git executable path with fallback to mingit if needed.
 * @returns {string}
 */
export function resolveGitBin() {
  if (process.env.GIT_BIN && existsSync(process.env.GIT_BIN)) {
    return process.env.GIT_BIN;
  }
  const mingitUser = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\mingit\\cmd\\git.exe';
  if (existsSync(mingitUser)) {
    return mingitUser;
  }
  const mingitAdmin = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\mingit\\cmd\\git.exe';
  if (existsSync(mingitAdmin)) {
    return mingitAdmin;
  }
  return 'git';
}

/**
 * Execute a git command with argument array (safe against shell injection).
 * @param {readonly string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number }} [options]
 * @returns {Promise<{ stdout: string; stderr: string; exitCode: number }>}
 */
export async function git(args, options = {}) {
  const bin = resolveGitBin();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
      windowsHide: true,
    });
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
 * Get git status --porcelain=v1.
 * @param {string} [cwd]
 * @returns {Promise<{ code: string; path: string; origPath?: string }[]>}
 */
export async function getStatusPorcelain(cwd) {
  const { stdout, exitCode, stderr } = await git(['status', '--porcelain=v1', '-uall'], { cwd });
  if (exitCode !== 0) {
    throw new Error(`git status failed: ${stderr}`);
  }
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const code = line.slice(0, 2);
    const rest = line.slice(3).trim();
    if (rest.includes(' -> ')) {
      const [origPath, destPath] = rest.split(' -> ');
      return { code, path: destPath.replace(/^"|"$/g, ''), origPath: origPath.replace(/^"|"$/g, '') };
    }
    return { code, path: rest.replace(/^"|"$/g, '') };
  });
}

/**
 * List all tracked files in git repository.
 * @param {string} [cwd]
 * @returns {Promise<string[]>}
 */
export async function listTrackedFiles(cwd) {
  const { stdout, exitCode, stderr } = await git(['ls-files'], { cwd });
  if (exitCode !== 0) {
    throw new Error(`git ls-files failed: ${stderr}`);
  }
  return stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/**
 * Get hash-object (blob sha) for a file on disk or string.
 * @param {string} filePathOrContent
 * @param {{ isContent?: boolean; cwd?: string }} [options]
 * @returns {Promise<string>}
 */
export async function hashObject(filePathOrContent, options = {}) {
  const args = ['hash-object'];
  if (options.isContent) {
    args.push('--stdin');
    const bin = resolveGitBin();
    return new Promise((resolve, reject) => {
      const cp = execFile(bin, args, { cwd: options.cwd || process.cwd() }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`git hash-object failed: ${stderr || err.message}`));
        resolve(stdout.trim());
      });
      cp.stdin?.end(filePathOrContent);
    });
  }
  args.push(filePathOrContent);
  const { stdout, exitCode, stderr } = await git(args, { cwd: options.cwd });
  if (exitCode !== 0) {
    throw new Error(`git hash-object failed: ${stderr}`);
  }
  return stdout.trim();
}

/**
 * List active git worktrees across the repo.
 * @param {string} [cwd]
 * @returns {Promise<{ path: string; head: string; branch: string }[]>}
 */
export async function listWorktrees(cwd) {
  const { stdout, exitCode } = await git(['worktree', 'list', '--porcelain'], { cwd });
  if (exitCode !== 0) {
    return [];
  }
  const blocks = stdout.split('\n\n').filter((b) => b.trim().length > 0);
  return blocks.map((block) => {
    const lines = block.split('\n');
    let path = '';
    let head = '';
    let branch = '';
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) head = line.slice(5).trim();
      else if (line.startsWith('branch ')) branch = line.slice(7).trim();
    }
    return { path, head, branch };
  });
}

/**
 * Safe add specific paths to git staging. NEVER accepts '.' or '-A'.
 * @param {readonly string[]} paths
 * @param {string} [cwd]
 * @returns {Promise<void>}
 */
export async function addPaths(paths, cwd) {
  if (!paths || paths.length === 0) return;
  for (const p of paths) {
    if (p === '.' || p === '-A' || p === '--all' || p === '-u' || p === '*') {
      throw new Error(`Forbidden wildcard path in addPaths: "${p}". Only explicit paths are allowed.`);
    }
  }
  const { exitCode, stderr } = await git(['add', '--', ...paths], { cwd });
  if (exitCode !== 0) {
    throw new Error(`git add failed: ${stderr}`);
  }
}

/**
 * Get list of currently staged files.
 * @param {string} [cwd]
 * @returns {Promise<string[]>}
 */
export async function getStagedFiles(cwd) {
  const { stdout, exitCode, stderr } = await git(['diff', '--cached', '--name-only'], { cwd });
  if (exitCode !== 0) {
    throw new Error(`git diff --cached failed: ${stderr}`);
  }
  return stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}
