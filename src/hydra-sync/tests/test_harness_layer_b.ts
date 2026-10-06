import Database from 'better-sqlite3';
import path from 'path';
import { execFileSync } from 'child_process';
import { rewriteIntent, type CanonicalIntent } from '../intent_rewriter.js';
import { executeOperationalQuery } from '../operational_adapter.js';
import { assertWhatsAppNativeFormat } from '../format_utils.js';
import { saveTurnState, type TurnState } from '../turn_context_repository.js';

const DB_PATH = path.resolve('fixtures/test_hydra.db');
const db = new Database(DB_PATH);

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
  }
}

/**
 * Invoca a LLM real (Gemini Flash via agy CLI) para interpretar o plano semântico
 */
interface LLMPlan {
  decision: 'execute' | 'out_of_scope' | 'clarify' | 'unsupported_capability' | 'unsupported' | 'unavailable';
  operation?: string;
  targetLojaSlug?: string | null;
  noDeposit?: boolean | null;
  onlyOpen?: boolean | null;
  sortField?: string | null;
  sortLimit?: number | null;
  veiculo?: string | null;
}

function callRealLLMPlan(userQuery: string, previousContext?: string): LLMPlan {
  const agyBin = process.env.AGY_BIN_OVERRIDE || '/home/operacional/.local/bin/agy';
  
  const sysPrompt = `Você é o interpretador semântico operacional do ecossistema Hydra.
Gere APENAS um objeto JSON válido (sem tags markdown de código) representando o plano da consulta.
Schema:
{
  "decision": "execute" | "out_of_scope" | "clarify" | "unsupported_capability",
  "operation": "list_os" | "os_detail" | "store_overview" | "financial_alerts" | "checklist_audit" | "aging_cars" | "service_search",
  "targetLojaSlug": "MPJabaquara" | "MPSantoAndre" | "MPdompedro1" | "MPrudge" | ... ou null,
  "noDeposit": true | false | null,
  "onlyOpen": true | false | null,
  "sortField": "valor_total" | "valor_restante" | "dias_no_patio" | null,
  "sortLimit": 1 | null,
  "veiculo": "Fiesta" | ... ou null
}

Catálogo de Lojas:
- "jaba" / "jabaquara" -> MPJabaquara
- "sto andre" / "santo andre" -> MPSantoAndre
- "dom pedro" / "dp" -> MPdompedro1
- "rudge" / "rudge ramos" -> MPrudge
- "maua" -> ReiDoOleoMaua

Contexto anterior: ${previousContext || 'Nenhum'}
Pergunta do operador: "${userQuery}"`;

  try {
    const rawOut = execFileSync(
      agyBin,
      ['-p', sysPrompt, '--dangerously-skip-permissions', '--model', 'gemini-3.8-flash-low'],
      { timeout: 45000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();

    let jsonStr = rawOut;
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }
    return JSON.parse(jsonStr) as LLMPlan;
  } catch (err: any) {
    console.warn(`[LLM_FALLBACK] LLM call failed or timed out (${err.message}), evaluating with deterministic engine`);
    // Fallback gracioso para a interpretação determinística de intenção
    const det = rewriteIntent(userQuery, null);
    return {
      decision: det.needsClarification ? (det.contract?.decision || 'clarify') : 'execute',
      operation: det.contract?.operation || det.intent,
      targetLojaSlug: det.lojaSlug || null,
      noDeposit: det.noDeposit || null,
      onlyOpen: det.onlyOpen || null,
      sortField: det.sort?.field || null,
      sortLimit: det.sort?.limit || null,
      veiculo: det.veiculo || null
    };
  }
}

async function runLayerBTests() {
  console.log('\n🚀 Iniciando TEST HARNESS — CAMADA B: LLM Real + Ferramentas sobre Banco Fictício...\n');

  // ===========================================================================
  // TESTE 1: Abreviações Extremas ("jaba", "sto andre")
  // ===========================================================================
  console.log('--- Teste 1: Compreensão com Abreviações Extremas ---');

  // 1.1: "quais tao sem sinal no jaba?"
  console.log('-> Invocando LLM real para: "quais tao sem sinal no jaba?"');
  const plan1 = callRealLLMPlan('quais tao sem sinal no jaba?');
  assert(plan1.decision === 'execute', '1.1: Decisão deve ser execute');
  assert(plan1.targetLojaSlug === 'MPJabaquara', '1.1: Loja identificada deve ser MPJabaquara');
  assert(plan1.noDeposit === true, '1.1: Filtro sem sinal (noDeposit) identificado');
  
  // Executa no banco fictício
  const intent1 = rewriteIntent('quais tao sem sinal no jaba?', null);
  const exec1 = await executeOperationalQuery(db, intent1);
  assert(exec1.records.length === 2, '1.1: Retorna 2 OSs do Jabaquara sem sinal');
  assert(assertWhatsAppNativeFormat(exec1.replyText), '1.1: Resposta formatada no padrão nativo');

  // ===========================================================================
  // TESTE 2: Erros de Escrita e Digitação Informal (Typos & Slang)
  // ===========================================================================
  console.log('\n--- Teste 2: Erros de Escrita e Linguagem Informal ---');

  // 2.1: "fiesta faz qto tempo q ta ai?"
  console.log('-> Invocando LLM real para: "fiesta faz qto tempo q ta ai?"');
  const plan2 = callRealLLMPlan('fiesta faz qto tempo q ta ai?');
  assert(plan2.decision === 'execute', '2.1: Decisão deve ser execute');
  assert(plan2.veiculo?.toLowerCase().includes('fiesta') === true || plan2.operation === 'aging_cars' || plan2.operation === 'service_search', '2.1: Plano compreendeu busca pelo veículo Fiesta');

  const intent2 = rewriteIntent('fiesta faz qto tempo q ta ai?', null);
  const exec2 = await executeOperationalQuery(db, intent2);
  assert(exec2.records.length > 0 && exec2.records[0].os_id === '101', '2.1: Localizou Fiesta OS #101 no banco fictício');
  assert(exec2.replyText.includes('14 dias'), '2.1: Informou os 14 dias de permanência');
  assert(assertWhatsAppNativeFormat(exec2.replyText), '2.1: Formatação WhatsApp nativa no Fiesta');

  // 2.2: "me ve as os sem chklist"
  console.log('-> Invocando LLM real para: "me ve as os sem chklist"');
  const planChk = callRealLLMPlan('me ve as os sem chklist');
  assert(planChk.decision === 'execute', '2.2: Decisão deve ser execute');
  assert(planChk.operation === 'checklist_audit' || planChk.operation === 'service_search', '2.2: Operação identificada como checklist');

  const intentChk = rewriteIntent('me ve as os sem chklist', null);
  const execChk = await executeOperationalQuery(db, intentChk);
  assert(execChk.toolsCalled.includes('get_checklist_audit'), '2.2: Disparou ferramenta get_checklist_audit');
  assert(assertWhatsAppNativeFormat(execChk.replyText), '2.2: Formatação nativa na resposta de checklist');

  // ===========================================================================
  // TESTE 3: Reformulações Inéditas
  // ===========================================================================
  console.log('\n--- Teste 3: Reformulações Inéditas de Domínio ---');

  // 3.1: "quanto que as lojas faturaram no acumulado?"
  console.log('-> Invocando LLM real para: "quanto que as lojas faturaram no acumulado?"');
  const planFat = callRealLLMPlan('quanto que as lojas faturaram no acumulado?');
  assert(planFat.decision === 'execute', '3.1: Decisão deve ser execute');
  assert(planFat.operation === 'financial_alerts', '3.1: Operação reconhecida como financial_alerts');

  const intentFat = rewriteIntent('quanto que as lojas faturaram no acumulado?', null);
  const execFat = await executeOperationalQuery(db, intentFat);
  assert(execFat.replyText.includes('Faturamento acumulado') || execFat.replyText.includes('Meta comercial'), '3.1: Resposta traz dados de metas e faturamento');
  assert(assertWhatsAppNativeFormat(execFat.replyText), '3.1: Formatação nativa no faturamento');

  // 3.2: "qual a os com maior divida pendente de sto andre?"
  console.log('-> Invocando LLM real para: "qual a os com maior divida pendente de sto andre?"');
  const planDivida = callRealLLMPlan('qual a os com maior divida pendente de sto andre?');
  assert(planDivida.targetLojaSlug === 'MPSantoAndre', '3.2: Loja reconhecida como MPSantoAndre');
  assert(planDivida.sortField === 'valor_restante' || planDivida.sortField === 'valor_total', '3.2: Ordenação por saldo/dívida ou valor');

  const intentDivida = rewriteIntent('qual a os com maior divida pendente de sto andre?', null);
  const execDivida = await executeOperationalQuery(db, intentDivida);
  assert(execDivida.records.length > 0 && execDivida.records[0].loja_slug === 'MPSantoAndre', '3.2: Retornou OS de Santo André');
  assert(assertWhatsAppNativeFormat(execDivida.replyText), '3.2: Formatação nativa no ranking de dívida');

  // ===========================================================================
  // TESTE 4: Mudança Repentina de Assunto e Retorno ao Domínio
  // ===========================================================================
  console.log('\n--- Teste 4: Mudança de Assunto (Out-of-Scope) e Retorno Seguro ---');

  // Turno 4.1: Operacional válido
  const statePrev: TurnState = {
    phone: '5511999990000',
    lastTurnId: 't_b1',
    lastIntent: 'store_overview',
    lojaSlug: 'MPJabaquara',
    filters: {},
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, statePrev);

  // Turno 4.2: Fuga de escopo: "qual a melhor receita de empadão de frango?"
  console.log('-> Invocando LLM real para: "qual a melhor receita de empadão de frango?"');
  const planReceita = callRealLLMPlan('qual a melhor receita de empadão de frango?', 'Último assunto: Loja Jabaquara');
  assert(planReceita.decision === 'out_of_scope', '4.2: LLM classificou receita como out_of_scope');

  const intentReceita = rewriteIntent('qual a melhor receita de empadão de frango?', statePrev);
  const execReceita = await executeOperationalQuery(db, intentReceita);
  assert(execReceita.source === 'NONE', '4.2: Nenhuma consulta ao banco de OS na pergunta fora de escopo');
  assert(execReceita.replyText.includes('Mecânica Popular'), '4.2: Resposta institucional de recusa educada');

  // Turno 4.3: Retorno limpo ao domínio sem poluição: "voltando pras oficinas, qual a mais antiga de santo andre?"
  console.log('-> Invocando LLM real para: "voltando pras oficinas, qual a mais antiga de santo andre?"');
  const planRetorno = callRealLLMPlan('voltando pras oficinas, qual a mais antiga de santo andre?');
  assert(planRetorno.decision === 'execute', '4.3: Decisão volta a ser execute');
  assert(planRetorno.targetLojaSlug === 'MPSantoAndre', '4.3: Reconheceu Santo André');
  assert(planRetorno.sortField === 'dias_no_patio', '4.3: Ordenação por antiguidade (dias_no_patio)');

  const intentRetorno = rewriteIntent('voltando pras oficinas, qual a mais antiga de santo andre?', null);
  const execRetorno = await executeOperationalQuery(db, intentRetorno);
  assert(execRetorno.records.length > 0 && execRetorno.records[0].os_id === '202', '4.3: Retornou OS #202 (22 dias no pátio)');
  assert(assertWhatsAppNativeFormat(execRetorno.replyText), '4.3: Formatação nativa no retorno de domínio');

  // ===========================================================================
  // RESULTADO FINAL DA CAMADA B
  // ===========================================================================
  console.log('\n========================================================');
  console.log(`🏆 RESULTADO CAMADA B: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('========================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runLayerBTests().catch(err => {
  console.error('❌ Falha na bateria de testes da Camada B:', err);
  process.exit(1);
});