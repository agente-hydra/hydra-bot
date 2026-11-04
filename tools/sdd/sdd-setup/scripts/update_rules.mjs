#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeManagedBlock } from '../../lib/managed-block.mjs';

const blockContent = [
  '## Especialistas Persistentes do Roster (SDD v2)',
  '- Especialistas persistentes descobertos pelo setup são permitidos para pesquisa, scouts e tarefas delimitadas.',
  '- Concorrência máxima em fan-out: <= 5 especialistas simultâneos.',
  '- O agente líder detém a autoridade única de integração, build gate global e commits.',
  '- Especialistas operam em worktrees isoladas ou devolvem deltas; nunca editam memória compartilhada diretamente.',
].join('\n');

const targets = [
  resolve(process.cwd(), '.agent/rules/ia.md'),
  'C:\\Users\\User\\.gemini\\config\\rules\\ia.md',
];

for (const target of targets) {
  if (existsSync(target)) {
    const content = readFileSync(target, 'utf-8');
    const updated = writeManagedBlock(content, blockContent, 'specialists-governance');
    writeFileSync(target, updated, 'utf-8');
    console.log(`Updated managed block in: ${target}`);
  }
}
