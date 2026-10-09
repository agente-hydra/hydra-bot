# Design de Arquitetura — Automação e Despacho de Contas a Pagar (hydra-contas-pagar-dispatch)

**Spec ID:** `hydra-contas-pagar-dispatch`  
**Data:** 09/10/2026  
**Status:** Design  

---

## 1. Fluxo de Dados e Ciclo de Execução

```
[Cron VPS: 03:15 AM]
        │
        ▼
[deep-crawler.ts]
        │
        ├─► Ingestão de OSs (10 lojas)
        ├─► Ingestão de CMV (10 lojas)
        ├─► Exportação Mapa de Metas (wfMapaDeMeta.aspx)
        │       ↳ Salva: /home/operacional/hydra-data/crawls/Mapa de Metas - DD-MM-AAAA.pdf
        │
        ▼  [NOVO PASSO IMEDIATO]
[contas_pagar_crawler.ts] (mesma sessão do browser)
        │
        ├─► Navega: /wfContaBuscaPagar.aspx
        ├─► Seleciona Todas as Empresas (#chkEmpresaSelecao -> fncEmpresaSelecao())
        ├─► Filtro Data: 'Data de Pagamento' (select option value '3')
        ├─► Preenche Datas (D-1 / Sexta+Sábado se Segunda-feira)
        ├─► Clica em 'Buscar' (#ctl00_cph_btnBuscar)
        ├─► Clica em 'Imprimir' (#ctl00_cph_btnRelatorio)
        ├─► Intercepta download: BuscaContasAPagar.pdf
        │       ↳ Salva: /home/operacional/hydra-data/crawls/Contas a Pagar - DD-MM-AAAA.pdf
        ▼
[Término do Crawler da Madrugada]

═══════════════════════════════════════════════════════════════════

[Cron VPS: 07:45 AM] -> [run_unified_morning_dispatch.js]
        │
        ├─► 1. Constrói Juros Rede (index.js --build-only)
        ├─► 2. Constrói Carros em Pátio (run_patio_daily.js --build-only)
        ├─► 3. Localiza os 4 arquivos oficiais no disco (> 1 KB):
        │       1. Juros Rede - DD-MM-AAAA.xlsx
        │       2. Carros em Patio - DD-MM-AAAA.xlsx
        │       3. Mapa de Metas - DD-MM-AAAA.pdf
        │       4. Contas a Pagar - DD-MM-AAAA.pdf
        │
        ├─► 4. Gate de Totalidade 4/4 (Se faltar qualquer um, aborta e notifica o Dev)
        ├─► 5. Timer Guard (aguarda 08:00:00 AM)
        ├─► 6. Disparo Sequencial Limpo via Evolution API (caption: "")
        │       ↳ Destinatário Exclusivo: 5511996242812
        └─► 7. Registra Lock de Idempotência Diária
```

---

## 2. Contratos e Interfaces TypeScript (Sem `any`)

### 2.1 Interface de Parâmetros e Opções de Contas a Pagar

```typescript
export interface ContasPagarDataRange {
  dataInicialFormatada: string; // "DD/MM/YYYY"
  dataFinalFormatada: string;   // "DD/MM/YYYY"
  isSegundaFeira: boolean;
  diasCobertosDescricao: string;
}

export interface ContasPagarCrawlerOptions {
  baseUrl?: string;
  dataReferencia?: Date;
  timeoutMs?: number;
  desmarcarMaster?: boolean;
}

export interface ContasPagarExtractionResult {
  sucesso: boolean;
  caminhoArquivoSalvo: string;
  tamanhoBytes: number;
  dataInicialUtilizada: string;
  dataFinalUtilizada: string;
  duracaoMs: number;
  mensagem?: string;
}
```

### 2.2 Função Canônica de Cálculo de Período

