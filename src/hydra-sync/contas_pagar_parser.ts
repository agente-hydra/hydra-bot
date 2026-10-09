/**
 * contas_pagar_parser.ts
 *
 * Parser estruturado de alta fidelidade para as planilhas Excel (.xls / .xlsx)
 * geradas pela tela wfContaBuscaPagar.aspx do ERP Oficina Inteligente.
 *
 * Mapeamento das 12 colunas oficiais:
 * 1. Emp (Loja)
 * 2. Código (Lançamento ERP)
 * 3. Parc (Parcela, ex: '1/1')
 * 4. Cliente/Fornecedor (Favorecido)
 * 5. Descrição (Histórico do pagamento)
 * 6. Tipo (LCTO, etc)
 * 7. Dt. Vecto (Data de Vencimento)
 * 8. Dt. Previsão (Data de Previsão)
 * 9. Vl. a Pagar (Valor original a pagar)
 * 10. Status (Situação, ex: 'PAG')
 * 11. Dt. Pgto (Data efetiva de pagamento)
 * 12. Vl. Pago (Valor pago)
 */

import * as fs from 'fs';
import * as path from 'path';

// Carregamento dinâmico do SheetJS / xlsx
let xlsx: any;
const caminhosPossiveis = [
  'xlsx',
  path.resolve(__dirname, '../../projects/hydra-rede/node_modules/xlsx'),
  path.resolve(__dirname, '../projects/hydra-rede/node_modules/xlsx'),
  path.resolve(process.cwd(), 'projects/hydra-rede/node_modules/xlsx'),
  '/home/operacional/hydra-rede/node_modules/xlsx',
  '/opt/bots/node_modules/xlsx'
];

for (const cand of caminhosPossiveis) {
  try {
    xlsx = require(cand);
    if (xlsx && xlsx.readFile) break;
  } catch (_) {}
}

if (!xlsx || !xlsx.readFile) {
  throw new Error('Módulo xlsx não encontrado para parsing de Contas a Pagar.');
}

export interface LancamentoContaPagar {
  id: string; // "loja_slug:codigo:parcela"
  lojaSlug: string;
  lojaOriginal: string;
  codigo: number;
  parcela: string;
  fornecedor: string;
  descricao: string;
  tipo: string;
  dataVencimento: string; // YYYY-MM-DD
  dataPrevisao: string;   // YYYY-MM-DD
  valorAPagar: number;
  status: string;
  dataPagamento: string;  // YYYY-MM-DD
  valorPago: number;
  dataExtracao: string;   // ISO 8601
  textoSemantico: string;
}

const DEPARA_LOJAS: Record<string, string> = {
  reidooleomaua: 'maua',
  reidoleomaua: 'maua',
  mprudge: 'rudge_ramos',
  mpsantoandre: 'santo_andre',
  reidomodulo: 'rei_do_modulo',
  mpdompedro1: 'dom_pedro',
  mpjabaquara: 'jabaquara',
  mpjorgeberetta: 'jorge_beretta',
  mpkennedy: 'kennedy',
  mppiraporinha: 'piraporinha',
  mpplanalto: 'planalto',
  mpmaster: 'master'
};

