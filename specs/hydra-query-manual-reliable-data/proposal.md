# Proposal — Hydra: Manual de Consultas, Interpretação Semântica e Dados Confiáveis (v2 Revisada)

## 1. Classificação Epistemológica: Fatos Comprovados, Mecanismo Demonstrado, Hipóteses e Decisões

Para garantir rigor técnico absoluto e afastar qualquer asserção sem evidência, esta proposta fundamenta suas premissas em quatro categorias ontológicas distintas:

### 1.1 Fatos Comprovados no Código e no Banco Operacional
1. **Divergência Concreta de Estados no SQLite:** No banco de dados operacional (`hydra_ops.db`), a consulta direta aponta exatamente:
   - **153 ordens** com `status_grid = 'ABERTO'` persistidas com `is_aberta = 0`.
   - **206 ordens** com `status_grid = 'AGUARDANDO RETIRADA'` persistidas com `is_aberta = 0`.
   - **68 ordens** com `status_grid = 'VEICULO EM EXECUÇÃO'` persistidas com `is_aberta = 0`.
2. **Anomalia Material da OS 9202 em Kennedy:** O registro existe fisicamente em `ordens_servico` com:
   ```text
   os_id: '9202' | loja_slug: 'MPkennedy' | total_os: 999999.0 | valor_pago: 0.0 | valor_restante: 999999.0
   status_grid: 'Aberta' | is_aberta: 0 | data_inicio: NULL | data_fim: NULL
   ```
3. **Formatação Não Padronizada de Datas:** As colunas `data_inicio` e `data_fim` armazenam strings de texto no padrão brasileiro `DD/MM/YY HH:MM` (ex: `'01/09/26 11:49'`), impossibilitando ordenação ou filtros lexicográficos diretos via SQL.
4. **Independência das Fontes de Faturamento:** As tabelas `faturamento_diario_horario` (alimentada por exportações Excel de Vendas por Dia) e `metas_horarias` (alimentada pelo Mapa de Metas) são tabelas autônomas que não leem nem derivam valores da tabela `ordens_servico`.

### 1.2 Mecanismo de Falha Demonstrado no Código
- O arquivo `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts` (linha 720) executa:
  ```typescript
  store.os_map[id].is_aberta = openOsIdsSet.has(id) ? 1 : 0;
  ```
  e o arquivo `src/hydra-sync/db_repository.ts` (linhas 870–877) executa:
  ```sql
  UPDATE ordens_servico
  SET is_aberta = 0, dias_no_patio = 0, updated_at = CURRENT_TIMESTAMP
  WHERE loja_slug = ? AND os_id NOT IN (${placeholders}) AND is_aberta = 1;
  ```
- **Demonstração do mecanismo:** O conjunto `${placeholders}` é preenchido unicamente pelos IDs presentes na extração daquela execução. Se uma OS legítima não estiver presente no lote visual processado pelo crawler, o código força `is_aberta = 0` no SQLite **sem alterar a string do `status_grid`**.

### 1.3 Causalidade Histórica (Hipóteses a Investigar)
- A causa raiz exata pela qual cada uma das 153 ordens com `status_grid = 'ABERTO'` deixou de vir no lote do crawler em coletas passadas é uma **hipótese histórica não comprovada universalmente**. Pode ter resultado de quebra de sessão Playwright, paginação incompleta, filtros nativos na tela da oficina ou encerramento manual não refletido no texto da grade.
- A origem da OS 9202 (digitação manual na oficina ou falha de parsing no formulário) é uma hipótese que requer auditoria dos snapshots brutos.

### 1.4 Decisões Propostas no Plano
1. **Não Certificação de Totais com Suspeitos:** Excluir registros suspeitos (como a OS 9202) produz **subtotal incompleto / não certificado**, e nunca um "total corrigido". A exclusão propaga obrigatoriamente metadados de incompletude (`coverage = 'PARTIAL'`, `quality = 'SUSPECT'`).
2. **Desacoplamento entre Aceite de Lote e Encerramento Individual:** A aceitação de um lote de crawler valida apenas a integridade daquela captura; **o encerramento de qualquer OS exige evidência nominal individual comprovada**.
3. **Cobertura Comprovada Obrigatória:** Um lote só é aceito se a cobertura de paginação for integralmente comprovada, independentemente de haver queda de 5%, 50% ou aumento de volume.
4. **Distinção Determinística de Zero Financeiro vs Extração Indisponível:** Zero (`R$ 0,00`) exige extração bem-sucedida confirmada pela planilha; falha de extração gera aviso explícito de indisponibilidade e preserva posição anterior com frescor `STALE`.
5. **Datas: Conversão Aditiva, Fuso e Precisão:** Manter colunas legadas e adicionar colunas ISO; separar estritamente `data_evento_iso` de `data_observacao_iso`; fuso `America/Sao_Paulo`.
6. **Reconciliação dos Registros Existentes:** Procedimento de saneamento determinístico dos 517 registros do banco de dados, marcando ordens em divergência como `TRANSICAO_PENDENTE` e submetendo-as à validação nominal.

