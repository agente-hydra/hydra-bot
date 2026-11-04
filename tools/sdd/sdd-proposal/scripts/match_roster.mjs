#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { matchGlob } from '../../sdd-setup/scripts/verify_roster.mjs';

/**
 * Match a demand/prompt against active specialist roster.
 * @param {string} demandText
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<{
 *   selected: { id: string; score: number; kwScore: number; pathScore: number; memScore: number }[];
 *   k: number;
 *   mode: 'solo' | 'single' | 'fan-out';
 *   hasRosterGap: boolean;
 * }>}
 */
export async function matchRoster(demandText, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const specialistsDir = join(root, '.agent/specialists');
  const memoryDir = join(root, '.agent/memory/specialists');

  if (!existsSync(specialistsDir)) {
    return { selected: [], k: 0, mode: 'solo', hasRosterGap: true };
  }

  // Find all specialists with SPECIALIST.md
  const specialistDirs = readdirSync(specialistsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  // Extract quoted or path-like candidates from demand
  const pathMatches = demandText.matchAll(/(?:`|")([a-zA-Z0-9_\-\.\/]+)(?:`|")/g);
  const mentionedPaths = Array.from(pathMatches).map((m) => m[1]);

  const normDemand = demandText.toLowerCase();

  /** @type {{ id: string; score: number; kwScore: number; pathScore: number; memScore: number }[]} */
  const scores = [];

  for (const sId of specialistDirs) {
    const specDocPath = join(specialistsDir, sId, 'SPECIALIST.md');
    if (!existsSync(specDocPath)) continue;

    const docText = readFileSync(specDocPath, 'utf-8');

    // 1. Extract keywords
    let keywords = [];
    const kwMatch = docText.match(/## Palavras-Chave de Domínio\s*\n\s*`([^`]+)`/);
    if (kwMatch) {
      keywords = kwMatch[1].split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    }

    // 2. Extract file patterns
    const patterns = [];
    const patLines = docText.split('\n');
    let inPatSection = false;
    for (const line of patLines) {
      if (line.startsWith('## Escopo e Padrões')) {
        inPatSection = true;
        continue;
      }
      if (inPatSection && line.startsWith('## ')) break;
      if (inPatSection) {
        const m = line.match(/^-\s*`([^`]+)`/);
        if (m) patterns.push(m[1]);
      }
    }

    // Calculate kwScore
    let kwHits = 0;
    for (const kw of keywords) {
      if (normDemand.includes(kw)) kwHits++;
    }
    const kwScore = keywords.length > 0 ? Math.min(1.0, kwHits / Math.min(keywords.length, 3)) : 0;

    // Calculate pathScore
    let pathHits = 0;
    for (const mp of mentionedPaths) {
      if (patterns.some((pat) => matchGlob(mp, pat))) {
        pathHits++;
      }
    }
    const pathScore = mentionedPaths.length > 0 ? pathHits / mentionedPaths.length : 0;

    // Calculate memScore
    let memScore = 0;
    const memPath = join(memoryDir, `${sId}.md`);
    if (existsSync(memPath)) {
      const memContent = readFileSync(memPath, 'utf-8').toLowerCase();
      let memHits = 0;
      for (const kw of keywords) {
        if (memContent.includes(kw) && normDemand.includes(kw)) memHits++;
      }
      memScore = keywords.length > 0 ? Math.min(1.0, memHits / 2) : 0;
    }

    // Total composite score
    const totalScore = 0.45 * kwScore + 0.35 * pathScore + 0.2 * memScore;
    if (totalScore >= 0.25) {
      scores.push({ id: sId, score: totalScore, kwScore, pathScore, memScore });
    }
  }

  // Sort descending by score and clamp to max 5
  scores.sort((a, b) => b.score - a.score);
  const selected = scores.slice(0, 5);
  const k = selected.length;

  let mode = 'solo';
  if (k === 1) mode = 'single';
  else if (k >= 2) mode = 'fan-out';

  return {
    selected,
    k,
    mode: /** @type {'solo' | 'single' | 'fan-out'} */ (mode),
    hasRosterGap: k === 0,
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const demand = process.argv[2] || '';
  const result = await matchRoster(demand);
  console.log(JSON.stringify(result, null, 2));
}