export function normalizarSlugLoja(lojaEmp: string): string {
  const limpo = String(lojaEmp || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return DEPARA_LOJAS[limpo] || limpo || 'desconhecida';
}

/**
 * Converte valor monetário com segurança suportando tanto número nativo quanto string formatada
 */
export function parseValorMonetario(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const s = String(val).trim().replace('R$', '').trim();
  if (s.includes(',')) {
    // Formato brasileiro: 1.266,50
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return parseFloat(s) || 0;
}

/**
 * Converte número serial de data do Excel ou string BR para formato ISO YYYY-MM-DD
 */
export function converterDataExcel(valorData: any): string {
  if (valorData === null || valorData === undefined || valorData === '') {
    return new Date().toISOString().split('T')[0];
  }

  // Se já for string tipo "DD/MM/YYYY" ou "YYYY-MM-DD"
  if (typeof valorData === 'string') {
    const s = valorData.trim();
    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        return `${y}-${m}-${d}`;
      }
    }
    if (s.includes('-')) {
      return s.split('T')[0];
    }
  }

  // Se for número serial do Excel (ex: 46303)
  if (typeof valorData === 'number' && !isNaN(valorData)) {
    // Dias do Excel começam em 30/12/1899 (devido ao bug histórico do ano bissexto 1900)
    const dataJs = new Date(Math.round((valorData - 25569) * 86400 * 1000));
    if (!isNaN(dataJs.getTime())) {
      const y = dataJs.getUTCFullYear();
      const m = String(dataJs.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dataJs.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  return new Date().toISOString().split('T')[0];
}

/**
 * Gera o texto enriquecido para embeddings e busca semântica em IA
 */
export function gerarTextoSemanticoConta(conta: Omit<LancamentoContaPagar, 'textoSemantico' | 'id'>): string {
  const dataBR = conta.dataPagamento.split('-').reverse().join('/');
  return [
    `Pagamento efetuado na loja ${conta.lojaOriginal} (${conta.lojaSlug}).`,
    `Valor pago: R$ ${conta.valorPago.toFixed(2)} (Valor original: R$ ${conta.valorAPagar.toFixed(2)}).`,
    `Favorecido/Fornecedor: ${conta.fornecedor}.`,
    `Histórico: ${conta.descricao}.`,
    `Data do pagamento: ${dataBR}. Parcela: ${conta.parcela}. Código ERP: ${conta.codigo}. Tipo: ${conta.tipo}. Status: ${conta.status}.`
  ].join(' ');
}

/**
 * Analisa o arquivo Excel (.xls / .xlsx) de Contas a Pagar e retorna os lançamentos estruturados
 */
export function parseContasPagarExcel(caminhoArquivo: string): LancamentoContaPagar[] {
  if (!fs.existsSync(caminhoArquivo)) {
    throw new Error(`Arquivo Excel de Contas a Pagar não encontrado: ${caminhoArquivo}`);
  }

  const workbook = xlsx.readFile(caminhoArquivo);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  // Leitura bruta como matriz de linhas
  const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length < 4) {
    return [];
  }

  // Localiza a linha do cabeçalho que contém 'Emp' e 'Código' (geralmente linha 3 ou 4)
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] || [];
    const rowText = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowText.includes('emp') && (rowText.includes('código') || rowText.includes('codigo'))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    console.warn(`[Contas Pagar Parser] Cabeçalho com 'Emp' e 'Código' não identificado com precisão. Assumindo linha 3.`);
    headerRowIndex = 3;
  }

  const header = rows[headerRowIndex].map(c => String(c || '').trim());
  const colIndex = {
    emp: header.findIndex(h => /^emp/i.test(h)),
    codigo: header.findIndex(h => /c[óo]digo/i.test(h)),
    parc: header.findIndex(h => /^parc/i.test(h)),
    fornecedor: header.findIndex(h => /cliente|fornecedor/i.test(h)),
    descricao: header.findIndex(h => /descri/i.test(h)),
    tipo: header.findIndex(h => /^tipo/i.test(h)),
    dtVecto: header.findIndex(h => /vecto|venc/i.test(h)),
    dtPrevisao: header.findIndex(h => /previs/i.test(h)),
    vlAPagar: header.findIndex(h => /vl.*pagar/i.test(h)),
    status: header.findIndex(h => /^status/i.test(h)),
    dtPgto: header.findIndex(h => /pgto|pagamento/i.test(h)),
    vlPago: header.findIndex(h => /vl.*pago/i.test(h))
  };

  const lancamentos: LancamentoContaPagar[] = [];
  const nowIso = new Date().toISOString();

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const empOriginal = String(row[colIndex.emp] || '').trim();
    const codigoRaw = row[colIndex.codigo];
    const codigo = typeof codigoRaw === 'number' ? codigoRaw : parseInt(String(codigoRaw || '0'), 10);

    // Linhas de totalizadores ou linhas em branco
    if (!empOriginal || !codigo || isNaN(codigo)) {
      continue;
    }

    const parcela = String(row[colIndex.parc] || '1/1').trim();
    const fornecedor = String(row[colIndex.fornecedor] || 'Não informado').trim();
    const descricao = String(row[colIndex.descricao] || '').trim();
    const tipo = String(row[colIndex.tipo] || 'LCTO').trim();
    const status = String(row[colIndex.status] || 'PAG').trim();

    const dtVecto = converterDataExcel(row[colIndex.dtVecto]);
    const dtPrevisao = converterDataExcel(row[colIndex.dtPrevisao]);
    const dtPgto = converterDataExcel(row[colIndex.dtPgto]);

    const vlAPagar = parseValorMonetario(row[colIndex.vlAPagar]);
    const vlPago = colIndex.vlPago >= 0 && row[colIndex.vlPago] !== undefined
      ? parseValorMonetario(row[colIndex.vlPago])
      : vlAPagar;

    const lojaSlug = normalizarSlugLoja(empOriginal);
    const id = `${lojaSlug}:${codigo}:${parcela.replace('/', '-')}`;

    const itemBase = {
      lojaSlug,
      lojaOriginal: empOriginal,
      codigo,
      parcela,
      fornecedor,
      descricao,
      tipo,
      dataVencimento: dtVecto,
      dataPrevisao: dtPrevisao,
      valorAPagar: vlAPagar,
      status,
      dataPagamento: dtPgto,
      valorPago: vlPago,
      dataExtracao: nowIso
    };

    const textoSemantico = gerarTextoSemanticoConta(itemBase);

    lancamentos.push({
      ...itemBase,
      id,
      textoSemantico
    });
  }

  return lancamentos;
}
