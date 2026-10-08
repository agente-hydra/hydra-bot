# Design Técnico: Reutilização de Dados do Hydra Bot para Conciliação de Pátio & OS

**Spec ID:** `hydra-patio-bot-bridge`  
**Data:** 07/10/2026

---

## 1. Arquitetura e Fluxo de Dados

```
┌────────────────────────────────────────────────────────┐
│     Oficina Inteligente (ERP WebForms ASP.NET)        │
└───────────────────────────┬────────────────────────────┘
                            │ (Único crawler que acessa o ERP:
                            │  os_deep_inspector.ts / deep-crawler.ts)
                            ▼
┌────────────────────────────────────────────────────────┐
│   VPS Hydra Storage: /home/operacional/hydra-data/     │
│   • os_store_<slug>.json                               │
│   • hydra_ops.db (tabela ordens_servico)               │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ patio_hydra_bot_adapter.js
                            │ (leitura local ou sync via SSH/SCP)
                            ▼
┌────────────────────────────────────────────────────────┐
│   Normalização de Dados & Filtros de Negócio           │
│   • Filtro 10 lojas operacionais (exclui MPMaster)    │
│   • Filtro tipo === 'OS'                              │
│   • Data Entrada: formato DD/MM/YYYY                   │
│   • Saldo devedor: valor_restante                      │
│   • Pagamentos: descrição detalhada das parcelas       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│   patio_ledger_engine.js (Máquina de Estados Mensal)   │
│   • Rastreia saldo aberto, amortizações e quitações   │
│   • Preserva OSs zeradas no mês até virada civil      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│   excel_patio_builder.js                               │
│   • Planilha CONCILIACAO_PATIO_DDMM.xlsx               │
│   • Estilo Slate Corporativo (A4 Paisagem)            │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│   whatsapp_patio_dispatcher.js (Evolution API)         │
│   • Disparo com data/hora da extração                 │
│   • Disclaimer explícito de versão preliminar         │
└────────────────────────────────────────────────────────┘
```

---

## 2. Contratos de Dados

### 2.1. Entrada: `DocumentoAberto` (extraído pelo bot)
```typescript
interface DocumentoAberto {
  id: string;                      // ex: "18468"
  tipo: 'OS' | 'OR';               // 'OS' ou 'OR'
  data_inicio: string;             // ex: "09/09/26 15:04" ou "09/09/2026"
  data_fim: string | null;
  veiculo: string;
  placa: string;
  cliente_nome: string;
  status_grid: string;             // ex: "VEICULO EM EXECUÇÃO", "AGUARDANDO RETIRADA"
  is_aberta?: number;              // 1 ou 0
  total_os?: number;
  valor_pago?: number;
  valor_restante?: number;
  pagamentos?: Array<{
    parcela: string;
    vencimento: string;
    forma: string;
    valor: number;
    num_operacao?: string;
  }>;
}
```

### 2.2. Saída Normalizada para o `patio_ledger_engine`:
```typescript
interface NormalizedOSRecord {
  osNumber: number;                // 18468
  dataAbertura: string;            // "09/09/2026" (DD/MM/YYYY)
  cliente: string;                 // "KYARO"
  placa: string;                   // "QPE1J35"
  valorTotal: number;              // 546.60
  restanteERP: number;             // 546.60 (ou 0 se quitada)
  formasPagamentoERP: string;      // "Crédito: R$ 546,60" ou "-"
  statusERP: string;               // "VEICULO EM EXECUÇÃO"
}
```

---

## 3. Mapeamento Canônico de Lojas

| ID OI | Nome Amigável | Slug Hydra-Bot | Slug Pátio Ledger |
|---|---|---|---|
| 203 | Planalto | `MPplanalto` | `brasicar_planalto` |
| 205 | Piraporinha | `MPpiraporinha` | `emporio_piraporinha` |
| 146 | Mauá | `ReiDoOleoMaua` | `mhe_maua` |
| 351 | Kennedy | `MPkennedy` | `mp_kennedy` |
| 748 | Rudge Ramos | `MPrudge` | `cap_rudge_ramos` |
| 2112 | Santo André | `MPSantoAndre` | `hd_santo_andre` |
| 2190 | Rei do Módulo | `ReiDoModulo` | `mp_rei_modulo` |
| 2602 | Jorge Beretta | `MPJorgeBeretta` | `dhjv_jorge_beretta` |
| 4045 | Dom Pedro I | `MPdompedro1` | `dp_dom_pedro` |
| 4469 | Jabaquara | `MPJabaquara` | `jab_jabaquara` |

---

## 4. Estratégia de Sincronização do Adaptador

O módulo `patio_hydra_bot_adapter.js` suportará 3 modos de carregamento ordenados por prioridade:
1. **Cache Local:** Verifica se `projects/hydra-rede/data/bot-crawls/os_store_<slug>.json` existe e está recente.
2. **Sync Direto via SSH da VPS:** Conecta silenciosamente em `operacional@100.126.50.101` para sincronizar os arquivos JSON de `/home/operacional/hydra-data/crawls/os_store_*.json` para a pasta local.
3. **Fallback SQLite:** Se necessário, consulta diretamente o `hydra_ops.db`.

---

## 5. Formato da Mensagem WhatsApp (Disparo de Validação)

```text
🚗 *CONCILIAÇÃO DIÁRIA DE PÁTIO & OS*
📅 *Referência:* DD/MM/AAAA
🏢 *Unidades:* 10 Lojas Operacionais

📊 *Resumo Consolidado:*
• Veículos em Pátio / OSs Abertas: {totalOSsAbertas}
• Saldo em Aberto na Rede: R$ {totalValorAberto}
• OSs Quitadas no Ciclo: {totalOSsQuitadasCiclo}

ℹ️ *Nota de Validação:*
_Este relatório preliminar foi gerado com dados extraídos via Hydra Bot Deep Inspector em DD/MM/AAAA às HH:mm para fins de conferência e alinhamento._
```
