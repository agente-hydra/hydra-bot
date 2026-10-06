import * as fs from 'fs';
import * as path from 'path';
import { DocumentoAberto } from '../workers/oficina-agent/playwright/actions/os_deep_inspector.js';

export interface OSStore {
  slug_loja: string;
  nome_amigavel: string;
  ultima_atualizacao: string;
  os_map: Record<string, DocumentoAberto>;
}

const DEFAULT_CRAWLS_DIR = '/home/operacional/hydra-data/crawls';
const DEFAULT_BACKUPS_DIR = '/home/operacional/hydra-data/backups';

// ─── Helpers de Data ─────────────────────────────────────────────────────────

export function parseDataBR(dataStr: string): Date | null {
  if (!dataStr) return null;
  try {
    const [datePart, timePart] = dataStr.trim().split(' ');
    const parts = datePart.split('/');
    if (parts.length !== 3) return null;

    let dia = parseInt(parts[0], 10);
    let mes = parseInt(parts[1], 10) - 1;
    let ano = parseInt(parts[2], 10);
    if (ano < 100) ano += 2000;

    let hora = 0;
    let minuto = 0;
    if (timePart) {
      const [h, m] = timePart.split(':');
      hora = parseInt(h, 10) || 0;
      minuto = parseInt(m, 10) || 0;
    }

    return new Date(ano, mes, dia, hora, minuto);
  } catch {
    return null;
  }
}

// ─── Carregar e Salvar Store por Loja ────────────────────────────────────────

export function carregarStoreLoja(slugLoja: string, nomeAmigavel?: string, crawlsDir: string = DEFAULT_CRAWLS_DIR): OSStore {
  const storePath = path.join(crawlsDir, `os_store_${slugLoja}.json`);

  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf-8');
      const parsed: OSStore = JSON.parse(raw);
      if (parsed.os_map) return parsed;
    } catch (e: any) {
      console.warn(`[Delta Storage] Erro ao ler store existente de ${slugLoja}: ${e.message}`);
    }
  }

  // Fallback / Bootstrap: Se não existe os_store, importar de extracao_mes_<slug>.json se existir
  const legacyPath = path.join(crawlsDir, `extracao_mes_${slugLoja}.json`);
  const os_map: Record<string, DocumentoAberto> = {};

  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      const legacy = JSON.parse(raw);
      const docs: DocumentoAberto[] = legacy.documentos || [];
      for (const d of docs) {
        if (d.id) os_map[d.id] = d;
      }
      console.log(`[Delta Storage] Bootstrapped store de ${slugLoja} com ${docs.length} OSs do arquivo legado.`);
    } catch {}
  }

  return {
    slug_loja: slugLoja,
    nome_amigavel: nomeAmigavel || slugLoja,
    ultima_atualizacao: new Date().toISOString(),
    os_map,
  };
}

export function salvarStoreLoja(store: OSStore, crawlsDir: string = DEFAULT_CRAWLS_DIR): void {
  if (!fs.existsSync(crawlsDir)) {
    fs.mkdirSync(crawlsDir, { recursive: true });
  }

  store.ultima_atualizacao = new Date().toISOString();

  // 1. Salvar os_store_<slug>.json
  const storePath = path.join(crawlsDir, `os_store_${store.slug_loja}.json`);
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');

  // 2. Sincronizar com extracao_mes_<slug>.json (para compatibilidade com consumidores existentes)
  const docsArray = Object.values(store.os_map);
  const legacyData = {
    slug_loja: store.slug_loja,
    nome_amigavel: store.nome_amigavel,
    data_extracao: new Date().toISOString().replace('T', ' ').substring(0, 19),
    total_documentos: docsArray.length,
    total_abertos: docsArray.filter(d => (d.status_grid || '').trim() !== '').length,
    total_fechados: docsArray.filter(d => (d.status_grid || '').trim() === '').length,
    total_com_detalhe: docsArray.filter(d => d.extracao_completa).length,
    documentos: docsArray,
  };

  const legacyPath = path.join(crawlsDir, `extracao_mes_${store.slug_loja}.json`);
  fs.writeFileSync(legacyPath, JSON.stringify(legacyData, null, 2), 'utf-8');

  // Também salvar cópia de hoje
  const hojePath = path.join(crawlsDir, `extracao_hoje_${store.slug_loja}.json`);
  fs.writeFileSync(hojePath, JSON.stringify(legacyData, null, 2), 'utf-8');
}

// ─── Upsert Cirúrgico de OS ──────────────────────────────────────────────────

