/**
 * TEST HARNESS — BATCHER, CONVERSA MULTIMODAL & CMV MULTIESCOPO DO HYDRA
 * Validação rigorosa dos requisitos da Missão 2:
 * 1. Agrupamento de Mensagens Encavaladas (Janela deslizante 700ms - 2000ms ceiling)
 * 2. Correção Intra-Lote ("da jorge" + "não, da rede")
 * 3. CMV Multiescopo: Rede (18.64% ponderado), Lojas (ranking) e Loja Individual
 * 4. Resolução da Pior Loja ("Qual a pior?")
 * 5. Rejeição Estrita de Slugs Inválidos ('LOJA', 'lojas', 'rede', '')
 * 6. Evidências Multimodais (Áudio transcrito, Placa candidata em imagem, Discrepância de documento, Out-of-Scope)
 * 7. Integridade de Timestamps (capturedAt, NUNCA data_fim)
 * 8. Conformidade Nativa WhatsApp (Anti-Slop: zero **, zero markdown tables)
 */

import Database from 'better-sqlite3';
import { MessageBatcher } from '../message_batcher.js';
import { rewriteIntent } from '../intent_rewriter.js';
import { executeOperationalQuery } from '../operational_adapter.js';
import {
  queryNetworkCMV,
  queryAllStoresCMV,
  queryStoreCMV,
  queryUnifiedCMV,
  CATALOGO_10_LOJAS
} from '../db_repository.js';
import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat
} from '../format_utils.js';
import type { InboundPart, MediaEvidence } from '../types/conversation_contract.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
  }
}

