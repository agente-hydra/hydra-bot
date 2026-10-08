# Design Técnico: Reestruturação do Motor de Carros em Pátio & OS (Ingestão pós-Crawler da VPS)

**Spec ID:** `hydra-patio-engine-reconstruction`  
**Data:** 08/10/2026  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO APROVAÇÃO (SDD Hard Stop)  

---

## 1. Arquitetura de Acionamento e Ingestão pós-Crawler

```mermaid
flowchart TD
    CronCrawler["Cron VPS: 03:15 BRT\nrun-hydra-daily-full.sh"] --> RunDeepCrawler["deep-crawler.ts:\nExtração das 10 Lojas do ERP"]
    
    RunDeepCrawler --> CrawlComplete{"Status: 10/10 Lojas Sucesso?\n(03:45 BRT)"}
    
    CrawlComplete -- Sim (Gatilho Imediato) --> TriggerPatio["Hook / Script de Encadeamento:\nnode src/run_patio_daily.js"]
    
    TriggerPatio --> ReadCrawls["Leitura Direta dos Arquivos Frescos:\n/home/operacional/hydra-data/crawls/os_store_*.json"]
    
    ReadCrawls --> EngineD1["patio_ledger_engine.js: Processamento D-1 Estrito"]
    
    subgraph CoreEngine ["Processamento por Loja (D-1 Estrito)"]
        EngineD1 --> FilterEntrada{"Entrada <= D-1?"}
        FilterEntrada -- Não (Hoje) --> DiscardFutura["Fica para próxima"]
        FilterEntrada -- Sim --> CheckFim{"Finalização?"}
        
        CheckFim -- "Vazia (Aberta)" --> YardActive["Status: ATIVA EM PÁTIO\nSaldo = restanteERP"]
        CheckFim -- "== D-1" --> YardExit["Status: SAÍDA DE PÁTIO\nSaldo = R$ 0,00"]
        CheckFim -- "< D-1" --> DiscardPassada["Fora da lista do dia"]
        
        YardActive --> ExtractD1Payments["Filtrar Pagamentos com Data/Vencimento == D-1"]
        YardExit --> ExtractD1Payments
        
        ExtractD1Payments --> ClassifyHighlight{"Tipo de Destaque"}
        ClassifyHighlight -- "Aberta + Pagto Novo" --> HighCell["Destaque: SOMENTE CÉLULA PAGAMENTO\n(Sky 100 #E0F2FE, badge 🔵)"]
        ClassifyHighlight -- "Aberta sem Pagto" --> HighNone["Sem Destaque (Pagamento = '—')"]
        ClassifyHighlight -- "Finalizada em D-1" --> HighRow["Destaque: LINHA INTEIRA\n(Amber suave #FEF3C7 + [Finalizada])"]
        
        HighCell --> SortOSDesc["Ordenação Unificada: osNumber DESC"]
        HighNone --> SortOSDesc
        HighRow --> SortOSDesc
    end
    
    SortOSDesc --> BuildWorkbook["excel_patio_builder.js: Gerar CONCILIACAO_PATIO_DDMM.xlsx"]
    
    BuildWorkbook --> CheckEnvMode{"Modo de Execução?"}
    CheckEnvMode -- "Manual / Teste (--immediate)" --> SendNow["Disparo Imediato WhatsApp"]
    CheckEnvMode -- "Rotina Matinal Automatizada" --> Wait08["Aguardar até 08:00:00 BRT"]
    
    Wait08 --> Send08["Disparo Pontual às 08:00 AM WhatsApp"]
    SendNow --> WhatsAppEvolution["Evolution API -> WhatsApp"]
    Send08 --> WhatsAppEvolution
```

---

## 2. Detecção e Handshake pós-Crawler

No arquivo `run-hydra-daily-full.sh` na VPS (ou monitoramento via `run_patio_daily.js`):
1. **Verificação de Integridade dos Crawls:**
   * Inspeciona os 10 arquivos `os_store_*.json` em `/home/operacional/hydra-data/crawls/`.
   * Verifica se `ultima_atualizacao` corresponde à execução da data corrente.
2. **Encadeamento Imediato:**
   * Assim que o crawler finaliza, aciona a conciliação sem intervalo de espera.
   * Planilha gerada em `/home/operacional/hydra/output/relatorios/CONCILIACAO_PATIO_DDMM.xlsx` (ou local em `projects/hydra-rede/output/relatorios/`).

---

## 3. Interfaces TypeScript & Tipagem Estrita

```typescript
export type PatioHighlightType = 'NONE' | 'NEW_PAYMENT' | 'YARD_EXIT';

export interface PatioPaymentItem {
  forma: string;
  valor: number;
  vencimentoBR: string;
  parcela?: string;
}

export interface NormalizedPatioOS {
  osNumber: number;
  lojaSlug: string;
  lojaNomeDisplay: string;
  dataEntradaBR: string; // DD/MM/YYYY
  dataFinalizacaoBR: string | null; // DD/MM/YYYY ou null se aberta
  isAberta: boolean; // true se dataFinalizacao vazia
  saldoPendente: number; // Saldo residual atualizado informado pelo ERP
  totalOSOriginal: number; // Valor original total da OS
  cliente: string;
  placa: string;
  veiculo: string;
  pagamentosD1: PatioPaymentItem[];
  totalPagoD1: number;
  textoPagamentosD1: string; // Ex: "Pix: R$ 385,00" ou "—"
  highlightType: PatioHighlightType;
}

export interface StorePatioBlock {
  lojaSlug: string;
  displayName: string;
  totalAtivas: number; // Veículos em pátio ativo
  totalFinalizadasOntem: number; // Saídas de ontem
  saldoSubtotal: number; // Soma da coluna Valor
  recebidoOntemSubtotal: number; // Soma dos pagamentos D-1
  formasRecebidas: Record<string, number>;
  ordens: NormalizedPatioOS[]; // Ordenação unificada por osNumber DESC
}
```

---

## 4. Módulos Afetados

1. **`src/patio_hydra_bot_adapter.js`:**
   * Suporte à leitura local transparente na VPS (`/home/operacional/hydra-data/crawls`) ou via cache sincronizado local em desenvolvimento (`data/bot-crawls/`).
   * Validação de timestamp para confirmar que os dados pertencem ao crawl mais recente.
2. **`src/patio_ledger_engine.js`:**
   * Refatoração para a elegibilidade D-1 estrita.
   * Filtro rigoroso de pagamentos de D-1.
   * Atribuição de `highlightType: 'NONE' | 'NEW_PAYMENT' | 'YARD_EXIT'`.
   * Ordenação estrita `osNumber DESC` unificada.
3. **`src/excel_patio_builder.js`:**
   * Aplicação do destaque de célula única na coluna `E` para `NEW_PAYMENT`.
   * Aplicação do destaque de linha inteira para `YARD_EXIT`.
   * Estilo padrão limpo para `NONE`.
4. **`src/run_patio_daily.js`:**
   * Opção `--check-fresh-crawl` para assegurar que os arquivos foram gerados no dia.
   * Encadeamento com disparo às 08:00 AM (ou `--immediate`).
