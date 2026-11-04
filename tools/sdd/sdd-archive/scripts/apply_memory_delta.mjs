#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { writeManagedBlock } from '../../lib/managed-block.mjs';

/**
 * Apply a memory delta to a specialist's dedicated memory file as single-writer.
 * @param {{
 *   specialistId: string;
 *   featureId: string;
 *   date?: string;
 *   context: string;
 *   ruleLearned: string;
 *   risk?: string;
 *   antiPattern?: string;
 *   anchor?: string;
 * }} delta
 * @param {string} [repoRoot]
 * @returns {Promise<string>} updatedFilePath
 */
export async function applyMemoryDelta(delta, repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const memDir = join(root, '.agent/memory/specialists');
  mkdirSync(memDir, { recursive: true });

  const memFile = join(memDir, `${delta.specialistId}.md`);
  let content = '';
  if (existsSync(memFile)) {
    content = readFileSync(memFile, 'utf-8');
  } else {
    content = `# Memória do Especialista — ${delta.specialistId}\n\n<!-- sdd:managed:begin id="lessons" -->\n<!-- sdd:managed:end id="lessons" -->\n`;
  }

  const date = delta.date || new Date().toISOString().slice(0, 10);
  const entry = [
    `## [${date}] — [Feature: ${delta.featureId}]`,
    `- **Contexto:** ${delta.context}`,
    `- **Regra aprendida:** ${delta.ruleLearned}`,
    delta.risk ? `- **Risco identificado:** ${delta.risk}` : null,
    delta.antiPattern ? `- **Não fazer:** ${delta.antiPattern}` : null,
    delta.anchor ? `- **Âncora:** \`${delta.anchor}\`` : null,
    '',
  ].filter(Boolean).join('\n');

  // Append new entry to the file
  const updated = `${content.trimEnd()}\n\n${entry}`;
  writeFileSync(memFile, updated, 'utf-8');
  return memFile;
}