---

## 2. Diagnóstico da OS 9202: Consultas Afetadas, Não Afetadas e Não-Certificação

A inspeção detalhada das consultas SQL nos repositórios estabelece os limites do impacto da OS 9202:

### 2.1 Consultas Realmente Afetadas
1. **Busca Direta por Identificador:** Consultas a *"detalhes da OS 9202"* ou *"ficha da 9202"* expõem o valor de R$ 999.999,00 sem data de abertura.
2. **Consultas Históricas de OSs de Kennedy sem Filtro de Abertas:** Consultas como *"qual a maior OS já emitida na Kennedy?"* ou *"ordens de maior valor histórico da Kennedy"*.
3. **Totalizadores de Saldo em Aberto SE Reclassificada como Aberta:** Se o saneamento da divergência de estados reclassificar a OS 9202 como `is_aberta = 1` sem isolamento de qualidade, ela corromperá o saldo devedor da unidade (`SUM(valor_restante)`) e a lista de ordens sem sinal (> R$ 2.500).

### 2.2 Consultas NÃO Afetadas
1. **Faturamento Diário Oficial da Kennedy:** Proveniente de `faturamento_diario_horario.faturamento_dia` (exportação Excel de Vendas por Dia).
2. **Faturamento Mensal e Metas da Kennedy:** Proveniente de `metas_horarias.faturamento_mes` (Mapa de Metas oficial).
3. **CMV Geral e de Áreas da Kennedy:** Proveniente de `cmv_lojas` e `faturamento_areas` (Relatório de Gestão Periódica).
4. **Todas as Consultas das Demais 9 Lojas:** O isolamento estrito por `loja_slug = 'MPkennedy'` impede qualquer contaminação cruzada.

### 2.3 Regra de Não-Certificação de Totais
- Quando a OS 9202 for excluída das consultas de saldo devedor ou pátio de Kennedy, o sistema **NÃO declara o valor resultante como "total oficial"**.
- O bot emite: *"Subtotal em aberto apurado: R$ X (não certificado: 1 ordem sob auditoria excluída — OS 9202 de R$ 999.999,00)."*
- As dimensões da resposta registram obrigatoriamente: `quality = 'SUSPECT'` e `coverage = 'PARTIAL'`.

---

## 3. Rastreabilidade das 40 Correções da Revisão

