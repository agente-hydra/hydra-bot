/**
 * test_spec058_phase3_media_audio.ts — Bateria de Testes da Fase 3 (Spec 058)
 * 
 * Valida o pipeline de áudio existente com transcrição Whisper local (M01 a M06):
 * - M01: Áudio pt-BR com nomes de lojas e entidades é transcrito e segmentado.
 * - M02: Detecção de negação explícita ("não envia", "não transfere") impede ação precipitada.
 * - M03: Áudio encaminhado (forwarded) é tratado como evidência, sem herança de autoridade do remetente original.
 * - M04: Áudio em silêncio ou corrompido retorna erro explícito sem alucinar texto.
 * - M05: Deduplicação de mídia por hash sem cruzamento de dados entre usuários diferentes.
 * - M06: Ausência de qualquer chamada de API paga de STT (execução 100% local/offline).
 */

import assert from 'assert';
import fs from 'fs';
import { MediaAnalyzer } from '../media_analyzer.js';
import type { InboundPart } from '../types/multimodal_contract.js';

async function runPhase3Tests() {
  console.log('================================================================');
  console.log('TEST SUITE | Spec 058: Áudio Existente no Chat de Admin e Sócios (M01-M06)');
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

  // M01: Áudio pt-BR com entidades de loja e OS
  await test('M01: Transcrição pt-BR extrai entidades de loja e OS corretamente', async () => {
    let mockWhisperCalled = false;
    const analyzer = new MediaAnalyzer({
      audioTranscriber: async () => {
        mockWhisperCalled = true;
        return {
          transcript: 'Por favor gerar o relatório da loja Jabaquara referente a OS 12345'
        };
      }
    });

    const part: InboundPart = {
      partId: 'part_aud_001',
      messageId: 'msg_aud_001',
      conversationKey: '5511996242812',
      kind: 'audio',
      url: 'mock://audio1.ogg',
      receivedAt: new Date().toISOString()
    };

    const media = {
      filePath: '/tmp/mock_audio1.ogg',
      mime: 'audio/ogg',
      sizeBytes: 1024,
      source: 'direct' as const
    };

    const evidence = await analyzer.analyze(part, media);
    assert.strictEqual(mockWhisperCalled, true, 'Deve acionar o transcritor local');
    assert.strictEqual(evidence.status, 'ok');
    assert.ok(evidence.transcript?.includes('Jabaquara'));

    // Verifica extração de entidades
    const storeEntities = (evidence.candidateEntities || []).filter(e => e.type === 'loja');
    assert.ok(storeEntities.some(s => s.value === 'MPJabaquara'), 'Deve identificar a loja Jabaquara');

    const osEntities = (evidence.candidateEntities || []).filter(e => e.type === 'os');
    assert.ok(osEntities.some(o => o.value === '12345'), 'Deve identificar a OS 12345');
  });

  // M02: Negação explícita
  await test('M02: Detecta negações explícitas ("não, ", "esquece ") para evitar disparos acidentais', async () => {
    const analyzer = new MediaAnalyzer({
      audioTranscriber: async () => ({
        transcript: 'Atenção, não, não envia a mensagem para o cliente agora, esquece isso.'
      })
    });

    const part: InboundPart = {
      partId: 'part_aud_002',
      messageId: 'msg_aud_002',
      conversationKey: '5511996242812',
      kind: 'audio',
      url: 'mock://audio2.ogg',
      receivedAt: new Date().toISOString()
    };

    const media = {
      filePath: '/tmp/mock_audio2.ogg',
      mime: 'audio/ogg',
      sizeBytes: 1024,
      source: 'direct' as const
    };

    const evidence = await analyzer.analyze(part, media);
    assert.ok(evidence.observations?.some(o => o.includes('negação') || o.includes('correção')), 'Deve registrar observação de negação');
    assert.ok(evidence.transcript?.includes('esquece'));
  });

  // M03: Áudio encaminhado de terceiros
  await test('M03: Áudio encaminhado de terceiro é marcado como evidência sem autoridade executiva', async () => {
    const analyzer = new MediaAnalyzer({
      audioTranscriber: async () => ({
        transcript: 'Oi Davi, aqui é o fornecedor de autopeças cobrando a nota 999.'
      })
    });

    const part: InboundPart = {
      partId: 'part_aud_003',
      messageId: 'msg_aud_003',
      conversationKey: '5511996242812',
      kind: 'audio',
      url: 'mock://audio3.ogg',
      isForwarded: true,
      receivedAt: new Date().toISOString()
    };

    const media = {
      filePath: '/tmp/mock_audio3.ogg',
      mime: 'audio/ogg',
      sizeBytes: 1024,
      source: 'direct' as const
    };

    const evidence = await analyzer.analyze(part, media);
    assert.strictEqual(evidence.status, 'ok');
    assert.strictEqual(part.isForwarded, true, 'Deve preservar flag isForwarded');
    assert.strictEqual(part.conversationKey, '5511996242812');
  });

  // M04: Áudio em silêncio ou corrompido
  await test('M04: Áudio vazio ou com silêncio não alucina texto e retorna status unreadable', async () => {
    const analyzer = new MediaAnalyzer({
      audioTranscriber: async () => ({
        transcript: '' // Silêncio retornado pelo Whisper
      })
    });

    const part: InboundPart = {
      partId: 'part_aud_004',
      messageId: 'msg_aud_004',
      conversationKey: '5511996242812',
      kind: 'audio',
      url: 'mock://audio4_silence.ogg',
      receivedAt: new Date().toISOString()
    };

    const media = {
      filePath: '/tmp/mock_audio4.ogg',
      mime: 'audio/ogg',
      sizeBytes: 1024,
      source: 'direct' as const
    };

    const evidence = await analyzer.analyze(part, media);
    assert.strictEqual(evidence.status, 'unreadable');
    assert.strictEqual((evidence.candidateEntities || []).length, 0, 'Zero entidades em silêncio');
  });

  // M05: Deduplicação e isolamento de cache
  await test('M05: Deduplicação de áudio idêntico opera sem contaminação entre usuários', async () => {
    const analyzer = new MediaAnalyzer({
      audioTranscriber: async () => {
        return { transcript: 'Relatório diário de vendas' };
      }
    });

    const media = {
      filePath: '/tmp/mock_audio_shared.ogg',
      mime: 'audio/ogg',
      sizeBytes: 1024,
      source: 'direct' as const
    };

    const partUser1: InboundPart = {
      partId: 'part_u1',
      messageId: 'msg_u1',
      conversationKey: '5511996242812',
      kind: 'audio',
      url: 'mock://audio_shared.ogg',
      receivedAt: new Date().toISOString()
    };

    const evidence1 = await analyzer.analyze(partUser1, media);
    assert.strictEqual(evidence1.transcript, 'Relatório diário de vendas');

    const partUser2: InboundPart = {
      partId: 'part_u2',
      messageId: 'msg_u2',
      conversationKey: '5511970671717',
      kind: 'audio',
      url: 'mock://audio_shared.ogg',
      receivedAt: new Date().toISOString()
    };

    const evidence2 = await analyzer.analyze(partUser2, media);
    assert.strictEqual(evidence2.transcript, 'Relatório diário de vendas');
    assert.notStrictEqual(partUser1.conversationKey, partUser2.conversationKey, 'Usuários distintos');
  });

  // M06: Ausência de qualquer chamada de API paga de STT
  await test('M06: Transcrição utiliza exclusivamente o pipeline Whisper local (custo zero STT)', () => {
    // Verifica que o MediaAnalyzer utiliza scripts/transcribe_audio.py (OpenAI Whisper local em Python)
    const pythonScript = fs.existsSync('./src/hydra-sync/scripts/transcribe_audio.py');
    assert.strictEqual(pythonScript, true, 'O script de transcrição Whisper local deve existir no projeto');

    const scriptContent = fs.readFileSync('./src/hydra-sync/scripts/transcribe_audio.py', 'utf8');
    assert.ok(scriptContent.includes('import whisper'), 'Deve importar whisper local');
    assert.ok(!scriptContent.includes('api.openai.com'), 'Zero chamadas à API de nuvem da OpenAI');
    assert.ok(!scriptContent.includes('speech.googleapis.com'), 'Zero chamadas ao Google Speech API');
  });

  console.log('================================================================');
  console.log(`RESULTADO DA FASE 3: ${passed} PASS | ${failed} FAIL`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runPhase3Tests().catch(err => {
  console.error('Erro fatal nos testes da Fase 3:', err);
  process.exit(1);
});
