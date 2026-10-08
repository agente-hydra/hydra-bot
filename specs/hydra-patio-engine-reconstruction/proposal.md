# Proposta: Reestruturação do Motor de Carros em Pátio & OS (Ingestão Direta pós-Crawler da VPS • Modelo D-1 Estrito)

**Spec ID:** `hydra-patio-engine-reconstruction`  
**Data:** 08/10/2026  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO APROVAÇÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Diretoria  

---

## 1. Fonte de Dados e Gatilho de Execução: Crawler da VPS (24/7)

O bot de Carros em Pátio opera de forma estrita e integrada à infraestrutura da VPS (`operacional@100.126.50.101`):

1. **Fonte Única da Verdade:**
   * Os dados brutos vêm **exclusivamente do crawler da VPS** (`deep-crawler.ts`), que gera os arquivos `/home/operacional/hydra-data/crawls/os_store_*.json` e `extracao_hoje_*.json` para as 10 lojas oficiais.
2. **Gatilho Imediato pós-Crawler (Handshake de Conclusão):**
   * O motor de Pátio **não roda em horário cego desconectado da extração**.
   * Ele é acionado **assim que o crawler da VPS finaliza a coleta completa** das 10 lojas (sinalizado pelo status `🎯 SUCESSO TOTAL: 10/10 lojas processadas com sucesso` registrado no encerramento de `run-hydra-daily-full.sh` às ~03:45 AM BRT).
   * O processamento contábil e a montagem da planilha A4 ocorrem imediatamente com os dados frescos do dia.
3. **Guarda de Horário de Entrega (Timer Guard 08:00 AM):**
   * A planilha e os resumos ficam prontos na madrugada logo após o crawler.
   * O despachante retém o envio no WhatsApp até as **08:00:00 AM pontualmente** (ou dispara imediatamente se for execução manual/teste).

---

## 2. Regras de Negócio e Algoritmo D-1 Estrito

Conforme alinhado no vídeo *"LOGICA CARROS EM PÁTIO.mp4"* e no escopo oficial:
Exemplo: Execução do dia considera movimentos até o dia anterior (**D-1**).

### 2.1. Elegibilidade da OS por Loja
* **Entrada (Data de Abertura):** Deve ser $\le \text{D-1}$. Movimentos do dia da execução ficam para o próximo fechamento.
* **Critério de Permanência:**
  * **Data de Finalização VAZIA:** Incluída na lista do dia (veículo em pátio ativo, inclusive de meses anteriores e com saldo zero).
  * **Data de Finalização == D-1:** Incluída na lista do dia como **Saída de Pátio** daquele dia.
  * **Data de Finalização < D-1:** Fora da listagem corrente (veículo já havia saído em dias anteriores).

### 2.2. Saldo Pendente (Coluna `Valor:`)
* O campo `Valor:` reflete o **saldo pendente atualizado informado pelo ERP** (`restanteERP`).
* **Anti-Duplo Desconto:** Se o ERP já abateu os pagamentos do saldo, o bot **não desconta novamente**.
* **Saldo Zero $\neq$ Saída:** Carro aberto no pátio físico com saldo zero permanece na lista com `Valor: R$ 0,00`.

### 2.3. Pagamentos Novos do Dia (Coluna `PAGAMENTOS:`)
* Exibe **somente os pagamentos incluídos no dia de referência D-1**.
* Pagamentos de dias anteriores já estão refletidos no saldo pendente e **não reaparecem** na coluna do dia (exibe `—`).

### 2.4. Destaques Visuais na Planilha Excel
| Situação da OS | Saldo Pendente | Pagamento em D-1 | Destaque Visual |
|---|---:|:---:|---|
| **Aberta no pátio** | R$ 2.000,00 | Pix: R$ 385,00 | **Destaca SOMENTE a célula de pagamento** (Sky 100 `#E0F2FE`, badge 🔵) |
| **Aberta no pátio** | R$ 1.500,00 | Nenhum (`—`) | Linha normal (sem destaque, pagamento `—`) |
| **Aberta com saldo zero** | R$ 0,00 | Nenhum (`—`) | Linha normal (sem destaque, saldo R$ 0,00, pagamento `—`) |
| **Finalizada ontem (Saída)** | R$ 0,00 | Qualquer / Nenhum | **Destaca a LINHA INTEIRA** (Amber suave `#FEF3C7` + tag `[Finalizada DD/MM]`) |

### 2.5. Ordenação Unificada
* Cada card de loja é ordenado continuamente por **número da OS decrescente (`osNumber` DESC)** de cima a baixo, sem separação em blocos artificiais.

---

## 3. Contratos de Dados & Estrutura

```typescript
export interface NormalizedPatioOS {
  osNumber: number;
  lojaSlug: string;
  lojaNomeDisplay: string;
  dataEntradaBR: string; // DD/MM/YYYY
  dataFinalizacaoBR: string | null; // DD/MM/YYYY ou null se aberta
  isAberta: boolean;
  saldoPendente: number;
  totalOSOriginal: number;
  cliente: string;
  placa: string;
  veiculo: string;
  pagamentosD1: Array<{
    forma: string;
    valor: number;
    vencimentoBR: string;
    parcela?: string;
  }>;
  totalPagoD1: number;
  textoPagamentosD1: string;
  highlightType: 'NONE' | 'NEW_PAYMENT' | 'YARD_EXIT';
}

export interface StorePatioBlock {
  lojaSlug: string;
  displayName: string;
  totalAtivas: number; // Veículos em pátio ativo
  totalFinalizadasOntem: number; // Saídas de ontem
  saldoSubtotal: number; // Soma da coluna Valor
  recebidoOntemSubtotal: number; // Soma dos pagamentos D-1
  formasRecebidas: Record<string, number>;
  ordens: NormalizedPatioOS[]; // Ordenadas estritamente por osNumber DESC
}
```

---

## 4. Plano de Validação Imediata (Dados Reais Coletados Hoje - 08/10/2026)

* Os arquivos `os_store_*.json` coletados pelo crawler da VPS hoje às **03:44 AM** já foram sincronizados para `data/bot-crawls/`.
* Usaremos exatamente essa base fresca para executar a conciliação e validar:
  1. Identificação correta de todas as OSs ativas no pátio e das saídas de ontem (07/10).
  2. Isolamento dos pagamentos recebidos em 07/10 com destaque exclusivo na célula.
  3. Destaque de linha inteira nas OSs finalizadas em 07/10.
  4. Ordenação decrescente estrita de OS em todas as 10 lojas.
