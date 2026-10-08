import { execFile } from 'child_process';
import type Database from 'better-sqlite3';
import { ConsolidadoRede, BriefingIA, BriefingTopicoPersonalizado } from './hydra_audit_engine.js';
import { getDatabaseConnection, registrarTelemetriaIA, queryStoreCMV, queryGoalGap } from './db_repository.js';
import { getUserPersonalizationSummary, cleanPhone } from './user_memory_repository.js';
import { retrieveActiveMemoriesSync } from './memory_retriever.js';

const AGY_PATH = process.env.AGY_BIN_OVERRIDE || '/home/operacional/.local/bin/agy';
const MODEL = 'gemini-3.6-flash-low';

const BANNED_SLOP_WORDS = [
  'robusto', 'severo', 'crítica', 'crítico', 'sustentado por', 'sustentado pela',
  'alavancado', 'alta produtividade', 'cenário promissor', 'estratégico',
  'gargalo grave', 'preocupante', 'impressionante', 'saúde comercial'
];

function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function contemSlop(texto: string): boolean {
  if (!texto) return false;
  const t = texto.toLowerCase();
  return BANNED_SLOP_WORDS.some(w => t.includes(w));
}

export interface BriefingSectionItem {
  key: string;
  title: string;
  content: string;
  priority: number;
}

export interface BriefingIAExtended extends BriefingIA {
  cancelled?: boolean;
  cancellationReason?: string;
  orderedSections?: BriefingSectionItem[];
}

export interface BriefingPersonalizationOptions {
  destinatario?: string; // Telefone do destinatário (ex: 5511996242812)
  lojaSlug?: string; // Loja preferida ou inferida
  topicosPersonalizados?: string[]; // Tópicos solicitados ou com evidência na memória
  persona?: string; // Persona ativa ('socio' ou 'gerente')
  db?: Database.Database; // Conexão SQLite opcional
  maxAgeHours?: number; // Tolerância máxima de idade da fonte (padrão: 26h)
}

/**
 * Revalida o cadastro do destinatário na tabela hydra_authorized_users.
 * REGRA CRÍTICA: cancela o disparo se is_active === 0 (usuário revogado ou inativo).
 */
export function validarCadastroDestinatario(
  db: Database.Database,
  phone: string
): { allowed: boolean; reason?: string } {
  const p = cleanPhone(phone);
  try {
    const user = db.prepare(`
      SELECT is_active FROM hydra_authorized_users WHERE phone = ?
    `).get(p) as { is_active: number } | undefined;

    if (user && (user.is_active === 0 || (user.is_active as any) === false)) {
      return { allowed: false, reason: 'user_inactive_or_revoked' };
    }
  } catch (err: any) {
    console.warn(`[AI Briefing] Falha ao verificar hydra_authorized_users para ${p}:`, err?.message || err);
  }
  return { allowed: true };
}

/**
 * Helper rápido para checar se o destinatário pode receber o briefing.
 */
export function podeDispararBriefing(db: Database.Database, phone: string): boolean {
  return validarCadastroDestinatario(db, phone).allowed;
}

/**
 * Resolve tópicos personalizados para o destinatário respeitando:
 * 1. Consulta às memórias ativas consolidadas via memory_retriever.ts com escopo efetivo.
 * 2. No máximo 2 tópicos personalizados.
 * 3. Inclusão APENAS se a fonte estiver atualizada com dados oficiais do banco.
 * 4. Preserva o perfil e escopo do destinatário sem mutar a sessão interativa.
 */
