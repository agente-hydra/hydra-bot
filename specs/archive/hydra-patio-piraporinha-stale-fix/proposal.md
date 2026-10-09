# Proposta de Arquitetura: Correção de Stale Cache em Piraporinha & Blindagem de Resiliência do Crawler de Pátio

**Spec ID:** `hydra-patio-piraporinha-stale-fix`  
**Data:** 09/10/2026  
**Status:** PROPOSTA DE ARQUITETURA (Aguardando `/vibe-apply hydra-patio-piraporinha-stale-fix`)

---

## 1. Diagnóstico do Problema & Causa Raiz

Na conciliação diária de hoje (09/10/2026), a loja **Piraporinha** apresentou divergência crítica entre o arquivo gerado pelo robô (`Carros em Patio - 09-10-2026.xlsx`) e o arquivo de conciliação real oficial (`CONCILIAÇÃO 0910.xlsx`):

| Métrica | Relatório Gerado pelo Bot | Conciliação Real Humana | Diferença / Impacto |
| :--- | :--- | :--- | :--- |
| **OSs Listadas** | 2 OSs (40415 e 40410) | 8 OSs (40421, 40420, 40419, 40418, 40417, 40416, 40415, 40410) | **6 OSs ausentes** |
| **Saldo Pendente** | R$ 4.732,00 | R$ 4.778,70 | Distorção nos valores de saldo em pátio |
| **Recebimentos D-1** | R$ 0,00 | > R$ 6.000,00 (Crédito, Débito e Pix) | **Omissão total dos pagamentos de ontem** |
| **Saídas de Pátio** | 0 OSs finalizadas | 5 OSs finalizadas ontem | Falso status de zero movimentação |

### Causa Raiz Técnica Auditada nos Logs (`daily-crawl.log`):
1. **Falha de Transição no Cabeçalho ASP.NET:**
   - Durante o crawl noturno das 03:15 AM, o robô executou o ciclo de `MPkennedy` e finalizou na página `wfRelatorioOperacao.aspx`.
   - Ao iniciar a etapa 1/2 de `MPpiraporinha`, o crawler navegou para `wfOrdemDeServicoBusca.aspx`. Devido ao carregamento da master page ASP.NET, o locator `#lblSiglaEmpresa` não ficou visível no tempo de 8.000ms.
2. **Loop de Retry Ineficiente (Deadlock de Recuperação):**
   - O método `ensureCompany` em `core.ts` repetiu as tentativas 2 e 3 sem recarregar a página, sem verificar deslogamento e sem reinicializar o DOM. Todas as 3 tentativas falharam no mesmo estado de página estático.
3. **Circuit Breaker Passivo com Stale Fallback Silencioso:**
   - Ao falhar a etapa de OS, o `deep-crawler.ts` acionou o Circuit Breaker, preservando o arquivo `os_store_MPpiraporinha.json` e os registros do SQLite do dia **08/10/2026 às 03:28**.
   - O crawler seguiu para o CMV de Piraporinha (que funcionou com sucesso) e encerrou sem tentar re-executar as lojas pendentes de OS.
4. **Ausência de Guarda de Frescor (Freshness Guard) no Gerador de Pátio:**
   - O `patio_hydra_bot_adapter.js` consumiu `os_store_MPpiraporinha.json` às 08:00 AM sem validar se o arquivo tinha sido gerado na madrugada do dia corrente (`mtime > 12h`). Os dados de 24h atrás foram injetados no Excel e no resumo executivo sem qualquer alerta de que estavam defasados.

---

## 2. Solução Proposta

### Eixo 1: Active Recovery no `ensureCompany` (`core.ts`)
- Implementar recuperação ativa entre retentativas de troca de empresa:
  - Se `#lblSiglaEmpresa` não responder ou o texto for vazio, verificar se a URL atual é `Default.aspx` (login expirado) e re-autenticar se necessário.
  - Se estiver na página correta porém o DOM estiver instável, executar `page.reload({ waitUntil: 'domcontentloaded' })` ou navegar explicitamente antes da próxima tentativa.
  - Aumentar timeout do header para 12s para absorver latência de rede.

### Eixo 2: Fila de Reprocessamento no `deep-crawler.ts` (Auto-Healing)
- Criar lista `lojasComFalhaOS: string[]`. Se qualquer loja acionar o Circuit Breaker durante o loop principal de 10 lojas:
  - Não abortar o ciclo das outras lojas.
  - Após concluir o CMV e antes do double-check de metas, instanciar uma **2ª passada de recuperação (Recovery Pass)** dedicada apenas para as lojas da fila.
  - Se a loja recuperar com sucesso na 2ª passada, ela é marcada como sucesso e seu snapshot é atualizado.

### Eixo 3: Store Freshness Guard no `patio_hydra_bot_adapter.js`
- Adicionar validação estrita de data/hora nos arquivos `os_store_<slug>.json`:
  - Se a data de atualização do arquivo for anterior às 00:00 do dia da execução (ou defasagem > 12 horas), o adaptador emite erro ou alerta de contingência dev e não permite geração com dados obsoletos sem flag explícita `--allow-stale`.
  - Se estiver rodando na VPS e detectar loja defasada, dispara automaticamente a extração cirúrgica da loja antes de prosseguir com a montagem da planilha.

### Eixo 4: Reconciliação dos Dados de Hoje (09/10/2026)
- Ingerir a extração atualizada de `MPpiraporinha` (já com as 68 OSs recentes e os pagamentos de 08/10).
- Regenerar a planilha oficial `Carros em Patio - 09-10-2026.xlsx` e validar o batimento exato com `CONCILIAÇÃO 0910.xlsx`.

---

## 3. Contratos de Dados & Regras de Negócio

1. **Definição de Freshness:**
   - Um snapshot de loja é considerado **FRESCO** se:
     $$\text{mtime}(os\_store\_slug.json) \ge \text{startOfDay}(\text{dataExecucao})$$
2. **Definição de Carros em Pátio de Piraporinha:**
   - Ordens com `is_aberta === 1`: ativas no pátio físico.
   - Ordens com `is_aberta === 0` e liquidação em D-1 (08/10): saídas de ontem com pagamentos contabilizados na conciliação.

---

## 4. Riscos & Mitigações

| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| **Loops infinitos de retry em caso de queda do ERP** | Timeout global do crawler excedido | Limitar a 2ª passada de recuperação a no máximo 1 tentativa por loja pendente com timeout estrito de 5 minutos. |
| **Falso positivo de desatualização em fusos horários** | Bloqueio indevido de relatórios | Normalizar comparações temporais usando timestamps epoch (ms) e data BR canônica (`normalizeToBRDate`). |
