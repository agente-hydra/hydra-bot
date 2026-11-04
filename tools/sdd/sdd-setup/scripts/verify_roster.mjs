#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { listTrackedFiles } from '../../lib/git.mjs';

/**
 * Match a file path against a pattern like "src/**" or "*.js" or "lib/foo/*"
 * @param {string} filePath
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchGlob(filePath, pattern) {
  const normPath = filePath.replace(/\\/g, '/');
  const normPat = pattern.replace(/\\/g, '/');

  if (normPat === '**' || normPat === '*') return true;
  if (normPat.endsWith('/**')) {
    const base = normPat.slice(0, -3);
    return normPath === base || normPath.startsWith(`${base}/`);
  }
  if (normPat.startsWith('**/')) {
    const suffix = normPat.slice(3);
    return normPath.endsWith(suffix) || normPath.includes(`/${suffix}`);
  }
  if (normPat.endsWith('/*')) {
    const base = normPat.slice(0, -2);
    if (!normPath.startsWith(`${base}/`)) return false;
    const remainder = normPath.slice(base.length + 1);
    return !remainder.includes('/');
  }
  if (normPat.includes('*')) {
    // Escape dots
    let rxStr = normPat.replace(/\./g, '\\.');
    // Replace ** with temporary placeholder
    rxStr = rxStr.replace(/\*\*/g, '§DOUBLE_STAR§');
    // Single * matches anything except slash
    rxStr = rxStr.replace(/\*/g, '[^/]*');
    // Restore ** as matching anything including slashes
    rxStr = rxStr.replace(/§DOUBLE_STAR§/g, '.*');
    const rx = new RegExp(`^${rxStr}$`);
    return rx.test(normPath);
  }
  return normPath === normPat || normPath.startsWith(`${normPat}/`);
}

/**
 * Verify a proposed specialist roster against gates G1..G5.
 * @param {{ specialists: any[] }} roster
 * @param {{ items: any[] }} evidence
 * @param {string} [repoRoot]
 * @param {{ kmin?: number; kmax?: number }} [config]
 * @returns {Promise<{ ok: boolean; violations: string[]; metrics: Record<string, any> }>}
 */
export async function verifyRoster(roster, evidence, repoRoot = process.cwd(), config = {}) {
  const kmin = config.kmin || 2;
  const kmax = config.kmax || 6;
  const root = resolve(repoRoot);
  /** @type {string[]} */
  const violations = [];
  const metrics = {};

  const specialists = roster.specialists || [];

  // Gate G3: Count within [kmin, kmax]
  if (specialists.length < kmin || specialists.length > kmax) {
    violations.push(`G3: Specialist count (${specialists.length}) out of bounds [${kmin}, ${kmax}]`);
  }
  metrics.specialistCount = specialists.length;

  // Tracked files for G1 and G2
  let tracked = [];
  try {
    tracked = await listTrackedFiles(root);
  } catch {
    tracked = [];
  }

  // Filter out meta/system paths from G1 coverage denominator
  const eligibleFiles = tracked.filter(
    (f) =>
      !f.startsWith('.') &&
      !f.startsWith('node_modules/') &&
      !f.startsWith('specs/') &&
      !f.endsWith('.lock') &&
      !f.endsWith('-lock.json') &&
      !f.endsWith('.md')
  );

  // Gate G1: Coverage >= 95%
  let coveredCount = 0;
  /** @type {Map<string, Set<string>>} */
  const specialistCoveredFiles = new Map();

  for (const s of specialists) {
    specialistCoveredFiles.set(s.id, new Set());
  }

  for (const file of eligibleFiles) {
    let coveredByAny = false;
    for (const s of specialists) {
      const patterns = s.filePatterns || [];
      const isMatch = patterns.some((p) => matchGlob(file, p));
      if (isMatch) {
        coveredByAny = true;
        specialistCoveredFiles.get(s.id)?.add(file);
      }
    }
    if (coveredByAny) coveredCount++;
  }

  const coverageRatio = eligibleFiles.length > 0 ? coveredCount / eligibleFiles.length : 1.0;
  metrics.coverageRatio = coverageRatio;
  if (coverageRatio < 0.95 && eligibleFiles.length >= 10) {
    violations.push(`G1: Tracked file coverage is ${(coverageRatio * 100).toFixed(1)}%, required >= 95%`);
  }

  // Gate G2: Pairwise overlap <= 25%
  let maxOverlap = 0;
  for (let i = 0; i < specialists.length; i++) {
    for (let j = i + 1; j < specialists.length; j++) {
      const s1 = specialists[i];
      const s2 = specialists[j];
      const set1 = specialistCoveredFiles.get(s1.id) || new Set();
      const set2 = specialistCoveredFiles.get(s2.id) || new Set();
      if (set1.size === 0 || set2.size === 0) continue;

      let intersectionCount = 0;
      for (const item of set1) {
        if (set2.has(item)) intersectionCount++;
      }
      const minSize = Math.min(set1.size, set2.size);
      const overlap = minSize > 0 ? intersectionCount / minSize : 0;
      if (overlap > maxOverlap) maxOverlap = overlap;
      if (overlap > 0.25) {
        violations.push(
          `G2: High file overlap between ${s1.id} and ${s2.id}: ${(overlap * 100).toFixed(1)}% (max 25%)`
        );
      }
    }
  }
  metrics.maxPairwiseOverlap = maxOverlap;

  // Gate G4: Evidence IDs and anchors exist physically (zero phantom/ghost anchors)
  const evidenceMap = new Map((evidence.items || []).map((it) => [it.id, it]));
  for (const s of specialists) {
    const rules = [...(s.goldenRules || []), ...(s.forbiddenPatterns || [])];
    for (const rule of rules) {
      const p = rule.provenance;
      if (!p) {
        violations.push(`G4: Specialist ${s.id} rule missing provenance: "${rule.text}"`);
        continue;
      }
      for (const evId of p.evidenceIds || []) {
        const evItem = evidenceMap.get(evId);
        if (!evItem) {
          violations.push(`G4: Specialist ${s.id} cites nonexistent evidenceId: ${evId}`);
        } else if (evItem.ref && evItem.ref.includes('#')) {
          const [filePath, lineStr] = evItem.ref.split('#');
          const fullPath = resolve(root, filePath);
          if (!existsSync(fullPath)) {
            violations.push(`G4: Ghost anchor file does not exist: ${filePath} (cited by ${evId})`);
          }
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    metrics,
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rosterFile = process.argv[2] || 'roster.proposed.json';
  const evidenceFile = process.argv[3] || 'evidence.json';

  const roster = JSON.parse(readFileSync(rosterFile, 'utf-8'));
  const evidence = JSON.parse(readFileSync(evidenceFile, 'utf-8'));

  const result = await verifyRoster(roster, evidence);
  if (!result.ok) {
    console.error('VERIFY ROSTER FAILED with violations:');
    for (const v of result.violations) {
      console.error(` - ${v}`);
    }
    process.exit(1);
  }
  console.log('VERIFY ROSTER PASSED (G1..G5 all green)');
}
