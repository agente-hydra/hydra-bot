# Proposal — Correção da Contagem de OS em Aberto

**Spec:** `hydra-confirmed-open-os`  
**Data:** 06/10/2026  
**Repositório:** `hydra-bot`  
**SHA de Início:** `3caf05bf1af6da2a24c2229de976961141e38bbd` (branch `feat/hydra-language-consolidated`)  
**Destino:** Agente Principal do AGY CLI com dois executores (3 agentes no total)  
**Estado:** Proposta formalizada para implementação; nenhum código operacional foi alterado nesta etapa.

---

## 1. Objetivo e Resultado Obrigatório

Corrigir a quebra de vínculo de import/export do deep crawler e impedir que ordens de serviço em estado `TRANSICAO_PENDENTE` sejam computadas e apresentadas como confirmadamente abertas nas respostas do Hydra. A solução deve preservar integralmente os registros históricos no banco, o isolamento de auditoria e os mecanismos existentes de fallback por snapshot de pátio.

Para uma unidade com 3 OS confirmadamente abertas e 387 OS em transição pendente (caso reproduzido com dados sintéticos), o contrato de contagem deverá retornar estritamente:

```json
{
  "confirmed_open": 3,
  "transition_pending": 387,
  "total_open_like": 390
}
```

- A métrica padrão de quantidade de OS em aberto apresentada nos fluxos operacionais e painéis do bot deverá retornar **3**.
- O valor **390** pertence com exclusividade à auditoria estruturada (`total_open_like`), representando a união disjunta das abertas ativas e das transições em conferência.
- O caso numérico `3 / 387 / 390` é uma referência de reprodução sintética; o sistema não deve presumir essa composição a priori sem conferência nominal na base.

---

## 2. Diagnóstico e Evidências Técnicas

1. **Seletor de Pátio no Inspector:**  
   Em `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts` (linha ~555), o crawler já captura o contador nativo `#ctl00_cph_lkbOSEmAberto`. É terminantemente proibido adicionar novos seletores no DOM ou substituir a contagem dinâmica do banco por valores fixos extraídos do HTML.
2. **Falha de Import/Export Estático no Deep Crawler:**  
   Em `src/hydra-sync/deep-crawler.ts` (linha 6), há a instrução:
   ```ts
   import { handleOSDeepInspector, extrairDetalhe } from '../workers/oficina-agent/playwright/actions/os_deep_inspector.js';
   ```
   No ambiente de produção (`/opt/bots/src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts`, linha ~367), a função `extrairDetalhe(page, osId, baseUrl)` foi declarada sem o modificador `export`. A tentativa de carga do módulo falha antes do bootstrap com o erro:
   `does not provide an export named 'extrairDetalhe'`.
3. **Incompatibilidade de Assinatura com `extrairDetalheDaPagina`:**  
   A função `extrairDetalheDaPagina(detailPage)` (linha 167) é exportada, porém recebe uma instância de página de popup já aberta. Ela não substitui `extrairDetalhe(page, osId, baseUrl)`, que é responsável pela navegação até a busca de OS, abertura do popup e extração dos dados.
4. **Circuito de Falha Pré-Runtime:**  
   Erros de resolução de import estático ocorrem no carregamento da árvore de módulos do Node.js/tsx, antes do corpo do script ser avaliado. Consequentemente, o erro não é contido pelos blocos `try/catch` por loja nem pelo `.catch(...)` de topo do crawler, impedindo o acionamento do fallback de snapshot.
5. **Comportamento Existente de Fallback:**  
   O fallback de coleta nominal preserva o snapshot anterior da loja e registra `recordDataWorkerRun(..., status: 'ERROR')` quando a extração sofre interrupção em tempo de execução. Extrações incompletas retornam `{ extracao_completa: false, erro }` sem lançar exceções não tratadas.
6. **Contaminação da Flag Legada `is_aberta = 1`:**  
   Durante a reconciliação em `db_repository.ts` / `db_repository.js`, ordens marcadas com `estado_operacional = 'TRANSICAO_PENDENTE'` mantêm `is_aberta = 1`. Consultas que filtram apenas `WHERE is_aberta = 1` agregam indevidamente os registros em transição, inflando a contagem de pátio.
7. **Pontos de Contaminação Identificados:**  
   - `getPatioOverview`: agrupa por loja somando `COUNT(*) WHERE is_aberta = 1`.
   - `getStoreDrilldown`: consulta `COUNT(*) WHERE is_aberta = 1 AND LOWER(loja_slug) = LOWER(?)`.
   - `getChecklistAudit`: itera sobre `SELECT ... WHERE is_aberta = 1`.
   - `computeHydraHealthMetrics`: define `indiceVetorial.totalOSsAbertas` via `SELECT COUNT(*) WHERE is_aberta = 1`.
