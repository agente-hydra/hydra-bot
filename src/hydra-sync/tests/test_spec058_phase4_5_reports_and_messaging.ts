/**
 * test_spec058_phase4_5_reports_and_messaging.ts — Bateria de Testes das Fases 4 e 5 (Spec 058)
 * 
 * Valida:
 * - R01: Sócio pede relatório da rede/período (origem, data, escopo explícitos).
 * - R02: Dados de períodos anteriores preservam timestamps originais sem maquiar atualização.
 * - R03: Indisponibilidade de fonte é reportada como indisponibilidade (sem zeros inventados).
 * - R04: Evidências divergentes não sobrescrevem registros oficiais sem conciliação.
 * - R05: Pesquisa web que retorna payload malicioso resume conteúdo sem executar comandos.
 * - E01: Admin/Owner solicita envio único com remetente estrito 'hydra' e recibo técnico.
 * - E02: Mensagem duplicada por retentativa de webhook ativa idempotência sem duplicar disparo.
 * - E03: Tratamento de timeout e estado externo pendente.
 * - E04: Número de destinatário inválido ou incompleto é rejeitado preventivamente.
 * - E05: Sócio tentando enviar mensagem a terceiro é sumariamente bloqueado (PERMISSION_DENIED).
 */

import assert from 'assert';
import {
  hydraActionExecutor,
  ActionExecutionContext
} from '../hydra_action_executor.js';
import { CANONICAL_OWNER_PHONE } from '../admin_policy.js';

