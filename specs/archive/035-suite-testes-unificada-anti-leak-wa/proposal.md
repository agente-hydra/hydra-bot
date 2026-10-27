# Spec 035 — Suíte Unificada de Testes e Zero-Leak WhatsApp Guard

**Criado:** 2026-10-27  
**ID:** `035-suite-testes-unificada-anti-leak-wa`  
**Status:** PROPOSAL

---

## 1. Problema

1. **Risco Crítico de Vazamento de Mensagens em Testes (Zero-Leak Problem):**
   - Atualmente, a proteção contra envio de mensagens depende exclusivamente da passagem manual da flag `--dry-run` em scripts de teste e orquestradores.
   - Se um script de teste for executado por engano sem `--dry-run`, ou se uma função interna invocar `sendText` / `sendDocument`, mensagens reais são disparadas imediatamente via Evolution API para gerentes, diretoria ou grupos autorizados.
   - O projeto precisa de uma **trava incondicional de sandbox em nível de transporte** (Mock Guard), onde qualquer execução em modo de teste seja fisicamente impedida de tocar a rede de WhatsApp.

2. **Fragmentação de Testes:**
   - Existem dezenas de arquivos soltos (`test_excel_processor.js`, `test_excel_processor_pix.js`, `test_conciliacao_patio_rede.js`, `test_cmv_kpi_gerentes.js`, etc.).
   - O script `scripts/suite_testes_integridade.js` existente está defasado: possui apenas 5 blocos legados e **não cobre** as inovações das Specs 032, 033 e 034 (Watchdog 06:00 AM, Sanity Gate Pátio x Rede, Cutoff Gate 19:30, Expurgo de PIX e Alertas de CMV por Gerente).
   - O comando `npm test` no `package.json` da VPS retorna erro `"Error: no test specified"`.

---

## 2. Solução Proposta

### 2.1. Zero-Leak WhatsApp Sandbox Guard (Interceptor de Nível de Transporte)
Implementar uma trava de hardware/software no nível do `whatsapp_patio_dispatcher.js` e `whatsapp_unified_dispatcher.js`:
- Quando `process.env.HYDRA_TEST_MODE === '1'`, `process.env.EVO_DRY_RUN === '1'` ou `global.__HYDRA_MOCK_WA__ === true`:
  - `sendText()` e `sendDocument()` **NUNCA** realizam chamada HTTP para a Evolution API.
  - A requisição é interceptada em memória, auditada em uma fila de inspeção (`global.__HYDRA_MOCKED_MESSAGES__`) e retorna instantaneamente `{ ok: true, mocked: true, target: number, ... }`.
  - Impossibilidade física de vazamento de mensagens durante suítes de teste ou execuções de validação.

### 2.2. Suíte Unificada de Testes (`scripts/suite_testes_integridade.js`)
Reestruturar a suíte em **8 Blocos Determinísticos** de teste:
1. **[Bloco 1] Banco SQLite & Estrutura Operacional:** Integridade física (`PRAGMA integrity_check`), modo WAL, tabelas essenciais (`ordens_servico`, `cmv_lojas`, `hydra_store_managers`, etc.).
2. **[Bloco 2] Oficina Integrada & Pátio Engine:** Freshness dos crawls (`os_store_*.json`), extração de pátio ativo e contagem de checklists do mecânico.
3. **[Bloco 3] Motor Rede & Pureza Contábil:** Resolução de datas, mapeamento das 10 lojas, Cutoff Gate 19:30 BRT e **Expurgo Estrito de PIX** (garantir 0 PIX na aba de cartões).
4. **[Bloco 4] Conciliação Pátio x Rede & Sanity Gate:** Motor de reconciliação de pagamentos e Sanity Gate (detecção de loja zerada com faturamento no Pátio).
5. **[Bloco 5] Watchdog 06:00 AM (Golden Gate):** Validação autônoma de prontidão dos 5 relatórios e auto-healing em sandbox.
6. **[Bloco 6] Balões Executivos (WhatsApp Mock):** Simulação completa dos Balões 1 (Operação), 2 (Full), 2 (Simplified) e 3 (Closing) com zero chamadas de rede.
7. **[Bloco 7] CMV KPI Alert por Gerente (Spec 034):** Validação das faixas de KPI (BOM, OBJETIVO, ALERTA, FORA, CRÍTICO), formatação dos 10 gerentes e mock de envio individual.
8. **[Bloco 8] Segurança, Blocklist & Anti-Leak:** Teste de bloqueio estrito do grupo proibido e prova de que 100% dos disparos foram retidos pelo Mock Guard.

### 2.3. Integração com `npm test`
- Atualizar `package.json` na VPS e local:
  ```json
  "scripts": {
    "test": "node scripts/suite_testes_integridade.js",
    "test:safe": "HYDRA_TEST_MODE=1 node scripts/suite_testes_integridade.js"
  }
  ```

---

## 3. Contratos de Dados & Interfaces

### Retorno Interceptado pelo Mock Guard
```js
{
  ok: true,
  mocked: true,
  interceptedAt: "2026-10-27T13:45:00.000Z",
  type: "text" | "document",
  target: "5511996242812",
  snippet: "HYDRA | CMV & Pátio — Rudge Ramos...",
  fileName?: "Juros Rede - 27-10-2026.xlsx"
}
```

---

## 4. Risco Principal e Mitigação

- **Risco:** Um desenvolvedor executar um script de teste unitário antigo fora da suíte oficial sem passar `HYDRA_TEST_MODE=1`.
- **Mitigação:** Adicionar a ativação automática de `process.env.HYDRA_TEST_MODE = '1'` no topo de TODOS os arquivos `src/test_*.js`, garantindo que mesmo se rodar `node src/test_xyz.js` isolado, o Mock Guard estará ativado por padrão.
