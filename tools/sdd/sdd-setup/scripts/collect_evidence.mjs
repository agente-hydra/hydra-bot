#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { git, listTrackedFiles } from '../../lib/git.mjs';
import { validateSchema } from '../../lib/schema.mjs';

/**
 * Collect all evidence from workspace deterministically.
 * @param {string} [repoRoot]
 * @returns {Promise<{ repoRoot: string; timestamp: string; degraded: string[]; items: any[] }>}
 */
export async function collectEvidence(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  /** @type {string[]} */
  const degraded = [];
  /** @type {any[]} */
  const items = [];

  // 1. Dependency Analysis (package.json / requirements.txt)
  const taxonomyPath = resolve(dirname(import.meta.url.replace(/^file:\/\/\/?/, '')), '../taxonomy.json');
  let taxonomy = { packages: {}, directoryHints: {} };
  if (existsSync(taxonomyPath)) {
    try {
      taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const pkgJsonPath = join(root, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [dep, ver] of Object.entries(allDeps)) {
        const mapped = taxonomy.packages[dep];
        items.push({
          id: `dep-${dep}`,
          kind: 'dependency',
          ref: `package.json#dependencies.${dep}`,
          weight: mapped ? 1.0 : 0.4,
          payload: {
            package: dep,
            version: ver,
            category: mapped ? mapped.category : 'general-dependency',
            suggestedRole: mapped ? mapped.role : null,
          },
        });
      }
    } catch {
      degraded.push('package_json_corrupted');
    }
  }

  // 2. Structure Analysis (Tracked files & Directory grouping)
  let tracked = [];
  try {
    tracked = await listTrackedFiles(root);
  } catch {
    tracked = [];
    degraded.push('git_ls_files_failed');
  }

  const dirCounts = new Map();
  for (const file of tracked) {
    if (file.startsWith('.') || file.startsWith('node_modules/') || file.startsWith('specs/archive/')) continue;
    const parts = file.split('/');
    const dir2 = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    dirCounts.set(dir2, (dirCounts.get(dir2) || 0) + 1);
  }

  for (const [dir, count] of dirCounts.entries()) {
    items.push({
      id: `struct-${dir.replace(/\//g, '-')}`,
      kind: 'structure',
      ref: dir,
      weight: 0.8,
      payload: {
        directory: dir,
        fileCount: count,
      },
    });
  }

  // 3. Graphify check
  const graphPath = join(root, 'graphify-out/graph.json');
  if (existsSync(graphPath)) {
    try {
      const graphData = JSON.parse(readFileSync(graphPath, 'utf-8'));
      items.push({
        id: 'graphify-summary',
        kind: 'structure',
        ref: 'graphify-out/graph.json',
        weight: 1.0,
        payload: {
          nodeCount: Array.isArray(graphData.nodes) ? graphData.nodes.length : 0,
          edgeCount: Array.isArray(graphData.edges) ? graphData.edges.length : 0,
        },
      });
    } catch {
      degraded.push('graphify_corrupted');
    }
  } else {
    degraded.push('graphify_missing');
  }

  // 4. Git Co-change Analysis
  try {
    const { stdout, exitCode } = await git(['log', '--name-only', '-n', '200', '--format=COMMIT:%h'], { cwd: root });
    if (exitCode === 0) {
      const commitBlocks = stdout.split('COMMIT:').filter((b) => b.trim().length > 0);
      const cochangeMap = new Map();

      for (const block of commitBlocks) {
        const files = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('specs/'));
        const uniqueDirs = Array.from(new Set(files.map((f) => f.split('/')[0])));
        for (let i = 0; i < uniqueDirs.length; i++) {
          for (let j = i + 1; j < uniqueDirs.length; j++) {
            const pairKey = [uniqueDirs[i], uniqueDirs[j]].sort().join('<->');
            cochangeMap.set(pairKey, (cochangeMap.get(pairKey) || 0) + 1);
          }
        }
      }

      for (const [pair, count] of cochangeMap.entries()) {
        if (count >= 3) {
          items.push({
            id: `cochange-${pair.replace(/[^\w-]/g, '_')}`,
            kind: 'cochange',
            ref: pair,
            weight: 0.7,
            payload: { pair, frequency: count },
          });
        }
      }
    }
  } catch {
    degraded.push('git_log_failed');
  }

  // 5. Memory Lessons Mining (.agent/memory/*.md)
  const memoryDir = join(root, '.agent/memory');
  if (existsSync(memoryDir)) {
    const memFiles = readdirSync(memoryDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    for (const memFile of memFiles) {
      const fullPath = join(memoryDir, memFile);
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^##\s*\[(\d{4}-\d{2}-\d{2})\]\s*—\s*(?:\[([^\]]+)\]\s*)?(.*)$/);
        if (match) {
          const date = match[1];
          const tag = match[2] || '';
          const title = match[3] || '';
          // Extract snippet of lines until next ##
          let snippet = '';
          let endLine = i + 1;
          while (endLine < lines.length && !lines[endLine].startsWith('## ')) {
            snippet += `${lines[endLine]}\n`;
            endLine++;
          }
          items.push({
            id: `mem-${memFile.replace(/\.md$/, '')}-${i + 1}`,
            kind: 'memory',
            ref: `.agent/memory/${memFile}#${i + 1}`,
            weight: 0.9,
            payload: {
              file: memFile,
              line: i + 1,
              date,
              tag,
              title,
              summary: snippet.slice(0, 300).trim(),
            },
          });
        }
      }
    }
  }

  // 6. Ops & Infrastructure signals
  const opsSignals = ['deploy', 'scripts', '.github', 'Dockerfile', 'docker-compose.yml', 'ecosystem.config.js'];
  for (const signal of opsSignals) {
    if (existsSync(join(root, signal))) {
      items.push({
        id: `ops-${signal.replace(/[^\w-]/g, '_')}`,
        kind: 'ops',
        ref: signal,
        weight: 0.85,
        payload: { path: signal },
      });
    }
  }

  return {
    repoRoot: root,
    timestamp: new Date().toISOString(),
    degraded,
    items,
  };
}

// CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const result = await collectEvidence();
  const schemaPath = resolve(dirname(import.meta.url.replace(/^file:\/\/\/?/, '')), '../../schemas/evidence.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const validation = validateSchema(result, schema);
  if (!validation.valid) {
    console.error('Evidence schema validation failed:', validation.errors);
    process.exit(1);
  }
  const outPath = process.argv[2] || 'evidence.json';
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Collected ${result.items.length} evidence items -> ${outPath}`);
}