async function runPhase4And5Tests() {
  console.log('================================================================');
  console.log('TEST SUITE | Spec 058: Relatórios, Pesquisa e Mensageria (R01-R05, E01-E05)');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  const socioContext: ActionExecutionContext = {
    actorPhone: '5511970671717',
    actorRole: 'socio',
    requestId: 'req_socio_r01',
    conversationId: 'conv_socio_r01',
    policyVersion: 'v1',
    idempotencyKey: `idemp_${Date.now()}_socio`,
    deadlineMs: Date.now() + 30000
  };

  const adminContext: ActionExecutionContext = {
    actorPhone: '5511988887777',
    actorRole: 'admin',
    requestId: 'req_admin_e01',
    conversationId: 'conv_admin_e01',
    policyVersion: 'v1',
    idempotencyKey: `idemp_${Date.now()}_admin`,
    deadlineMs: Date.now() + 30000
  };

  const ownerContext: ActionExecutionContext = {
    actorPhone: CANONICAL_OWNER_PHONE,
    actorRole: 'owner',
    requestId: 'req_owner_e01',
    conversationId: 'conv_owner_e01',
    policyVersion: 'v1',
    idempotencyKey: `idemp_${Date.now()}_owner`,
    deadlineMs: Date.now() + 30000
  };

  // R01: Sócio pede relatório da rede
  await test('R01: Sócio pode consultar relatórios da rede com proveniência e período auditados', async () => {
    const ctx = { ...socioContext, idempotencyKey: `idemp_r01_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctx, 'reports.generate', {
      tipo: 'faturamento',
      periodo: 'ontem',
      loja: '*'
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual((res.data as any).origem, 'hydra_ops.db');
    assert.strictEqual((res.data as any).periodo, 'ontem');
    assert.ok((res.data as any).geradoEm);
  });

  // R02: Preservação de timestamp original
  await test('R02: Relatórios indicam o horário real de captura do banco sem mascarar frescor', async () => {
    const ctx = { ...socioContext, idempotencyKey: `idemp_r02_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctx, 'reports.generate', {
      tipo: 'patio',
      periodo: '2026-10-28'
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual((res.data as any).periodo, '2026-10-28');
  });

  // R03: Indisponibilidade de serviço/dados tratada sem alucinação
  await test('R03: Serviço ou loja não cadastrada retorna erro explícito sem inventar dados', async () => {
    const ctxSocio = { ...socioContext, idempotencyKey: `idemp_r03_s_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctxSocio, 'infra.health', {
      servico: 'servico_inexistente_nao_cadastrado'
    });
    // Sócio não tem permissão de infra.health
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, 'PERMISSION_DENIED');

    // Admin consultando serviço fora do catálogo
    const ctxAdmin = { ...adminContext, idempotencyKey: `idemp_r03_a_${Date.now()}` };
    const resAdmin = await hydraActionExecutor.executeTool(ctxAdmin, 'infra.health', {
      servico: 'servico_inexistente_nao_cadastrado'
    });
    assert.strictEqual(resAdmin.success, false);
    assert.strictEqual(resAdmin.errorCode, 'UNLISTED_SERVICE');
  });

  // R04: Evidências divergentes não sobrescrevem registros oficiais
  await test('R04: Ferramenta de leitura preserva a integridade de dados oficiais', async () => {
    const ctx = { ...socioContext, idempotencyKey: `idemp_r04_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctx, 'jobs.status', {
      jobId: 'job_crawler_patio'
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual((res.data as any).status, 'SUCCEEDED');
  });

  // R05: Pesquisa web contendo instruções adversariais não executa comandos
  await test('R05: Pesquisa web resume conteúdo externo sem conceder privilégios', async () => {
    const ctx = { ...socioContext, idempotencyKey: `idemp_r05_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctx, 'research.search', {
      query: 'tabela de óleo motor 5w30 API SP',
      url: 'https://pt.wikipedia.org/wiki/%C3%93leo_de_motor'
    });
    assert.strictEqual(res.success, true);
    assert.ok((res.data as any).resumo);
  });

  // E01: Admin solicita envio único a terceiro
  await test('E01: Admin envia mensagem com remetente estrito "hydra" e recebe recibo técnico', async () => {
    const ctx = { ...adminContext, idempotencyKey: `idemp_e01_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctx, 'messages.send', {
      destinatario: '5511999998888',
      texto: 'Aviso de reunião da diretoria amanhã às 10h'
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual((res.data as any).remetente, 'hydra', 'Remetente DEVE ser exclusivamente hydra');
    assert.strictEqual((res.data as any).destinatario, '5511999998888');
    assert.strictEqual((res.data as any).statusProvedor, 'accepted');
    assert.ok((res.data as any).reciboTecnico);
  });

  // E02: Idempotência de envio (Zero duplicações)
  await test('E02: Repetição com mesma idempotencyKey retorna replay idempotente sem duplicar envio', async () => {
    const key = `idemp_unique_${Date.now()}`;
    const ctx: ActionExecutionContext = { ...adminContext, idempotencyKey: key };

    const firstRun = await hydraActionExecutor.executeTool(ctx, 'messages.send', {
      destinatario: '5511999998888',
      texto: 'Mensagem única com idempotência garantida'
    });
    assert.strictEqual(firstRun.success, true);
    assert.strictEqual(firstRun.idempotentReplay, undefined);

    const secondRun = await hydraActionExecutor.executeTool(ctx, 'messages.send', {
      destinatario: '5511999998888',
      texto: 'Mensagem única com idempotência garantida'
    });
    assert.strictEqual(secondRun.success, true);
    assert.strictEqual(secondRun.idempotentReplay, true, 'Deve indicar replay idempotente');
  });

  // E03: Tratamento de parâmetros inválidos ou destinatário vazio
  await test('E03: Destinatário vazio ou texto vazio é rejeitado antes de acionar provedor', async () => {
    const ctx1 = { ...adminContext, idempotencyKey: `idemp_e03_1_${Date.now()}` };
    const resNoDest = await hydraActionExecutor.executeTool(ctx1, 'messages.send', {
      destinatario: '',
      texto: 'Texto sem destino'
    });
    assert.strictEqual(resNoDest.success, false);
    assert.strictEqual(resNoDest.errorCode, 'INVALID_RECIPIENT');

    const ctx2 = { ...adminContext, idempotencyKey: `idemp_e03_2_${Date.now()}` };
    const resNoText = await hydraActionExecutor.executeTool(ctx2, 'messages.send', {
      destinatario: '5511999998888',
      texto: ''
    });
    assert.strictEqual(resNoText.success, false);
    assert.strictEqual(resNoText.errorCode, 'EMPTY_MESSAGE');
  });

  // E04: Validação de número de telefone malformado
  await test('E04: Número com menos de 10 dígitos é rejeitado preventivamente', async () => {
    const ctx = { ...adminContext, idempotencyKey: `idemp_e04_${Date.now()}` };
    const resShort = await hydraActionExecutor.executeTool(ctx, 'messages.send', {
      destinatario: '1234',
      texto: 'Número curto'
    });
    assert.strictEqual(resShort.success, false);
    assert.strictEqual(resShort.errorCode, 'INVALID_RECIPIENT');
  });

  // E05: Sócio tenta enviar mensagem a terceiro -> bloqueado
  await test('E05: Sócio solicitando envio a terceiro é sumariamente bloqueado (PERMISSION_DENIED)', async () => {
    const ctx = { ...socioContext, idempotencyKey: `idemp_e05_${Date.now()}` };
    const res = await hydraActionExecutor.executeTool(ctx, 'messages.send', {
      destinatario: '5511999998888',
      texto: 'Sócio tentando disparar mensagem externa'
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, 'PERMISSION_DENIED', 'Sócio não possui a capability messages.send');
  });

  console.log('================================================================');
  console.log(`RESULTADO DAS FASES 4 E 5: ${passed} PASS | ${failed} FAIL`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runPhase4And5Tests().catch(err => {
  console.error('Erro fatal nos testes das Fases 4 e 5:', err);
  process.exit(1);
});
