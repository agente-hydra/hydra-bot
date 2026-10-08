# Proposta de Arquitetura: Reconciliação Bidirecional do Mapa de Metas & Despacho Silencioso

**Spec ID:** `hydra-mapa-metas-reconcile-and-clean-dispatch`  
**Data:** 08/10/2026  
**Status:** Planejamento  

---

## 1. Problema e Diagnóstico

1. **Janela Temporal de Extração (Descompasso de Faturamento):**
   - O crawler matinal (`deep-crawler.ts`) itera sequencialmente pelas 10 lojas do ERP Oficina Inteligente, consumindo entre 15 e 30 minutos no total.
   - Enquanto o robô processa as primeiras lojas (ex: Mauá, Kennedy), as lojas subsequentes (ex: Dom Pedro, Jabaquara) podem sofrer movimentações cadastrais e financeiras no ERP (novas OSs faturadas, baixas de pátio ou pagamentos recebidos no início do expediente).
   - Sem uma verificação de estado antes e depois do processamento, qualquer OS faturada ou movimentada durante a janela do crawler pode ficar com status defasado na foto diária do pátio e no faturamento consolidado.

2. **Ausência do Mapa de Metas em PDF:**
   - A diretoria atualmente recebe apenas as planilhas Excel de Pátio e Juros Rede, necessitando acessar manualmente a tela de Mapa de Metas (`wfMapaDeMeta.aspx`) no ERP para visualizar a distribuição visual de faturamento da rede.
   - Não havia automação para gerar e anexar o PDF oficial de Mapa de Metas em layout A4 Paisagem para acompanhamento diário junto às planilhas.

3. **Poluição Textual no Envio Matinal via WhatsApp:**
   - Tanto a rotina de Pátio (`whatsapp_patio_dispatcher.js`) quanto a de Juros Rede (`whatsapp_notifier.js`) disparam mensagens textuais longas antes dos arquivos (resumos com listas de lojas, números e emojis).
   - A diretoria solicitou expressamente a eliminação de textos soltos de acompanhamento: o envio matinal deve ser limpo, corporativo e silencioso, entregando exclusivamente os três arquivos oficiais nomeados com a data padronizada (`DD-MM-AAAA`).

---

## 2. Solução Proposta

### 2.1. Reconciliação Bidirecional Pré/Pós-Crawl no Mapa de Metas
1. **Snapshot Inicial (Assim que logar no ERP, antes de iniciar o loop das lojas):**
   - Navega para `https://sistemaoficinainteligente.com.br/wfMapaDeMeta.aspx`.
   - Clica no botão de selecionar todas as empresas (`#ctl00_cph_ucMapaDeMeta_btnEmpresaTodas`).
   - Aplica a Regra Global Anti-Master: desmarca a caixa da Loja Master.
   - Clica em "Gerar" (`#btnGerar`).
   - Aguarda renderização da grade (`#ctl00_cph_ucMapaDeMeta_grd`).
   - Extrai o **Snapshot Inicial de Faturamento**:
     - Faturamento total: lido de `//*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]` (com fallback robusto para `[id*="lblTotalFaturamento"]` ou linha de totais).
     - Faturamento individual de cada loja (`initialStoreRevenue[slug]`).
     - Armazena em memória para o double-check final.

2. **Crawl Principal das Lojas:**
   - Executa a extração habitual de OSs e CMV das 10 lojas elegíveis.

3. **Double-Check Final ("no final no final mesmo"):**
   - Ao concluir a extração das 10 lojas, navega novamente para `wfMapaDeMeta.aspx`.
   - Clica em "Todas", desmarca Master e clica em "Gerar".
   - Lê o novo Faturamento Total oficial do grid (`finalTotalRevenue`).
   - Compara `finalTotalRevenue` com `initialTotalRevenue`:
     - **Se idêntico:** nenhuma OS foi faturada durante o ciclo; o estado está 100% íntegro.
     - **Se diferente:**
       - Compara o faturamento de cada loja entre o snapshot final e o inicial (`finalStoreRevenue[slug] !== initialStoreRevenue[slug]`).
       - Isola a lista de lojas divergentes (`divergentStores`).
       - Dispara a **re-extração cirúrgica de OSs em aberto exclusivamente para as lojas divergentes**, atualizando seus dados até o último segundo sem ter que recrawlear a rede inteira.

4. **Geração do PDF Oficial do Mapa de Metas:**
   - Na página de Mapa de Metas (com "Todas" gerado e conciliado), aciona a geração do PDF via Playwright (`page.pdf({ format: 'A4', landscape: true, printBackground: true })`).
   - Salva o arquivo como: `Mapa de Metas - DD-MM-AAAA.pdf`.

---

### 2.2. Nomenclatura Padronizada dos 3 Arquivos Oficiais
Todos os relatórios gerados adotam nomenclatura estrita e elegante com data formatada:
1. `Juros Rede - DD-MM-AAAA.xlsx` (ex: `Juros Rede - 08-10-2026.xlsx`)
2. `Carros em Patio - DD-MM-AAAA.xlsx` (ex: `Carros em Patio - 08-10-2026.xlsx`)
3. `Mapa de Metas - DD-MM-AAAA.pdf` (ex: `Mapa de Metas - 08-10-2026.pdf`)

---

### 2.3. Despacho Silencioso e Limpo via WhatsApp (Clean Dispatch)
- Adição da flag/modo `cleanDispatch = true` (ou `silentMode = true`) no módulo de envio:
  - Suprime os blocos de texto soltos (`buildExecutiveSummaryText` e `formatarMensagemHydra`).
  - Dispara os 3 arquivos como documentos anexos no WhatsApp via Evolution API.
  - O parâmetro `caption` é omitido ou vazio, garantindo que cheguem limpos e sem poluição na conversa.
  - Alertas técnicos de contingência e falhas continuam roteados exclusivamente para o número do desenvolvedor (`DEV_NUMBER`).

---

## 3. Contratos de Dados

```typescript
export interface StoreRevenueSnapshot {
  slug: string;
  nome: string;
  faturamentoTotal: number;
  volumeOS: number;
  meta: number;
}

export interface MapaMetasReconciliationSnapshot {
  capturedAt: string;
  faturamentoTotalRede: number;
  totalOSsRede: number;
  stores: Record<string, StoreRevenueSnapshot>;
}

export interface ReconcileDeltaResult {
  hasChanged: boolean;
  initialTotal: number;
  finalTotal: number;
  deltaAmount: number;
  divergentStores: string[];
}
```

---

## 4. Riscos e Mitigações

1. **Risco:** O seletor ASP.NET `ctl13` mudar caso a ordem ou quantidade de linhas da grade altere dinamicamente.  
   **Mitigação:** Seletor com cadeia de fallback: busca pelo XPath fornecido (`//*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]`), seguido de seletor por atributo `span[id*="lblTotalFaturamento"]` e, se necessário, inspeção da última linha da tabela `#ctl00_cph_ucMapaDeMeta_grd`.

2. **Risco:** Re-extração em loop infinito caso o faturamento continue mudando.  
   **Mitigação:** Trava estrita de no máximo 1 ciclo de re-extração cirúrgica (Single Retry Guard). Se houver divergência, atualiza apenas as lojas identificadas uma única vez e prossegue para a geração do PDF.

3. **Risco:** Layout do PDF quebrar ou omitir linhas em modo headless.  
   **Mitigação:** Configuração de viewport largo (1440x900), injeção de CSS de impressão `@media print` para forçar largura 100% sem barras de rolagem e `landscape: true` (A4 Paisagem).