```typescript
/**
 * Calcula o intervalo de datas para a consulta de Contas a Pagar:
 * - Terça a Domingo: Data Inicial = Ontem (D-1), Data Final = Ontem (D-1)
 * - Segunda-feira: Data Inicial = Sexta-feira passada (D-3), Data Final = Ontem/Domingo (D-1)
 */
export function calcularPeriodoContasPagar(dataRef: Date = new Date()): ContasPagarDataRange {
  const diaSemana = dataRef.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  const isSegundaFeira = diaSemana === 1;

  let dtInicio: Date;
  let dtFim: Date;
  let descricao: string;

  if (isSegundaFeira) {
    // Sexta-feira anterior = D-3
    dtInicio = new Date(dataRef);
    dtInicio.setDate(dataRef.getDate() - 3);

    // Ontem (Domingo) = D-1 (cobrindo sexta, sábado e domingo)
    dtFim = new Date(dataRef);
    dtFim.setDate(dataRef.getDate() - 1);

    descricao = 'Segunda-feira: período estendido de sexta-feira a domingo';
  } else {
    // Dia comum: D-1
    dtInicio = new Date(dataRef);
    dtInicio.setDate(dataRef.getDate() - 1);

    dtFim = new Date(dataRef);
    dtFim.setDate(dataRef.getDate() - 1);

    descricao = 'Dia útil comum: data de ontem (D-1)';
  }

  const formatarBR = (d: Date): string => {
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return `${dia}/${mes}/${ano}`;
  };

  return {
    dataInicialFormatada: formatarBR(dtInicio),
    dataFinalFormatada: formatarBR(dtFim),
    isSegundaFeira,
    diasCobertosDescricao: descricao
  };
}
```

### 2.3 Contrato de Despacho dos 4 Relatórios (`whatsapp_unified_dispatcher.ts`)

```typescript
export interface RelatoriosMatinaisQuartetoOptions {
  jurosRedePath: string;
  carrosPatioPath: string;
  mapaMetasPdfPath: string;
  contasPagarPdfPath: string;
  targetNumber?: string;
  forceImmediate?: boolean;
  dateTagBR?: string;
}

export interface DispatchResponse {
  ok: boolean;
  totalArquivosEnviados: number;
  logs: string[];
}
```

---

## 3. Módulos do Sistema e Alterações Planejadas

### Módulo 1: `src/hydra-sync/contas_pagar_crawler.ts` (Novo Módulo)
- Implementa `calcularPeriodoContasPagar(dataRef)`.
- Implementa `gerarPdfContasPagar(page: Page, caminhoDestino: string, options?: ContasPagarCrawlerOptions): Promise<ContasPagarExtractionResult>`.
- Cuida da navegação em `wfContaBuscaPagar.aspx`, seleção de empresas via `#chkEmpresaSelecao`, filtro de Data de Pagamento (`#ctl00_cph_rblFiltroData` = `'3'`), busca e captura do download com `saveAs`.

### Módulo 2: `src/hydra-sync/deep-crawler.ts` (Modificação Cirúrgica)
- Logo após a geração do PDF do Mapa de Metas (linha ~508), invoca `gerarPdfContasPagar(page, caminhoPdfContasPagar)`.
- Reutiliza a sessão viva do navegador sem necessidade de novo login.

### Módulo 3: `projects/hydra-rede/src/whatsapp_unified_dispatcher.js` (Evolução para Quarteto)
- Estende a função `dispararRelatoriosMatinaisSilenciosos` para aceitar `contasPagarPdfPath`.
- Adiciona o 4º documento à fila sequencial de envio sem legendas.

### Módulo 4: `projects/hydra-rede/src/run_unified_morning_dispatch.js` (Orquestrador)
- Adiciona a resolução de caminho padrão para `Contas a Pagar - DD-MM-AAAA.pdf`.
- Atualiza o Gate de Totalidade de 3 para 4 arquivos.
- Mantém o fallback de contingência caso o crawler precise ser executado em modo de recuperação.

### Módulo 5: `projects/hydra-rede/src/exportar_contas_pagar_cli.js` (Utilitário de Contingência)
- Script autônomo executável na VPS para exportar isoladamente o PDF de Contas a Pagar a qualquer momento:
  `node src/exportar_contas_pagar_cli.js [--date=YYYY-MM-DD]`