export function resolverTopicosPersonalizados(
  dados: ConsolidadoRede,
  options?: BriefingPersonalizationOptions
): BriefingTopicoPersonalizado[] {
  if (!options) return [];

  let db: Database.Database | null = options.db || null;
  if (!db) {
    try {
      db = getDatabaseConnection();
    } catch {
      db = null;
    }
  }

  const cleanP = options.destinatario ? cleanPhone(options.destinatario) : '';
  let candidateTopics: string[] = options.topicosPersonalizados ? [...options.topicosPersonalizados] : [];
  let targetLoja = options.lojaSlug;

  // 1. Consulta memórias ativas estruturadas via memory_retriever respeitando escopo efetivo
  if (cleanP && db && candidateTopics.length === 0) {
    try {
      // Lê usuário e perfil sem mutar a sessão interativa (read-only)
      const userRow = db.prepare(`
        SELECT role, allowed_stores, is_active FROM hydra_authorized_users WHERE phone = ?
      `).get(cleanP) as any;

      const memRow = db.prepare(`
        SELECT generation_id, active_persona, default_loja_slug FROM hydra_user_memory WHERE phone = ?
      `).get(cleanP) as any;

      const genId = memRow?.generation_id ?? 1;
      const isGerente = (options.persona === 'gerente') ||
        (userRow?.role === 'gerente') ||
        (memRow?.active_persona === 'gerente');
      const effectivePersona: 'socio' | 'gerente' = isGerente ? 'gerente' : 'socio';

      let activeLojaSlug = options.lojaSlug || memRow?.default_loja_slug;
      if (!activeLojaSlug && userRow?.allowed_stores) {
        try {
          const allowed = JSON.parse(userRow.allowed_stores);
          if (Array.isArray(allowed) && allowed.length > 0 && allowed[0] !== '*') {
            activeLojaSlug = allowed[0];
          }
        } catch {}
      }

      if (activeLojaSlug && !targetLoja) {
        targetLoja = activeLojaSlug;
      }

      // Consulta de escopo efetivo estrito
      const retrieved = retrieveActiveMemoriesSync(db, {
        phone: cleanP,
        generationId: genId,
        effectivePersona,
        activeLojaSlug: activeLojaSlug || null,
        maxItems: 5
      });

      if (retrieved.memories && retrieved.memories.length > 0) {
        for (const m of retrieved.memories) {
          const tKey = (m.topicKey || '').toLowerCase();
          const content = (m.contentNormalized || '').toLowerCase();

          if (tKey.includes('cmv') || content.includes('cmv') || content.includes('oleo') || content.includes('óleo')) {
            candidateTopics.push('cmv_oleo');
          } else if (tKey.includes('peca') || tKey.includes('peça') || content.includes('aguardando pe') || content.includes('peça')) {
            candidateTopics.push('os_aguardando_peca');
          } else if (tKey.includes('meta') || content.includes('meta')) {
            candidateTopics.push('metas');
          } else if (tKey.includes('patio') || tKey.includes('travado') || content.includes('travado')) {
            candidateTopics.push('carros_travados');
          } else if (tKey) {
            candidateTopics.push(tKey);
          }
        }
      }

      // Fallback para preferências consolidadas legadas se necessário
      if (candidateTopics.length === 0) {
        const summary = getUserPersonalizationSummary(db, cleanP);
        candidateTopics = summary.topPersonalizedTopics;
        if (!targetLoja && summary.defaultLojaSlug) {
          targetLoja = summary.defaultLojaSlug;
        }
      }
    } catch (err: any) {
      console.warn(`[AI Briefing] Falha ao recuperar memórias do destinatário ${cleanP}:`, err?.message || err);
    }
  }

  if (candidateTopics.length === 0 && !targetLoja) {
    return [];
  }

  const lojaSlugFinal = targetLoja || 'jabaquara';
  const topicosValidos: BriefingTopicoPersonalizado[] = [];
  const maxHours = options.maxAgeHours ?? 26;
  const processedKeys = new Set<string>();

  for (const topic of candidateTopics) {
    if (topicosValidos.length >= 2) break;
    const tNorm = topic.trim().toLowerCase();
    if (processedKeys.has(tNorm)) continue;
    processedKeys.add(tNorm);

    // 1. Tópico: CMV de óleo ou CMV geral da loja (Alimentado SEMPRE por dados oficiais do banco)
    if (tNorm.includes('cmv') || tNorm.includes('oleo') || tNorm.includes('óleo')) {
      if (db) {
        try {
          const cmvRes = queryStoreCMV(db, { lojaSlug: lojaSlugFinal, maxAgeHours: maxHours });
          if (cmvRes && cmvRes.status === 'sucesso' && cmvRes.cmvPercentual != null) {
            const areaOleo = (cmvRes.areas || []).find(a => /óleo|oleo/i.test(a.area));
            if (areaOleo && areaOleo.cmvPercentual != null) {
              topicosValidos.push({
                topico: 'cmv_oleo',
                titulo: `CMV de Óleo (${cmvRes.nome || lojaSlugFinal})`,
                detalhe: `${areaOleo.area}: CMV ${areaOleo.cmvPercentual.toFixed(1)}% | Custo ${fmtMoeda(areaOleo.custo || 0)} | Fat ${fmtMoeda(areaOleo.faturamento || 0)}`,
                fonteAtualizada: true,
                lojaSlug: lojaSlugFinal
              });
            } else {
              topicosValidos.push({
                topico: 'cmv',
                titulo: `CMV Operacional (${cmvRes.nome || lojaSlugFinal})`,
                detalhe: `CMV ${cmvRes.cmvPercentual.toFixed(1)}% | Margem Bruta ${cmvRes.lucroBrutoPercentual?.toFixed(1) || '0'}%`,
                fonteAtualizada: true,
                lojaSlug: lojaSlugFinal
              });
            }
          }
        } catch {}
      }
      continue;
    }

    // 2. Tópico: OS aguardando peça (Alimentado SEMPRE de ordens_servico no banco)
    if (tNorm.includes('peca') || tNorm.includes('peça') || tNorm.includes('aguardando')) {
      if (db) {
        try {
          let rows: any[] = [];
          if (lojaSlugFinal) {
            rows = db.prepare(`
              SELECT os_id, veiculo, placa, total_os, dias_no_patio, status_grid
              FROM ordens_servico
              WHERE is_aberta = 1
                AND LOWER(loja_slug) = LOWER(?)
                AND (LOWER(status_grid) LIKE '%peça%' OR LOWER(status_grid) LIKE '%peca%' OR LOWER(status_grid) LIKE '%aguardando pe%')
              ORDER BY total_os DESC
            `).all(lojaSlugFinal) as any[];
          } else {
            rows = db.prepare(`
              SELECT os_id, veiculo, placa, total_os, dias_no_patio, status_grid
              FROM ordens_servico
              WHERE is_aberta = 1
                AND (LOWER(status_grid) LIKE '%peça%' OR LOWER(status_grid) LIKE '%peca%' OR LOWER(status_grid) LIKE '%aguardando pe%')
              ORDER BY total_os DESC
            `).all() as any[];
          }

          if (rows.length > 0) {
            const totalValor = rows.reduce((acc, r) => acc + (Number(r.total_os) || 0), 0);
            const maiorOs = rows[0];
            const detalheMaior = maiorOs ? ` (Maior: OS #${maiorOs.os_id} ${fmtMoeda(maiorOs.total_os)})` : '';
            topicosValidos.push({
              topico: 'os_aguardando_peca',
              titulo: `OSs Aguardando Peça (${lojaSlugFinal})`,
              detalhe: `${rows.length} ordens aguardando peças (${fmtMoeda(totalValor)})${detalheMaior}`,
              fonteAtualizada: true,
              lojaSlug: lojaSlugFinal
            });
          }
        } catch {}
      }
      continue;
    }

    // 3. Tópico: Metas e atingimento da loja ou rede
    if (tNorm.includes('meta') || tNorm.includes('goal')) {
      if (db) {
        try {
          const goalRes = queryGoalGap(db, { lojaSlug: lojaSlugFinal, maxAgeHours: maxHours });
          if (goalRes && goalRes.status === 'sucesso' && goalRes.atingimentoPercentual != null) {
            const atingimento = goalRes.atingimentoPercentual.toFixed(1);
            const statusMeta = goalRes.bateuMeta ? 'meta atingida' : `gap de ${fmtMoeda(goalRes.falta || 0)}`;
            topicosValidos.push({
              topico: 'metas',
              titulo: `Meta (${lojaSlugFinal})`,
              detalhe: `${atingimento}% da meta alcançado (${statusMeta})`,
              fonteAtualizada: true,
              lojaSlug: lojaSlugFinal
            });
          }
        } catch {}
      }
      continue;
    }

    // 4. Tópico: Carros travados da loja de interesse
    if (tNorm.includes('patio') || tNorm.includes('travado')) {
      const travadosLoja = (dados.carrosTravados || []).filter(c =>
        c.loja.toLowerCase().includes(lojaSlugFinal.toLowerCase())
      );
      topicosValidos.push({
        topico: 'carros_travados',
        titulo: `Carros Travados (${lojaSlugFinal})`,
        detalhe: `${travadosLoja.length} veículos travados há 5+ dias`,
        fonteAtualizada: true,
        lojaSlug: lojaSlugFinal
      });
      continue;
    }
  }

  // Restrição estrita: no máximo 2 tópicos personalizados
  return topicosValidos.slice(0, 2);
}