async function runTests() {
  console.log('🧪 Iniciando TEST HARNESS: Batcher, CMV Multiescopo & Conversa Multimodal...\n');

  const db = new Database('/home/operacional/hydra-data/hydra_ops.db');
  db.pragma('journal_mode = WAL');

  // ===========================================================================
  // 1. TESTE DE ENCAVALAMENTO: Agrupamento de Mensagens Próximas (700ms sliding)
  // ===========================================================================
  console.log('--- 1. Agrupamento de Mensagens Encavaladas (MessageBatcher) ---');
  {
    const batcher = new MessageBatcher({ debounceMs: 150, maxWindowMs: 500, db });
    let resolvedBatch: any = null;

    const part1: InboundPart = {
      partId: 'p1',
      messageId: `msg_${Date.now()}_1`,
      conversationKey: '5511996242812',
      kind: 'text', type: 'text', receivedAt: new Date().toISOString(),
      text: 'qual o CMV',
      timestamp: Date.now()
    };

    const part2: InboundPart = {
      partId: 'p2',
      messageId: `msg_${Date.now()}_2`,
      conversationKey: '5511996242812',
      kind: 'text', type: 'text', receivedAt: new Date().toISOString(),
      text: 'da rede',
      timestamp: Date.now() + 50
    };

    batcher.addMessage(part1, undefined, async (b) => {
      resolvedBatch = b;
    });

    // Envia part2 50ms depois (dentro da janela de 150ms)
    await new Promise(r => setTimeout(r, 50));
    batcher.addMessage(part2, undefined, async (b) => {
      resolvedBatch = b;
    });

    // Aguarda o fechamento do lote
    await new Promise(r => setTimeout(r, 250));

    assert(resolvedBatch !== null, '1.1: Lote de mensagens fechado após janela');
    assert(resolvedBatch?.messageIds?.length === 2, '1.1: Lote reuniu exatamente os 2 messageIds');
    assert(resolvedBatch?.combinedText === 'qual o CMV da rede', '1.1: Texto unificado sem truncar: "qual o CMV da rede"');
    assert(resolvedBatch?.conversationKey === '5511996242812', '1.1: Chave de conversa preservada');

    // Interpretação do lote combinado
    const intent = rewriteIntent(resolvedBatch.combinedText, null, { batch: resolvedBatch });
    assert(intent.intent === 'store_cmv', '1.2: Intenção resolvida como store_cmv');
    assert(intent.scope === 'network', '1.2: Escopo resolvido como network');
    assert(intent.lojaSlug === undefined, '1.2: Loja é undefined (escopo de rede)');
    assert(intent.contract?.messageIds?.length === 2, '1.2: Contrato carrega todos os messageIds do lote');

    batcher.destroy();
  }

  // ===========================================================================
  // 2. TESTE DE CORREÇÃO INTRA-LOTE: "da jorge" + "não, da rede"
  // ===========================================================================
  console.log('\n--- 2. Correção Intra-Lote ("da jorge" + "não, da rede") ---');
  {
    const batcher = new MessageBatcher({ debounceMs: 150, maxWindowMs: 500, db });
    let resolvedBatch: any = null;

    const part1: InboundPart = {
      partId: 'p_corr_1',
      messageId: `msg_corr_${Date.now()}_1`,
      conversationKey: '5511996242812',
      kind: 'text', type: 'text', receivedAt: new Date().toISOString(),
      text: 'qual o cmv da jorge',
      timestamp: Date.now()
    };

    const part2: InboundPart = {
      partId: 'p_corr_2',
      messageId: `msg_corr_${Date.now()}_2`,
      conversationKey: '5511996242812',
      kind: 'text', type: 'text', receivedAt: new Date().toISOString(),
      text: 'não, da rede',
      timestamp: Date.now() + 50
    };

    batcher.addMessage(part1, undefined, async (b) => {
      resolvedBatch = b;
    });

    await new Promise(r => setTimeout(r, 50));
    batcher.addMessage(part2, undefined, async (b) => {
      resolvedBatch = b;
    });

    await new Promise(r => setTimeout(r, 250));

    assert(resolvedBatch !== null, '2.1: Lote de correção resolvido');
    const intent = rewriteIntent(resolvedBatch.combinedText, null, { batch: resolvedBatch });
    assert(intent.intent === 'store_cmv', '2.2: Intenção store_cmv');
    assert(intent.scope === 'network', '2.2: Escopo resolvido para network devido à retificação');
    assert(intent.lojaSlug === undefined, '2.2: Jorge Beretta foi desconsiderada após "não, da rede"');

    const result = await executeOperationalQuery(db, intent);
    assert(result.replyText.includes('CMV da Rede'), '2.3: Resposta é sobre a rede consolidada');
    assert(!result.replyText.includes('CMV: Jorge Beretta'), '2.3: Não exibe card exclusivo da Jorge Beretta');

    batcher.destroy();
  }

  // ===========================================================================
  // 3. TESTE DE ISOLAMENTO DE CONVERSAS: Davi vs Marcos
  // ===========================================================================
  console.log('\n--- 3. Isolamento entre Conversas Diferentes no Batcher ---');
  {
    const batcher = new MessageBatcher({ debounceMs: 150, maxWindowMs: 500, db });
    const batchesMap = new Map();

    const pDavi: InboundPart = {
      partId: 'p_davi',
      messageId: `msg_davi_${Date.now()}`,
      conversationKey: '5511996242812',
      kind: 'text', type: 'text', receivedAt: new Date().toISOString(),
      text: 'CMV de Santo André',
      timestamp: Date.now()
    };

    const pMarcos: InboundPart = {
      partId: 'p_marcos',
      messageId: `msg_marcos_${Date.now()}`,
      conversationKey: '5511970671717',
      kind: 'text', type: 'text', receivedAt: new Date().toISOString(),
      text: 'CMV da rede',
      timestamp: Date.now()
    };

    batcher.addMessage(pDavi, undefined, async (b) => {
      batchesMap.set('davi', b);
    });

    batcher.addMessage(pMarcos, undefined, async (b) => {
      batchesMap.set('marcos', b);
    });

    await new Promise(r => setTimeout(r, 250));

    assert(batchesMap.has('davi') && batchesMap.has('marcos'), '3.1: Ambos os lotes foram processados separadamente');
    assert(batchesMap.get('davi').conversationKey === '5511996242812', '3.1: Lote Davi isolado');
    assert(batchesMap.get('marcos').conversationKey === '5511970671717', '3.1: Lote Marcos isolado');
    assert(batchesMap.get('davi').combinedText === 'CMV de Santo André', '3.2: Texto de Davi não vazou');
    assert(batchesMap.get('marcos').combinedText === 'CMV da rede', '3.2: Texto de Marcos não vazou');

    batcher.destroy();
  }

  // ===========================================================================
  // 4. TESTE DE CMV DA REDE (Cálculo Ponderado Real & Governança)
  // ===========================================================================
  console.log('\n--- 4. CMV da Rede (Cálculo Ponderado, Parcial e Timestamp) ---');
  {
    const netResult = queryNetworkCMV(db);
    assert(netResult.status === 'parcial' || netResult.status === 'sucesso', '4.1: Status de apuração da rede');
    assert(netResult.scope === 'network', '4.1: Escopo é network');
    assert(netResult.cmvConsolidadoPercentual === 18.64, '4.2: CMV Consolidado é exatamente 18.64% (razão ponderada, NÃO média 19.14%)');
    assert(netResult.somaCustosCompativeis === 63556.72, '4.2: Soma dos custos compatíveis R$ 63.556,72');
    assert(netResult.somaFaturamentosBaseCompativeis === 340885.21, '4.2: Soma do faturamento base R$ 340.885,21');
    assert(netResult.lucroBrutoConsolidado === 277328.49, '4.2: Lucro bruto consolidado R$ 277.328,49');
    assert(netResult.cobertura.masterExcluida === true, '4.3: Unidade Master estritamente excluída');
    assert(netResult.cobertura.totalLojasElegiveis === 10, '4.3: Total de 10 lojas elegíveis');
    assert(netResult.lojasDetalhadas.length === 3, '4.3: Exatamente 3 lojas apuradas no banco real');

    const intent = rewriteIntent('qual o CMV da rede', null);
    const execRes = await executeOperationalQuery(db, intent);
    const reply = execRes.replyText;

    assert(reply.includes('CMV da Rede (Parcial — 3 de 10 lojas)'), '4.4: Rótulo de apuração parcial explícito');
    assert(reply.includes('18.64%'), '4.4: CMV Consolidado 18.64% no texto');
    assert(reply.includes('R$ 63.556,72'), '4.4: Custo acumulado R$ 63.556,72');
    assert(reply.includes('R$ 340.885,21'), '4.4: Faturamento acumulado R$ 340.885,21');
    assert(reply.includes('Dom Pedro') && reply.includes('22.02%'), '4.4: Destaque da pior loja na rede');
    assert(reply.includes('Lojas Apuradas'), '4.5: Bloco de lojas apuradas presente');
    assert(reply.includes('Santo André') && reply.includes('Dom Pedro') && reply.includes('Jorge Beretta'), '4.5: Três lojas listadas');
    assert(reply.includes('Unidade Master desconsiderada'), '4.5: Ressalva da Master presente');

    // Timestamp: deve ser capturedAt, NUNCA data_fim (30/09)
    assert(!reply.includes('atualizados em 30/09/2026'), '4.6: NUNCA exibe data_fim (30/09) como atualização');
    assert(reply.includes('Atualizados em') || reply.includes('atualizados em'), '4.6: Data de atualização presente');

    assertNoDoubleAsterisks(reply);
    assertWhatsAppNativeFormat(reply);
  }

  // ===========================================================================
  // 5. TESTE DE CMV COMPARATIVO DAS LOJAS (scope: 'all_stores')
  // ===========================================================================
  console.log('\n--- 5. CMV Comparativo das Lojas ("CMV das lojas") ---');
  {
    const intent = rewriteIntent('CMV das lojas', null);
    assert(intent.intent === 'store_cmv', '5.1: Intenção store_cmv');
    assert(intent.scope === 'all_stores', '5.1: Escopo all_stores');
    assert(intent.lojaSlug === undefined, '5.1: Loja é undefined (NÃO virou "LOJA")');

    const execRes = await executeOperationalQuery(db, intent);
    const reply = execRes.replyText;

    assert(reply.includes('CMV Comparativo das Lojas'), '5.2: Header comparativo das lojas');
    assert(reply.includes('Dom Pedro') && reply.includes('22.02%'), '5.2: Dom Pedro no ranking com 22.02%');
    assert(reply.includes('Jorge Beretta') && reply.includes('19.66%'), '5.2: Jorge Beretta no ranking com 19.66%');
    assert(reply.includes('Santo André') && reply.includes('15.73%'), '5.2: Santo André no ranking com 15.73%');
    assert(reply.includes('Lojas Pendentes (Dado não disponível no período)'), '5.3: Bloco de lojas pendentes');
    assert(reply.includes('Piraporinha:* dado não disponível'), '5.3: Piraporinha como dado não disponível (NUNCA 0.00%)');
    assert(reply.includes('Jabaquara:* dado não disponível'), '5.3: Jabaquara como dado não disponível');
    assert(!reply.includes('0.00%') && !reply.includes('0,00%'), '5.3: ZERO ausência mascarada como 0.00%');
    assert(!reply.includes('não há CMV da loja LOJA'), '5.4: ZERO mensagem espúria "não há CMV da loja LOJA"');

    assertNoDoubleAsterisks(reply);
    assertWhatsAppNativeFormat(reply);
  }

  // ===========================================================================
  // 6. TESTE DE PIOR LOJA EM CMV: "Qual a pior?"
  // ===========================================================================
  console.log('\n--- 6. Pior Loja por CMV ("Qual a pior?") ---');
  {
    // Contexto prévio de CMV da rede
    const prevTurn = {
      phone: '5511996242812',
      lastTurnId: 't_prev_cmv',
      lastIntent: 'store_cmv' as any,
      filters: { scope: 'network' } as any
    };

    const intent = rewriteIntent('Qual a pior?', prevTurn as any);
    assert(intent.intent === 'store_cmv', '6.1: Intenção store_cmv');
    assert(intent.subIntent === 'worst_store', '6.1: Sub-intenção worst_store');
    assert(intent.focusWorst === true, '6.1: focusWorst ativado');

    const execRes = await executeOperationalQuery(db, intent);
    const reply = execRes.replyText;

    assert(reply.includes('Pior Loja por CMV: Dom Pedro'), '6.2: Dom Pedro identificada como pior loja');
    assert(reply.includes('22.02%'), '6.2: CMV de 22.02% informado');
    assert(reply.includes('R$ 23.669,30'), '6.2: Custo de mercadorias R$ 23.669,30');
    assert(reply.includes('R$ 107.476,40'), '6.2: Faturamento base R$ 107.476,40');
    assert(reply.includes('Média consolidada da rede:* 18.64%'), '6.3: Comparativo com consolidado da rede');
    assert(reply.includes('+3.38 p.p. acima'), '6.3: Diferença percentual calculada (+3.38 p.p.)');

    assertNoDoubleAsterisks(reply);
    assertWhatsAppNativeFormat(reply);
  }

  // ===========================================================================
  // 7. TESTE DE REJEIÇÃO DE SLUGS INVÁLIDOS: '', 'LOJA', 'lojas', 'rede'
  // ===========================================================================
  console.log('\n--- 7. Rejeição de Slugs Inválidos (Blindagem Anti-Regressão) ---');
  {
    const slugsInvalidos = ['', 'LOJA', 'lojas', 'rede', 'todas', 'Loja'];

    for (const slug of slugsInvalidos) {
      const storeRes = queryStoreCMV(db, { lojaSlug: slug });
      assert(storeRes.status === 'erro' || storeRes.status === 'vazio', `7.1: Slug "${slug}" não executa query inválida`);
      assert(storeRes.cmvPercentual === null, `7.1: cmvPercentual é null para slug "${slug}"`);

      // Consulta unificada redireciona com segurança para network quando slug é inválido
      const uniRes = queryUnifiedCMV(db, { lojaSlug: slug });
      assert(uniRes.scope === 'network' || uniRes.status === 'erro', `7.2: queryUnifiedCMV com slug "${slug}" cai em network`);
    }
  }

  // ===========================================================================
  // 8. TESTE MULTIMODAL: Áudio, Imagem (Placa), Documento e Out-of-Scope
  // ===========================================================================
  console.log('\n--- 8. Conversa Multimodal: Áudio, Imagem, Documentos e Out-of-Scope ---');
  {
    // 8.1. Áudio com transcrição integrada
    const audioEvidence: MediaEvidence = {
      evidenceId: 'ev_audio_1',
      messageId: 'msg_audio_1',
      partId: 'part_audio_1',
      kind: 'audio', type: 'audio', status: 'ok', sourceMessageId: 'm1',
      transcription: 'qual o cmv da santo andre',
      confidence: 0.95
    };

    const audioBatch = {
      batchId: 'b_audio',
      conversationKey: '5511996242812',
      messageIds: ['msg_audio_1'],
      originalTexts: [''],
      parts: [],
      mediaEvidence: [audioEvidence],
      combinedText: 'qual o cmv da santo andre',
      firstReceivedAt: Date.now(),
      lastReceivedAt: Date.now(),
      isClosed: true
    };

    const intentAudio = rewriteIntent(audioBatch.combinedText, null, { batch: audioBatch, mediaEvidence: [audioEvidence] });
    assert(intentAudio.intent === 'store_cmv', '8.1: Áudio com transcrição reconhecido como store_cmv');
    assert(intentAudio.lojaSlug === 'MPSantoAndre', '8.1: Loja Santo André extraída da transcrição');

    // 8.2. Imagem com extração de placa candidata
    const imageEvidence: MediaEvidence = {
      evidenceId: 'ev_img_1',
      messageId: 'msg_img_1',
      partId: 'part_img_1',
      kind: 'image', type: 'image', status: 'ok', sourceMessageId: 'm2',
      extractedPlates: ['ABC1D23'],
      confidence: 0.92
    };

    const intentImg = rewriteIntent('e esse carro aqui?', null, { mediaEvidence: [imageEvidence] });
    assert(intentImg.placa === 'ABC1D23', '8.2: Placa ABC1D23 adotada a partir da evidência da imagem');
    assert(intentImg.intent === 'service_search', '8.2: Intenção service_search pela placa candidata');

    // 8.3. Documento com anotação de discrepância
    const docEvidence: MediaEvidence = {
      evidenceId: 'ev_doc_1',
      messageId: 'msg_doc_1',
      partId: 'part_doc_1',
      kind: 'document', type: 'document', status: 'ok', sourceMessageId: 'm3',
      extractedFinancialNumbers: [{ label: 'CMV Declarado', value: 16.5, unit: '%' }],
      discrepancyNote: 'O DRE anexo reporta CMV de 16.50%, divergindo em 0.77 p.p. do relatório oficial (15.73%).',
      confidence: 0.90
    };

    const intentDoc = rewriteIntent('qual o cmv de santo andré', null, { mediaEvidence: [docEvidence] });
    const resDoc = await executeOperationalQuery(db, intentDoc);
    assert(resDoc.replyText.includes('15.73%'), '8.3: Resposta traz o dado oficial da base');
    assert(resDoc.replyText.includes('Conciliação de Documento Anexo'), '8.3: Ressalva de conciliação do documento presente');
    assert(resDoc.replyText.includes('divergindo em 0.77 p.p.'), '8.3: Detalhe da discrepância documentada no texto');

    // 8.4. Mídia fora do escopo (receita/meme)
    const memeEvidence: MediaEvidence = {
      evidenceId: 'ev_meme_1',
      messageId: 'msg_meme_1',
      partId: 'part_meme_1',
      kind: 'image', type: 'image', status: 'ok', sourceMessageId: 'm2',
      isOutOfScope: true,
      confidence: 0.99
    };

    const intentMeme = rewriteIntent('olha essa foto', null, { mediaEvidence: [memeEvidence] });
    assert(intentMeme.contract?.decision === 'out_of_scope', '8.4: Decisão out_of_scope para imagem não operacional');
    assert(intentMeme.needsClarification === true, '8.4: needsClarification ativado para recusa educada');
  }

  console.log('\n========================================================');
  console.log(`🏆 RESULTADO FINAL BATCHER & CMV: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('========================================================');

  db.close();
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
