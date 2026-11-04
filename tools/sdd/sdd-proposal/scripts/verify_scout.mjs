#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Parse front-matter and verify scout content according to SDD v2 rules.
 * @param {string} scoutContent
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean; violations: string[]; frontMatter: any }}
 */
export function verifyScout(scoutContent, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const violations = [];

  const fmMatch = scoutContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    violations.push('Scout is missing YAML front-matter (delimited by ---)');
    return { ok: false, violations, frontMatter: null };
  }

  const fmText = fmMatch[1];
  const bodyText = fmMatch[2].trim();

  // Simple YAML parsing
  const frontMatter = {};
  const fmLines = fmText.split('\n');
  for (const line of fmLines) {
    const m = line.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.+)$/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        try {
          val = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
        }
      }
      frontMatter[key] = val;
    }
  }

  // Validate required front-matter fields
  if (!frontMatter.specialistId) violations.push('Missing front-matter field: specialistId');
  if (!frontMatter.specId) violations.push('Missing front-matter field: specId');
  if (!frontMatter.complexity) violations.push('Missing front-matter field: complexity');
  if (!Array.isArray(frontMatter.anchors)) violations.push('front-matter anchors must be an array');

  // Validate body max lines (<= 40 lines)
  const bodyLines = bodyText.split('\n').filter((l) => l.trim().length > 0);
  if (bodyLines.length > 40) {
    violations.push(`Scout body exceeds maximum 40 lines (got ${bodyLines.length} lines)`);
  }

  // Validate physical existence of anchors (arquivo:linha)
  for (const anchor of frontMatter.anchors || []) {
    const parts = anchor.split(':');
    if (parts.length < 2) {
      violations.push(`Invalid anchor format "${anchor}", expected "file:line"`);
      continue;
    }
    const filePath = parts[0].trim();
    const lineNum = parseInt(parts[1].trim(), 10);
    const fullPath = join(root, filePath);

    if (!existsSync(fullPath)) {
      violations.push(`Ghost anchor! File does not exist: ${filePath} (in anchor "${anchor}")`);
    } else {
      const fileContent = readFileSync(fullPath, 'utf-8');
      const totalLines = fileContent.split('\n').length;
      if (isNaN(lineNum) || lineNum < 1 || lineNum > totalLines) {
        violations.push(`Anchor line out of bounds: line ${lineNum} in ${filePath} (file has ${totalLines} lines)`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    frontMatter,
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const scoutPath = process.argv[2];
  if (!scoutPath || !existsSync(scoutPath)) {
    console.error('Usage: verify_scout.mjs <scout_file>');
    process.exit(1);
  }
  const content = readFileSync(scoutPath, 'utf-8');
  const res = verifyScout(content);
  if (!res.ok) {
    console.error('SCOUT VERIFICATION FAILED:');
    for (const v of res.violations) console.error(` - ${v}`);
    process.exit(1);
  }
  console.log('SCOUT VERIFIED SUCCESSFULLY');
}