/**
 * Gera briefing executivo da IA com indicadores centrais da rede e
 * personalização por destinatário baseada na memória do usuário.
 * Aplica revalidação de cadastro (cancela se is_active === 0) e
 * prioriza a ordem das seções com base em tópicos de interesse confirmados.
 */
export async function gerarBriefingExecutivoIA(
  dados: ConsolidadoRede,
  options?: BriefingPersonalizationOptions
): Promise<BriefingIAExtended> {
  let db: Database.Database | null = null;
  try {
    db = options?.db || getDatabaseConnection();
  } catch {}

  // 0. Revalidação de cadastro do destinatário antes do envio
  if (options?.destinatario && db) {
    const validacao = validarCadastroDestinatario(db, options.destinatario);
    if (!validacao.allowed) {
      console.warn(`[AI Briefing] ⛔ Destinatário ${options.destinatario} inativo/revogado (is_active === 0). Disparo cancelado.`);
      return {
        riscoFinanceiro: '',
        gargaloPatio: '',
        eficienciaComercial: '',
        topicosPersonalizados: [],
        destinatario: options.destinatario,
        cancelled: true,
        cancellationReason: validacao.reason || 'user_inactive_or_revoked',
        orderedSections: []
      };
    }
  }

  // 1. Métricas exatas da operação (Indicadores Centrais da Rede)
  const totalExpostoSemSinal = dados.alertasFinanceiros.reduce((acc, curr) => acc + curr.saldoAReceber, 0);
  const qtdAlertas = dados.alertasFinanceiros.length;
  const qtdTravados = dados.carrosTravados.length;
  const pctTravados = dados.totalPatioAtivo > 0 ? Math.round((qtdTravados / dados.totalPatioAtivo) * 100) : 0;

  // Identificar loja mais exposta financeiramente
  const expPorLoja: Record<string, number> = {};
  dados.alertasFinanceiros.forEach(a => {
    expPorLoja[a.loja] = (expPorLoja[a.loja] || 0) + a.saldoAReceber;
  });
  const lojaMaisExposta = Object.entries(expPorLoja).sort((a, b) => b[1] - a[1])[0];

  // Identificar loja com maior retenção de pátio
  const travadosPorLoja: Record<string, number> = {};
  dados.carrosTravados.forEach(c => {
    travadosPorLoja[c.loja] = (travadosPorLoja[c.loja] || 0) + 1;
  });
  const lojaMaiorRetencao = Object.entries(travadosPorLoja).sort((a, b) => b[1] - a[1])[0];

  const top1 = dados.raioXLojas?.[0];
  const top2 = dados.raioXLojas?.[1];

  // 2. Fórmulas Determinísticas Puras (Baseline Anti-Slop Garantido)
  const defaultRisco = qtdAlertas > 0
    ? `${fmtMoeda(totalExpostoSemSinal)} em ${qtdAlertas} OSs sem sinal (> R$ 2,5k). Maior risco: ${lojaMaisExposta ? `${lojaMaisExposta[0]} (${fmtMoeda(lojaMaisExposta[1])})` : 'N/A'}.`
    : 'Zero OSs sem sinal acima de R$ 2.500 no momento.';

  const defaultPatio = qtdTravados > 0
    ? `${qtdTravados} veículos travados há 5+ dias (${pctTravados}% do pátio). Maior retenção: ${lojaMaiorRetencao ? `${lojaMaiorRetencao[0]} (${lojaMaiorRetencao[1]} carros)` : 'N/A'}.`
    : 'Nenhum veículo travado há 5+ dias no pátio.';

  const defaultComercial = `${fmtMoeda(dados.faturamentoTotal)} acumulados em ${dados.totalOSs} OSs (TK Médio: ${fmtMoeda(dados.ticketMedioRede)}). Líderes: ${top1 ? `${top1.nome} (${fmtMoeda(top1.faturamentoMes)})` : ''}${top2 ? ` e ${top2.nome} (${fmtMoeda(top2.faturamentoMes)})` : ''}.`;

  // 3. Resolução de Tópicos Personalizados (máximo 2, apenas se atualizados no banco oficial)
  const topicosPersonalizados = resolverTopicosPersonalizados(dados, options);

  // 4. Priorização adaptativa da ordem das seções com base em tópicos de interesse confirmados
  const buildOrderedSections = (risco: string, patio: string, comercial: string): BriefingSectionItem[] => {
    const sections: BriefingSectionItem[] = [];

    // Prioridade base
    let pRisco = 10;
    let pPatio = 20;
    let pComercial = 30;

    const firstTopic = topicosPersonalizados[0]?.topico || '';
    if (firstTopic.includes('cmv') || firstTopic.includes('oleo')) {
      pRisco = 5; // CMV e Caixa ganham prioridade absoluta
    } else if (firstTopic.includes('peca') || firstTopic.includes('patio') || firstTopic.includes('travado')) {
      pPatio = 5; // Pátio e peças sobem para primeiro lugar
    } else if (firstTopic.includes('meta')) {
      pComercial = 5; // Comercial sobe para primeiro lugar
    }

    // Inclui tópicos personalizados no topo se confirmados
    topicosPersonalizados.forEach((t, idx) => {
      sections.push({
        key: `custom_${t.topico}`,
        title: t.titulo,
        content: t.detalhe,
        priority: idx + 1
      });
    });

    sections.push({ key: 'riscoFinanceiro', title: 'Risco de Caixa', content: risco, priority: pRisco });
    sections.push({ key: 'gargaloPatio', title: 'Gargalo de Pátio', content: patio, priority: pPatio });
    sections.push({ key: 'eficienciaComercial', title: 'Desempenho Comercial', content: comercial, priority: pComercial });

    sections.sort((a, b) => a.priority - b.priority);
    return sections;
  };

  return new Promise((resolve) => {
    let customPromptSection = '';
    if (topicosPersonalizados.length > 0) {
      customPromptSection = `\nTÓPICOS PERSONALIZADOS DO DESTINATÁRIO (Até 2 tópicos verificados no banco):\n` +
        topicosPersonalizados.map(t => `- ${t.titulo}: ${t.detalhe}`).join('\n');
    }

    const prompt = `Você é o Diretor Operacional da rede Mecânica Popular / Tork.
Gere 3 bullets ultra-secos para WhatsApp da Diretoria.

DADOS BRUTOS DA REDE:
- Caixa sem sinal: ${fmtMoeda(totalExpostoSemSinal)} (${qtdAlertas} OSs). Maior: ${lojaMaisExposta ? `${lojaMaisExposta[0]} (${fmtMoeda(lojaMaisExposta[1])})` : 'Nenhum'}
- Pátio >= 5 dias: ${qtdTravados} carros de ${dados.totalPatioAtivo} (${pctTravados}%). Maior: ${lojaMaiorRetencao ? `${lojaMaiorRetencao[0]} (${lojaMaiorRetencao[1]} carros)` : 'Nenhum'}
- Faturamento: ${fmtMoeda(dados.faturamentoTotal)} em ${dados.totalOSs} OSs. TK: ${fmtMoeda(dados.ticketMedioRede)}. Top 1: ${top1?.nome || ''} (${fmtMoeda(top1?.faturamentoMes || 0)}), Top 2: ${top2?.nome || ''} (${fmtMoeda(top2?.faturamentoMes || 0)})
${customPromptSection}

RESTRIÇÕES ANTI-AI SLOP (RIGOROSO):
1. ZERO adjetivos: NUNCA use "robusto", "severo", "crítica", "sustentado por", "produtividade", "saúde comercial", "cenário promissor".
2. Máximo 1 linha por bullet. Apenas números, porcentagens e nomes das lojas.

SCHEMA JSON OBRIGATÓRIO:
{
  "riscoFinanceiro": "${defaultRisco}",
  "gargaloPatio": "${defaultPatio}",
  "eficienciaComercial": "${defaultComercial}"
}`;

    const args = ['-p', prompt, '--model', MODEL, '--output-format', 'json', '--dangerously-skip-permissions'];

    const startTime = Date.now();
    execFile(process.env.AGY_BIN_OVERRIDE || AGY_PATH, args, { maxBuffer: 1024 * 1024 * 5, timeout: 10000 }, (error, stdout) => {
      const duracaoMs = Date.now() - startTime;

      if (error) {
        const isTimeout = Boolean(error.killed || (error as any).signal === 'SIGTERM' || duracaoMs >= 9800);
        const status = isTimeout ? 'TIMEOUT' : 'UNAVAILABLE';
        console.warn(`[AI Briefing] Falha ao invocar agy (${status} em ${duracaoMs}ms: ${error.message}). Usando fórmulas determinísticas.`);

        if (db) {
          registrarTelemetriaIA(db, {
            modelo: MODEL,
            duracao_ms: duracaoMs,
            status,
            fallback_utilizado: 1,
            detalhe_erro: error.message
          });
        }

        return resolve({
          riscoFinanceiro: defaultRisco,
          gargaloPatio: defaultPatio,
          eficienciaComercial: defaultComercial,
          topicosPersonalizados,
          destinatario: options?.destinatario,
          orderedSections: buildOrderedSections(defaultRisco, defaultPatio, defaultComercial)
        });
      }

      try {
        let content = stdout.trim();
        try {
          const parsedCli = JSON.parse(content);
          if (parsedCli && parsedCli.response) {
            content = parsedCli.response.trim();
          }
        } catch {}

        if (content.includes('```json')) {
          content = content.split('```json')[1].split('```')[0].trim();
        } else if (content.includes('```')) {
          content = content.split('```')[1].split('```')[0].trim();
        }

        const jsonResult: BriefingIA = JSON.parse(content);

        // Gate Anti-Slop: se contiver qualquer clichê, substitui pelo baseline limpo
        const hasSlop = contemSlop(jsonResult.riscoFinanceiro || '') ||
                        contemSlop(jsonResult.gargaloPatio || '') ||
                        contemSlop(jsonResult.eficienciaComercial || '');

        const risco = contemSlop(jsonResult.riscoFinanceiro || '') ? defaultRisco : (jsonResult.riscoFinanceiro || defaultRisco);
        const patio = contemSlop(jsonResult.gargaloPatio || '') ? defaultPatio : (jsonResult.gargaloPatio || defaultPatio);
        const comercial = contemSlop(jsonResult.eficienciaComercial || '') ? defaultComercial : (jsonResult.eficienciaComercial || defaultComercial);

        const status = hasSlop ? 'SLOP_FALLBACK' : 'SUCCESS';
        if (db) {
          registrarTelemetriaIA(db, {
            modelo: MODEL,
            duracao_ms: duracaoMs,
            status,
            fallback_utilizado: hasSlop ? 1 : 0,
            detalhe_erro: hasSlop ? 'Substituição parcial ou total por filtro anti-slop' : undefined
          });
        }

        resolve({
          riscoFinanceiro: risco,
          gargaloPatio: patio,
          eficienciaComercial: comercial,
          topicosPersonalizados,
          destinatario: options?.destinatario,
          orderedSections: buildOrderedSections(risco, patio, comercial)
        });
      } catch (err: any) {
        console.warn(`[AI Briefing] Erro ao parsear JSON do agy (${duracaoMs}ms): ${err.message}. Usando fórmulas determinísticas.`);
        if (db) {
          registrarTelemetriaIA(db, {
            modelo: MODEL,
            duracao_ms: duracaoMs,
            status: 'INVALID_RESPONSE',
            fallback_utilizado: 1,
            detalhe_erro: err.message
          });
        }

        resolve({
          riscoFinanceiro: defaultRisco,
          gargaloPatio: defaultPatio,
          eficienciaComercial: defaultComercial,
          topicosPersonalizados,
          destinatario: options?.destinatario,
          orderedSections: buildOrderedSections(defaultRisco, defaultPatio, defaultComercial)
        });
      }
    });
  });
}
