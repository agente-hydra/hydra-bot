/**
 * Test Suite: Validação do Roteador Determinístico com IA Indisponível (Spec 006)
 * Testa as 8 categorias essenciais + elipses garantindo que nenhuma consulta lance exceção.
 */

import { dispatchMessage } from '../agent_dispatcher.js';

// Força o erro na IA para testar 100% o motor determinístico (FALLBACK_API)
process.env.AGY_BIN_OVERRIDE = '/bin/false';

interface TestCase {
  categoria: string;
  pergunta: string;
  validador: (reply: string, motor: string) => boolean;
}

const testCases: TestCase[] = [
  {
    categoria: '1. Saudação',
    pergunta: 'Olá Hydra, boa tarde!',
    validador: (reply, motor) => reply.toLowerCase().includes('opa') || reply.toLowerCase().includes('ajudar')
  },
  {
    categoria: '2. Raio-X de Loja',
    pergunta: 'Como tá o Jabaquara?',
    validador: (reply, motor) => reply.includes('Raio-X Operacional: MPJabaquara') || reply.includes('Jabaquara')
  },
  {
    categoria: '3. Busca por Placa',
    pergunta: 'buscar placa ABC1D23',
    validador: (reply, motor) => reply.includes('Busca Operacional') || reply.includes('Nenhuma ordem de serviço localizada')
  },
  {
    categoria: '4. Busca por OS',
    pergunta: 'OS 55555',
    validador: (reply, motor) => reply.includes('Busca Operacional') || reply.includes('Nenhuma ordem de serviço localizada') || reply.includes('55555')
  },
  {
    categoria: '5. Pátio e Retenção',
    pergunta: 'carros parados há mais de 5 dias',
    validador: (reply, motor) => reply.includes('Veículos Retidos no Pátio') || reply.includes('veículos')
  },
  {
    categoria: '6. Desempenho e Metas',
    pergunta: 'como estão as metas e faturamento da rede?',
    validador: (reply, motor) => reply.includes('Desempenho Comercial') || reply.includes('Faturamento') || reply.includes('R$')
  },
  {
    categoria: '7. Checklist por Loja (Geral)',
    pergunta: 'checklist por loja',
    validador: (reply, motor) => reply.includes('Checklists Pendentes (Mecânico e Entrada) por Loja') && reply.includes('mecânico') && reply.includes('entrada')
  },
  {
    categoria: '7. Checklist Mecânico',
    pergunta: 'checklist mecânico',
    validador: (reply, motor) => reply.includes('Checklist do Mecânico')
  },
  {
    categoria: '7. Checklist Entrada',
    pergunta: 'checklist entrada',
    validador: (reply, motor) => reply.includes('Checklist de Entrada')
  },
  {
    categoria: '8. Pergunta de Continuação (Elipse)',
    pergunta: 'e em Mauá?',
    validador: (reply, motor) => reply.includes('Mauá') || reply.includes('ReiDoOleoMaua')
  }
];

async function runFallbackTests() {
  console.log('🚀 Iniciando Teste de Resiliência do Roteador Determinístico (IA Offline)...');
  const testPhone = '5511999990006';

  let passCount = 0;

  for (const tc of testCases) {
    console.log(`\nTesting: [${tc.categoria}] -> "${tc.pergunta}"`);
    try {
      const res = await dispatchMessage({
        phone: testPhone,
        message: tc.pergunta,
        conversationId: 99906,
        messageId: Math.floor(Math.random() * 100000)
      });

      if (!res.replyText || res.replyText.trim() === '') {
        throw new Error(`Resposta vazia para [${tc.categoria}]`);
      }

      const isValid = tc.validador(res.replyText, res.motor);
      if (!isValid) {
        console.error(`❌ Resposta inesperada:\n${res.replyText}`);
        throw new Error(`Validação falhou para [${tc.categoria}]`);
      }

      console.log(`  ✅ Motor: ${res.motor} | Latência: ${res.latenciaMs}ms`);
      console.log(`  Preview: ${res.replyText.split('\n')[0]}`);
      passCount++;
    } catch (err: any) {
      console.error(`❌ Erro no teste [${tc.categoria}]:`, err.message);
      throw err;
    }
  }

  console.log(`\n🎉 ========================================================`);
  console.log(`   SUCESSO! ${passCount}/${testCases.length} INTENÇÕES VALIDADAS SEM IA!`);
  console.log(`   ========================================================\n`);
}

runFallbackTests().catch(err => {
  console.error('\n❌ Falha na bateria de testes determinísticos:', err);
  process.exit(1);
});