| Nº | Correção | Implementação na Spec |
|:---|:---|:---|
| 1 | OS, veículo e presença separados | Ontologia de 3 conceitos distintos; declaração padrão determinística se sem prova de pátio. |
| 2 | Evento da janela de 30 dias definido | "Últimos 30 dias" = data de abertura D−29 a D+1 civil; inclui encerradas explicitadas. |
| 3 | Fechamento de OS antiga acompanhado | Crawler verifica ativamente OSs abertas históricas antes de reconciliar fechamentos. |
| 4 | Coleta, retenção e consulta distintas | Coleta = janela na origem; Retenção = piso de cobertura sem expurgo; Consulta = filtro pedido. |
| 5 | Fonte responsável e divergências | Matriz de métricas define autoridade primária; divergência gera conflito rotulado, não soma cega. |
| 6 | Consistência entre consultas | Leitura de contagem, lista e métricas sob a mesma versão/snapshot aceito do banco. |
| 7 | Quarentena com entrada e saída | Cobertura comprovada obrigatória; desacoplamento entre lote e fechamento individual de OS. |
| 8 | Tratamento de suspeitos e não-certificação | OS 9202 isolada; totais geram subtotais incompletos e propagam `SUSPECT`/`PARTIAL`. |
| 9 | Validação por tipo de afirmação | Números e estados renderizados exclusivamente por templates determinísticos a partir de dados tipados. |
| 10 | Conclusão mensurável | Test Harness com 28 cenários determinísticos (T01–T28) e meta de >=95% na avaliação de linguagem. |
| 11 | Sócio separado de admin/tester | Sócio com visão de rede conforme cadastro; admin/tester alterna apenas perfis com permissão explícita. |
| 12 | Contexto/cache limpos na troca | Invalidação atômica de cursores, referências e dados de loja ao executar `/reset` ou mudar perfil. |
| 13 | Manual de consultas como escopo | Catálogo formal de capacidades reais exportado para documentação operacional e prompt do revisor. |
| 14 | Composição controlada | Suporte a filtros, ordenações e agrupamentos combinados no servidor sem exigir novas tools. |
| 15 | Limites de decomposição | Teto de 8 chamadas operacionais por turno e orçamento estrito de 45s. |
| 16 | Medir chamada adicional do revisor | Revisor chamado apenas quando o roteador determinístico detectar necessidade de síntese ou lacuna. |
| 17 | Fallback preserva necessidades | Fallback executa componentes seguros e sinaliza explicitamente as partes indisponíveis. |
| 18 | Sucesso parcial definido | Resposta entrega dados oficiais apurados e declara indisponibilidade apenas do componente falho. |
| 19 | Resultado com dimensões | Payload estruturado com 9 dimensões independentes (Execução, Acesso, Suporte, Cobertura, etc.). |
| 20 | Ausência semântica não prova zero | Busca vetorial/FTS vazia declara "não encontrado nos registros pesquisados", nunca "zero na loja". |
| 21 | Detalhes básicos definidos | Schema fixo: número, loja, veículo, placa, estado, abertura, valor total, pago e saldo. |
| 22 | Cursor vinculado a versão/escopo | Paginação determinística com cursor vinculado ao hash da query, escopo da loja e snapshot. |
| 23 | OS ambígua desambiguada | Se o número de OS existir em duas lojas autorizadas, o bot exige foco explícito ou pergunta a loja. |
| 24 | Datas/estados desconhecidos | Dados ausentes são rotulados como "desconhecidos"; proibido inventar horários ou converter em 0. |
| 25 | Aritmética e regras financeiras | Valores em centavos/decimal; divisor zero gera "N/A"; tolerância monetária apenas por arredondamento. |
| 26 | Recuperação sem autoridade | Textos recuperados de observações ou transcrições não podem alterar permissões nem disparar tools. |
| 27 | Carga do Executor 2 redistribuída | E2 foca em ingestão, ciclo e OS 9202; E3 assume consultas, guardas e matriz de métricas. |
| 28 | Principal focado em coordenação | Principal revisa contratos, gerencia manifesto e integra commits sem editar código isolado de frente. |
| 29 | Contratos e exemplos antes de editar | Tipos TypeScript e fixtures definidos antes de qualquer mutação de código. |
| 30 | Primeiro fluxo completo pequeno | Etapa E2 valida integração pontual do fluxo "OS dos últimos 30 dias da minha loja" antes de expandir. |
| 31 | Esperados independentes | Valores de teste calculados manualmente/externamente, nunca pela função sob teste. |
| 32 | Avaliação explícita de linguagem | Suíte de 60 casos com bloqueio sumário por falha crítica (acesso, período ou número alucinado). |
| 33 | Metas de desempenho e recursos | Limite de 20s por tool, p95 não excedendo baseline + 2s, 2 leituras simultâneas por turno. |
| 34 | Recomposição e índice versionado | Reindexação vetorial com versionamento paralelo e troca atômica sem downtime de busca. |
| 35 | Reversão segura e compatível | Migrações aditivas; plano de rollback preserva guardas e desabilita apenas capacidades novas. |
| 36 | Infra/transporte fora do crítico | Servidor e Evolution API tratados como dependências estáveis, monitorados em lista auxiliar. |
| 37 | Investigação finita da OS 9202 | Investigação limitada a 4 horas úteis; se inconclusiva, mantém isolamento e avança na entrega. |
| 38 | Lacunas com dono e deduplicação | Tabela `hydra_query_gaps` para registrar perguntas sem suporte com sanitização e deduplicação. |
| 39 | Prioridade por risco e dependência | Isolamento de acesso -> integridade de dados -> consultas exatas -> composição -> semântica. |
| 40 | Encaminhamento com limites claros | Execução isolada em worktrees/branches sem permissão de deploy em produção durante o apply. |

---

## 4. Divisão de Trabalho e Mapeamento de Sessões

- **Executor 1 (Interpretação & Catálogo):** Sessão `Hydra Operational Context Handoff` ([`de5452f5-ae9d-4de2-af64-0b12f075f5ea`](conversation://de5452f5-ae9d-4de2-af64-0b12f075f5ea)). Mapeamento do catálogo real, reescrita de intenção, decomposição em `QueryPlan`/`QueryComponent`, invalidação de sessão e registro deduplicado de lacunas operacionais (`hydra_query_gaps`).
- **Executor 2 (Ingestão, Ciclo de Vida & Reconciliação):** Sessão `Hydra Ecosystem Context Transfer` ([`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`](conversation://7b9923e9-f4d2-46ff-8a6b-ea932132e04d)). Coleta Playwright com cobertura comprovada obrigatória, eliminação do falso fechamento via `TRANSICAO_PENDENTE`, migração aditiva de datas ISO com backfill, rotina de reconciliação dos 517 registros existentes e investigação finita da OS 9202.
- **Executor 3 (Consultas, Métricas & Resposta):** Sessão `Hydra Ecosystem Operational Handover` ([`5dffcfaf-5e84-438e-81f0-88558655f4c0`](conversation://5dffcfaf-5e84-438e-81f0-88558655f4c0)). Guardas de ferramentas nas 5 camadas, matriz de métricas com autoridade primária, distinção determinística de zero financeiro vs extração indisponível, propagação de não-certificação de totais, paginação determinística e suíte integrada T01–T28.
- **Principal (Coordenação & Governança):** Manifesto de execução, congelamento de contratos, revisão independente dos esperados, suíte holdout de linguagem e integração dos patches.