8. **Resolução de Módulos no Runtime:**  
   O runtime executa a versão compilada em JavaScript (`db_repository.js`). Modificações exclusivas em arquivos TypeScript (`.ts`) não surtem efeito na VPS. Ambas as camadas devem receber alterações pontuais e equivalentes.

---

## 3. Escopo e Restrições Rígidas

- **Reutilização Estrita:** Exportar a função existente `extrairDetalhe` sem duplicar seu código nem criar imports dinâmicos complexos.
- **Dual-Maintenance TS/JS:** Aplicar a mesma lógica de negócio a `db_repository.ts` e `db_repository.js`, sem recompilar ou regenerar o repositório inteiro.
- **Não-Destrutividade:** Proibido executar `UPDATE`, `DELETE`, migrações DDL ou reclassificações em massa nas ordens em `TRANSICAO_PENDENTE`.
- **Integridade de Valores Financeiros:** Nas consultas que misturam contagem com somatórios (`getPatioOverview`, `getStoreDrilldown`), a separação da contagem condicional não pode alterar as expressões de `total_valor`, `total_restante` ou `saldo_total_receber`.
- **Preservação de Configuração e Infraestrutura:** Não alterar prompts, formatadores de saída, rotas de intenção, arquivos do PM2, crons, GitHub Actions ou scripts de release.
- **Ausência de Homologação Automatizada:** Por determinação expressa do usuário, esta entrega não inclui criação nem execução de testes automatizados, typecheck ou baterias de integração sintéticas. A validação será executada pelo usuário via diálogo no WhatsApp após a aplicação do patch.
- **Sem Push em Branches Protegidas:** Nenhuma alteração deve ser enviada para `main` ou `production`. O produto final consiste nos arquivos alterados, no resumo das edições e no relatório de auditoria.

---

## 4. Contrato de Dados para Contagem de OS

Definido em `db_repository.ts` e espelhado fielmente em `db_repository.js`:

```ts
export interface OpenOSCounts {
  confirmed_open: number;
  transition_pending: number;
  total_open_like: number;
}

export function getOpenOSCounts(
  db: Database.Database,
  lojaSlug?: string
): OpenOSCounts;
```

### 4.1 Regras de Classificação SQL

| Campo | Critério de Elegibilidade |
|---|---|
| `confirmed_open` | `is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'` |
| `transition_pending` | `UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE'` |
| `total_open_like` | União disjunta: `confirmed_open + transition_pending` |

- Normalização: `UPPER(TRIM(COALESCE(estado_operacional, '')))` garante resiliência contra valores nulos, espaços ou variações de caixa alta/baixa. Registros com estado nulo ou vazio mantêm o comportamento legado da flag `is_aberta = 1`.
- Escopo de Loja: O parâmetro `lojaSlug` deve ser parametrizado no SQLite via `LOWER(loja_slug) = LOWER(?)`. Proibida qualquer interpolação ou concatenação direta de strings no SQL.
- Valores Padrão e Erros: Se `lojaSlug` for omitido, a consulta retorna o consolidado da rede. Se a loja informada não possuir registros, retorna `{ confirmed_open: 0, transition_pending: 0, total_open_like: 0 }`. Erros de execução de banco devem lançar exceções explícitas e jamais serem mascarados como zero.
- Agregação em Snapshot Único: Os três contadores devem ser calculados na mesma expressão SQL ou bloco atômico, impedindo inconsistências temporais decorrentes de escrita concorrente.

---

## 5. Auditoria, Logs e Preservação de Fallback

### 5.1 Emissão de Logs Estruturados
Ao consultar os totais de uma loja ou da rede, registrar o evento agregado em formato JSON em **stderr** (ou via logger interno existente), garantindo isolamento total do canal `stdout` utilizado pelo protocolo MCP:

```json
{
  "event": "hydra_open_os_counts",
  "loja": "MPJabaquara",
  "confirmed_open": 3,
  "transition_pending": 387,
  "total_open_like": 390
}
```

*Restrição de Privacidade:* O log não pode conter nomes de clientes, contatos telefônicos, placas, veículos ou fragmentos de mensagens.

### 5.2 Preservação do Fallback do Crawler
- Em caso de falha de requisição ou timeout em uma unidade, o crawler deve manter o snapshot anterior daquela loja e registrar `recordDataWorkerRun(..., status: 'ERROR')`.
- Falhas nominais de extração retornadas em `detalhe.erro` não encerram a transição pendente nem promovem a OS a aberta confirmada; a ordem permanece em `TRANSICAO_PENDENTE` até que uma coleta nominal válida ocorra.
