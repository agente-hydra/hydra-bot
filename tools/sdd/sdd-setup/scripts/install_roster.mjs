#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { writeManagedBlock } from '../../lib/managed-block.mjs';
import { validateSchema } from '../../lib/schema.mjs';

/**
 * Install or upgrade the specialist roster idempotently.
 * @param {{ specialists: any[] }} roster
 * @param {{ repoRoot?: string; items: any[] }} evidence
 * @param {{ plan?: boolean; repoRoot?: string }} [options]
 * @returns {Promise<{ mode: string; confidence: string; report: string; actions: string[] }>}
 */
export async function installRoster(roster, evidence, options = {}) {
  const root = resolve(options.repoRoot || process.cwd());
  const planOnly = !!options.plan;
  /** @type {string[]} */
  const actions = [];

  const specialistsDir = join(root, '.agent/specialists');
  const memoryDir = join(root, '.agent/memory/specialists');
  const lockFile = join(specialistsDir, 'roster.lock.json');

  // Compute evidence hash
  const evidenceStr = JSON.stringify(evidence.items || []);
  const evidenceHash = createHash('sha256').update(evidenceStr).digest('hex');

  // Determine mode
  let mode = 'first-run';
  let prevLock = null;
  if (existsSync(lockFile)) {
    try {
      prevLock = JSON.parse(readFileSync(lockFile, 'utf-8'));
      if (prevLock.evidenceHash === evidenceHash) {
        mode = 'noop';
      } else {
        mode = 'upgrade';
      }
    } catch {
      mode = 'upgrade';
    }
  }

  actions.push(`Determined setup mode: ${mode} (hash: ${evidenceHash.slice(0, 10)})`);

  if (mode === 'noop' && !planOnly) {
    return {
      mode,
      confidence: prevLock?.confidence || 'high',
      report: 'No changes detected. Roster is up to date (noop).',
      actions,
    };
  }

  const confidence = (roster.specialists && roster.specialists.length >= 2) ? 'high' : 'medium';

  // 1. Process each specialist
  for (const s of roster.specialists || []) {
    const sDir = join(specialistsDir, s.id);
    const specFile = join(sDir, 'SPECIALIST.md');
    const memFile = join(memoryDir, `${s.id}.md`);

    // Managed inner content
    const managedContent = [
      `# Especialista: ${s.name}`,
      `**ID:** \`${s.id}\` | **Versão:** ${s.version || 1}`,
      `**Papel:** ${s.role}`,
      '',
      '## Escopo e Padrões de Arquivo',
      ...(s.filePatterns || []).map((p) => `- \`${p}\``),
      '',
      '## Palavras-Chave de Domínio',
      `\`${(s.domainKeywords || []).join(', ')}\``,
      '',
      '## Regras de Ouro',
      ...(s.goldenRules || []).map((r) => `- **${r.text}** (origem: ${r.provenance?.origin || 'setup'})`),
      '',
      '## Padrões Proibidos',
      ...(s.forbiddenPatterns || []).map((r) => `- ⛔ ${r.text}`),
      '',
      `**Caminho de Memória:** \`.agent/memory/specialists/${s.id}.md\``,
    ].join('\n');

    if (!planOnly) {
      mkdirSync(sDir, { recursive: true });
      mkdirSync(memoryDir, { recursive: true });

      let currentSpecDoc = '';
      if (existsSync(specFile)) {
        currentSpecDoc = readFileSync(specFile, 'utf-8');
      }
      const updatedSpecDoc = writeManagedBlock(currentSpecDoc, managedContent, 'specialist');
      writeFileSync(specFile, updatedSpecDoc, 'utf-8');
      actions.push(`Updated specialist doc: ${s.id}/SPECIALIST.md`);

      // Memory file initialization
      if (!existsSync(memFile)) {
        const initialMem = [
          `# Memória do Especialista — ${s.name} (${s.id})`,
          '',
          '> Este arquivo registra aprendizados técnicos específicos e duradouros deste especialista.',
          '',
          '<!-- sdd:managed:begin id="lessons" -->',
          '<!-- /sdd:managed:end id="lessons" -->',
          '',
        ].join('\n');
        writeFileSync(memFile, initialMem, 'utf-8');
        actions.push(`Created initial specialist memory: memory/specialists/${s.id}.md`);
      }
    } else {
      actions.push(`[PLAN] Would update ${s.id}/SPECIALIST.md and memory file`);
    }
  }

  // 2. Write roster.lock.json
  const lockData = {
    sddVersion: '2.0.0',
    mode,
    evidenceHash,
    confidence,
    specialists: (roster.specialists || []).map((s) => ({
      id: s.id,
      version: s.version || 1,
      lineage: s.lineage || { from: [s.id], op: 'keep' },
    })),
  };

  if (!planOnly) {
    writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf-8');
    actions.push('Updated .agent/specialists/roster.lock.json');

    // 3. Generate SETUP_REPORT.md
    const reportContent = [
      '# Relatório de Setup de Especialistas SDD v2',
      '',
      `- **Data:** ${new Date().toISOString()}`,
      `- **Modo:** ${mode}`,
      `- **Confiança:** ${confidence.toUpperCase()}`,
      `- **Especialistas Instalados:** ${(roster.specialists || []).length}`,
      '',
      '## Roster Ativo',
      ...(roster.specialists || []).map(
        (s) => `### ${s.name} (\`${s.id}\`)\n- **Papel:** ${s.role}\n- **Padrões:** \`${(s.filePatterns || []).join(', ')}\`\n`
      ),
      '## Ações Executadas',
      ...actions.map((a) => `- ${a}`),
      '',
    ].join('\n');

    writeFileSync(join(specialistsDir, 'SETUP_REPORT.md'), reportContent, 'utf-8');
    actions.push('Generated .agent/specialists/SETUP_REPORT.md');
  }

  return {
    mode,
    confidence,
    report: `Setup executed in ${mode} mode. ${actions.length} actions taken.`,
    actions,
  };
}
