import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://127.0.0.1:3333/v1/jobs';
const API_KEY = 'your_secret_key_here'; // Usando a chave configurada no projeto
const CASES_FILE = path.resolve('docs/tests/oficina-business-cases.json');

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTDD() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: npx tsx run_tdd.ts <T1> <T2> ...');
    process.exit(1);
  }

  if (!fs.existsSync(CASES_FILE)) {
    console.error(`Arquivo de casos de teste não encontrado: ${CASES_FILE}`);
    process.exit(1);
  }

  const allCases: any[] = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  const targetCases = allCases.filter(c => args.some(arg => c.id === arg || c.id.startsWith(arg + '_')));

  if (targetCases.length === 0) {
    console.error(`Nenhum caso de teste encontrado para os prefixos: ${args.join(', ')}`);
    process.exit(1);
  }

  let allPassed = true;

  for (const tcase of targetCases) {
    console.log(`\n=============================================`);
    console.log(`🚀 Iniciando Caso de Teste: ${tcase.id}`);
    console.log(`=============================================`);

    const payload = {
      action: 'execute_workflow',
      params: {
        workflow_id: tcase.workflow_id,
        empresa: tcase.empresa,
        ...tcase.params
      }
    };
    console.log(`[DEBUG] Enviando payload:`, JSON.stringify(payload));

    console.log(`[1] Submetendo Job...`);
    const postRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!postRes.ok) {
      console.error(`❌ Falha ao submeter job HTTP ${postRes.status}`);
      const err = await postRes.text();
      console.error(err);
      allPassed = false;
      continue;
    }

    const postData = await postRes.json();
    const jobId = postData.job_id;
    console.log(`[2] Job Enfileirado: ${jobId}`);

    let completed = false;
    let jobData: any = null;

    console.log(`[3] Aguardando conclusão (polling)...`);
    while (!completed) {
      await sleep(5000);
      const getRes = await fetch(`${API_URL}/${jobId}`, {
        headers: { 'x-api-key': API_KEY }
      });

      if (!getRes.ok) {
        console.error(`❌ Falha no polling HTTP ${getRes.status}`);
        completed = true;
        allPassed = false;
        break;
      }

      jobData = await getRes.json();
      if (jobData.status === 'completed' || jobData.status === 'failed') {
        completed = true;
      } else {
        process.stdout.write('.');
      }
    }
    console.log('\n');

    if (!jobData || !jobData.result) {
       console.error(`❌ Job não retornou um bloco de 'result' válido.`);
       allPassed = false;
       continue;
    }

    const wfResult = jobData.result;
    const exp = tcase.expectations;

    let testPassed = true;

    // 1. Checar status
    if (wfResult.status !== exp.status) {
      console.error(`❌ Falha: Status esperado '${exp.status}', recebido '${wfResult.status}'.`);
      console.error(`❌ Detalhe do erro:`, wfResult.error || wfResult);
      if (wfResult.meta?.reason) console.error(`   Razão: ${wfResult.meta.reason}`);
      testPassed = false;
    } else {
      console.log(`✅ Status bateu: ${exp.status}`);
    }

    // 2. Checar campos de topo
    if (exp.status === 'success' && exp.fields) {
      if (!wfResult.result) {
         console.error(`❌ Falha: 'result' data is null.`);
         testPassed = false;
      } else {
         for (const field of exp.fields) {
          if (wfResult.result === null || wfResult.result === undefined || wfResult.result[field] === undefined) {
            console.error(`❌ Falha: Campo '${field}' ausente no resultado. Resultado atual:`, wfResult.result);
            testPassed = false;
          } else {
             console.log(`✅ Campo '${field}' encontrado: ${JSON.stringify(wfResult.result[field]).substring(0, 80)}...`);
           }
         }
      }
    }

    // 3. Checar campos dos itens de OS (T9)
    if (exp.status === 'success' && exp.os_item_fields && wfResult.result?.os) {
      const osList = wfResult.result.os;
      if (!Array.isArray(osList) || osList.length === 0) {
        console.error(`❌ Falha: 'result.os' deve ser um array não-vazio. Recebido:`, osList);
        testPassed = false;
      } else {
        const firstItem = osList[0];
        for (const field of exp.os_item_fields) {
          if (firstItem[field] === undefined) {
            console.error(`❌ Falha: Campo '${field}' ausente nos itens de OS. Primeiro item:`, firstItem);
            testPassed = false;
          } else {
            console.log(`✅ Campo OS[0].${field}: "${firstItem[field]}"`);
          }
        }
        console.log(`✅ Total de OS na lista: ${osList.length}`);
      }
    }

    // 4. Checar campos dos itens do resumo por mecânico (T10)
    if (exp.status === 'success' && exp.resumo_item_fields && wfResult.result?.resumo_por_mecanico) {
      const resumo = wfResult.result.resumo_por_mecanico;
      if (!Array.isArray(resumo) || resumo.length === 0) {
        console.error(`❌ Falha: 'result.resumo_por_mecanico' deve ser array não-vazio. Recebido:`, resumo);
        testPassed = false;
      } else {
        const firstItem = resumo[0];
        for (const field of exp.resumo_item_fields) {
          if (firstItem[field] === undefined) {
            console.error(`❌ Falha: Campo '${field}' ausente no resumo. Primeiro item:`, firstItem);
            testPassed = false;
          } else {
            console.log(`✅ Campo resumo[0].${field}: "${firstItem[field]}"`);
          }
        }
        console.log(`✅ Total de mecânicos no resumo: ${resumo.length}`);
        console.log(`   Top responsável: ${resumo[0].mecanico} (${resumo[0].quantidade_os} OS)`);
      }
    }


    if (testPassed) {
      console.log(`\n🎉 TESTE PASSOU: ${tcase.id}`);
    } else {
      console.log(`\n💥 TESTE FALHOU: ${tcase.id}`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log(`\n✅ TODOS OS TESTES PASSARAM!`);
    process.exit(0);
  } else {
    console.log(`\n❌ HOUVERAM FALHAS NOS TESTES.`);
    process.exit(1);
  }
}

runTDD().catch(err => {
  console.error('Erro fatal no runner:', err);
  process.exit(1);
});
