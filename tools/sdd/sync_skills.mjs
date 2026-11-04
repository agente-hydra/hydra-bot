#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const GLOBAL_SKILLS_DIR = process.env.GLOBAL_SKILLS_DIR || 'C:\\Users\\User\\.gemini\\config\\skills';
const SDD_ROOT = resolve(process.cwd(), 'tools/sdd');

const SKILL_DIRS = ['sdd-setup', 'sdd-proposal', 'sdd-apply', 'sdd-archive'];

function sha256(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function listFilesRecursive(dir) {
  /** @type {string[]} */
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'node_modules') continue;
      results.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export async function syncSkills({ check = false, dryRun = false } = {}) {
  let hasDrift = false;
  const report = [];

  for (const skillName of SKILL_DIRS) {
    const srcSkillDir = join(SDD_ROOT, skillName);
    const destSkillDir = join(GLOBAL_SKILLS_DIR, skillName);

    if (!existsSync(srcSkillDir)) continue;

    const srcFiles = listFilesRecursive(srcSkillDir);
    for (const srcFile of srcFiles) {
      const rel = relative(srcSkillDir, srcFile);
      const destFile = join(destSkillDir, rel);

      const srcHash = sha256(srcFile);
      const destHash = sha256(destFile);

      if (srcHash !== destHash) {
        hasDrift = true;
        if (check) {
          report.push({ skillName, rel, status: 'DRIFT', srcHash, destHash });
        } else if (!dryRun) {
          mkdirSync(join(destFile, '..'), { recursive: true });
          writeFileSync(destFile, readFileSync(srcFile));
          report.push({ skillName, rel, status: 'SYNCED', srcHash });
        } else {
          report.push({ skillName, rel, status: 'WOULD_SYNC', srcHash });
        }
      } else {
        report.push({ skillName, rel, status: 'MATCH', srcHash });
      }
    }
  }

  return { ok: !hasDrift || !check, report, hasDrift };
}

// CLI invocation
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const dryRun = args.includes('--dry-run');

  const { ok, report, hasDrift } = await syncSkills({ check: checkOnly, dryRun });
  for (const item of report) {
    if (item.status !== 'MATCH' || args.includes('--verbose')) {
      console.log(`[${item.status}] ${item.skillName}/${item.rel}`);
    }
  }
  if (checkOnly && hasDrift) {
    console.error('ERROR: Skill drift detected between tools/sdd and global skills dir.');
    process.exit(1);
  }
  console.log(checkOnly ? 'Check complete. No drift.' : 'Sync complete.');
}