export function upsertCirurgicoOS(store: OSStore, novoDoc: DocumentoAberto): boolean {
  if (!novoDoc.id) return false;

  const existing = store.os_map[novoDoc.id];
  if (!existing) {
    store.os_map[novoDoc.id] = novoDoc;
    return true;
  }

  // Mesclar pontualmente campos novos com existentes
  const updated: DocumentoAberto = {
    ...existing,
    ...novoDoc,
  };

  // Se o novo não teve extração completa mas o antigo já tinha, preservar dados detalhados antigos
  if (!novoDoc.extracao_completa && existing.extracao_completa) {
    updated.itens = novoDoc.itens && novoDoc.itens.length > 0 ? novoDoc.itens : existing.itens;
    updated.pagamentos = novoDoc.pagamentos && novoDoc.pagamentos.length > 0 ? novoDoc.pagamentos : existing.pagamentos;
    updated.documentos_anexos = novoDoc.documentos_anexos && novoDoc.documentos_anexos.length > 0 ? novoDoc.documentos_anexos : existing.documentos_anexos;
    updated.notas_fiscais = novoDoc.notas_fiscais && novoDoc.notas_fiscais.length > 0 ? novoDoc.notas_fiscais : existing.notas_fiscais;
    updated.checklists = novoDoc.checklists && novoDoc.checklists.length > 0 ? novoDoc.checklists : existing.checklists;
    updated.garantias = novoDoc.garantias && novoDoc.garantias.length > 0 ? novoDoc.garantias : existing.garantias;
    updated.total_os = novoDoc.total_os !== undefined && novoDoc.total_os > 0 ? novoDoc.total_os : existing.total_os;
    updated.extracao_completa = true;
  }

  store.os_map[novoDoc.id] = updated;
  return true;
}

// ─── Decisão Inteligente de Re-Extração ───────────────────────────────────────

export function deveReextrairOS(
  store: OSStore,
  rawOrder: { id: string; status: string; dataInicio: string }
): boolean {
  const existing = store.os_map[rawOrder.id];

  // 1. Nova OS nunca extraída antes -> Extrair com certeza
  if (!existing) return true;

  // 2. Se a extração anterior falhou ou ficou incompleta -> Reextrair
  if (!existing.extracao_completa) return true;

  // 3. Se o status mudou na grade (ex: estava em execução e foi para retirada ou faturado) -> Reextrair
  const statusAtual = (rawOrder.status || '').trim();
  const statusAntigo = (existing.status_grid || '').trim();
  if (statusAtual !== statusAntigo) return true;

  // 4. Carros ativos no pátio (status não vazio) -> Sempre reextrair para acompanhar progresso de peças/check-list
  const isAtivoNoPatio = statusAtual !== '' && !statusAtual.toLowerCase().includes('fechad') && !statusAtual.toLowerCase().includes('cancel');
  if (isAtivoNoPatio) return true;

  // 5. OSs fechadas: se fechou nos últimos 14 dias, reextrair para capturar anexos/documentos pós-fechamento
  const dataOS = parseDataBR(rawOrder.dataInicio || existing.data_inicio);
  if (dataOS) {
    const diffDias = (Date.now() - dataOS.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDias <= 14) {
      return true; // Fechada recente: audita para verificar novos documentos
    }
  }

  // 6. OS fechada há mais de 14 dias sem mudança na grade -> Reutilizar cache instantaneamente (0ms)
  return false;
}

// ─── Expurgo Automático de OSs com > 30 Dias ──────────────────────────────────

export function expurgarOSsAntigas(store: OSStore, maxDias: number = 30): number {
  const agora = Date.now();
  const limiteMs = maxDias * 24 * 60 * 60 * 1000;
  let expurgados = 0;

  for (const [osId, doc] of Object.entries(store.os_map)) {
    const dataOS = parseDataBR(doc.data_inicio);
    if (dataOS) {
      const diffMs = agora - dataOS.getTime();
      if (diffMs > limiteMs) {
        delete store.os_map[osId];
        expurgados++;
      }
    }
  }

  if (expurgados > 0) {
    console.log(`[Delta Storage] ${store.slug_loja}: ${expurgados} OSs com mais de ${maxDias} dias foram expurgadas.`);
  }

  return expurgados;
}

// ─── Gestão de Snapshots Diários & Retenção de 30 Dias ───────────────────────

export function salvarSnapshotHistorico(
  dadosConsolidados: any,
  backupsDir: string = DEFAULT_BACKUPS_DIR,
  maxDiasRetencao: number = 30
): string {
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `snapshot_${stamp}.json`;
  const filePath = path.join(backupsDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(dadosConsolidados, null, 2), 'utf-8');
  console.log(`[Delta Storage] Snapshot salvo: ${filePath}`);

  // Limpeza de backups antigos (> maxDiasRetencao)
  try {
    const files = fs.readdirSync(backupsDir);
    const limiteMs = maxDiasRetencao * 24 * 60 * 60 * 1000;
    const agora = Date.now();

    for (const f of files) {
      if (f.startsWith('snapshot_') && f.endsWith('.json')) {
        const fullPath = path.join(backupsDir, f);
        const stats = fs.statSync(fullPath);
        if (agora - stats.mtimeMs > limiteMs) {
          fs.unlinkSync(fullPath);
          console.log(`[Delta Storage] Backup antigo removido: ${f}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Delta Storage] Erro ao limpar snapshots antigos: ${err.message}`);
  }

  return filePath;
}
