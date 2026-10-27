# Design — Spec 035: Suíte Unificada de Testes e Zero-Leak WhatsApp Guard

**ID:** `035-suite-testes-unificada-anti-leak-wa`

---

## 1. Arquitetura do Zero-Leak WhatsApp Sandbox Guard

### Fluxo de Interceptação

```
[Chamada sendText() ou sendDocument()]
               │
               ▼
   isBlockedTarget(target)?
     ├── SIM ──► Retorna { ok: false, error: 'BLOQUEIO CATEGÓRICO', blocked: true }
     └── NÃO
          │
          ▼
   isMockModeActive()?
   (HYDRA_TEST_MODE === '1' || EVO_DRY_RUN === '1' || global.__HYDRA_MOCK_WA__ === true)
     ├── SIM ──► 1. Armazena na fila global.__HYDRA_MOCKED_MESSAGES__
     │           2. Registra em log: "[SANDBOX MOCK WA] Mensagem interceptada para {target}"
     │           3. Retorna { ok: true, mocked: true, target, ... }
     │           (ZERO REQUISIÇÃO HTTP AXIOS / ZERO TOQUE NA REDE)
     │
     └── NÃO ──► Continua para axios.post(EVO_URL) [PRODUÇÃO]
```

### Código do Guard em `whatsapp_patio_dispatcher.js`

```javascript
/**
 * Verifica se o ambiente está em modo de teste/sandbox anti-vazamento
 */
function isMockModeActive() {
  return (
    process.env.HYDRA_TEST_MODE === '1' ||
    process.env.EVO_DRY_RUN === '1' ||
    Boolean(global.__HYDRA_MOCK_WA__)
  );
}

// Inicializa fila de auditoria em memória
if (!global.__HYDRA_MOCKED_MESSAGES__) {
  global.__HYDRA_MOCKED_MESSAGES__ = [];
}
```

Na função `sendText`:
```javascript
if (isMockModeActive()) {
  const mockPayload = {
    ok: true,
    mocked: true,
    interceptedAt: new Date().toISOString(),
    type: 'text',
    target: number,
    textLength: text.length,
    snippet: text.slice(0, 120).replace(/\n/g, ' ')
  };
  global.__HYDRA_MOCKED_MESSAGES__.push(mockPayload);
  console.log(`🛡️ [ZERO-LEAK WA] Mock interceptou envio de TEXTO para ${number} (${text.length} chars)`);
  return mockPayload;
}
```

Na função `sendDocument`:
```javascript
if (isMockModeActive()) {
  const mockPayload = {
    ok: true,
    mocked: true,
    interceptedAt: new Date().toISOString(),
    type: 'document',
    target: number,
    fileName: name,
    mimeType,
    fileSizeBytes: fs.statSync(filePath).size,
    captionSnippet: effectiveCaption.slice(0, 100)
  };
  global.__HYDRA_MOCKED_MESSAGES__.push(mockPayload);
  console.log(`🛡️ [ZERO-LEAK WA] Mock interceptou envio de DOCUMENTO '${name}' para ${number}`);
  return mockPayload;
}
```

---

## 2. Estrutura da Suíte Unificada (`scripts/suite_testes_integridade.js`)

A suíte executará de forma sequencial com saída formatada e colorida/emojis:

| Bloco | Descrição | O que testa |
|-------|-----------|-------------|
| **1. SQLite & Ops** | Integridade física e operacional | PRAGMA integrity_check, WAL mode, tabelas `ordens_servico`, `cmv_lojas`, `hydra_store_managers`, `metas_diarias`. |
| **2. Pátio Engine** | Freshness e mecânica | `check_patio_freshness.js`, `patio_ledger_engine.js`, `carregarPatioChecklist` (contagem de checklists do mecânico). |
| **3. Motor Rede** | Extrato e pureza contábil | `date_resolver.js`, `excel_processor.js` (10 lojas, colunas), `state_manager.js` (Cutoff Gate 19:30 BRT), `test_excel_processor_pix.js` (expurgo 100% de PIX da aba cartões). |
| **4. Conciliação & Sanity** | Reconciliação Pátio x Rede | `reconciliation_patio_rede_engine.js`, `sanity_gate_patio_rede.js` (detecção de loja no Pátio vs zerada na Rede). |
| **5. Watchdog 06:00 AM** | Golden Gate Matinal | Execução sandbox de `run_morning_watchdog_0600.js` validando auditoria de 5 arquivos e socket Baileys. |
| **6. Balões Executivos** | Grade horária WhatsApp | Execução simulada com Mock dos Balões 1 (Operação), 2 (Full), 2 (Simplified) e 3 (Closing). |
| **7. CMV KPI por Gerente** | Spec 034 Individual | `classifyKPI` (todas as faixas), extração de pátio/checklist, 10 gerentes ativos, formatação executiva, mock de envio. |
| **8. Anti-Leak & Segurança** | Auditoria de retenção | Prova de que `global.__HYDRA_MOCKED_MESSAGES__.length > 0`, ZERO chamadas HTTP externas e bloqueio estrito de grupo proibido. |

---

## 3. Interfaces Reais e Módulos Afetados

### Arquivos a Modificar:
1. `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`: Adicionar `isMockModeActive()`, `global.__HYDRA_MOCKED_MESSAGES__` e interceptor em `sendText` e `sendDocument`.
2. `projects/hydra-rede/scripts/suite_testes_integridade.js`: Expandir de 5 para 8 blocos completos com cobertura total.
3. `projects/hydra-rede/package.json`: Configurar `"test": "node scripts/suite_testes_integridade.js"`.
4. Arquivos `test_*.js`: Adicionar `process.env.HYDRA_TEST_MODE = '1';` no topo como camada defensiva.

---

## 4. Garantia Inegociável de Zero-Leak

```javascript
// Teste de garantia no Bloco 8
assertTest('8.2 Garantia de Retenção Zero-Leak (Zero requisições externas)', () => {
  const interceptedCount = global.__HYDRA_MOCKED_MESSAGES__.length;
  if (interceptedCount === 0) {
    throw new Error('Nenhuma mensagem foi interceptada pelo mock (suspeita de mock inativo)');
  }
  return `${interceptedCount} mensagens/documentos foram seguramente retidos pelo Mock Guard sem tocar a rede`;
});
```
