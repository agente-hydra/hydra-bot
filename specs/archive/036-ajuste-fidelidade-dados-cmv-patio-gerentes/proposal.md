# Proposta: Spec 036 — Ajuste de Fidelidade de Dados de CMV, Faturamento, Metas, Pátio Ativo e Alerta de Serviço Prestado

## 1. Contexto e Problema
O disparo de indicadores individuais para gerentes de loja (Quarta e Sexta às 14:30) foi implementado na Spec 034. Entretanto, a validação em ambiente real e novos direcionamentos da diretoria exigiram as seguintes correções:
1. **Poluição Visual por Faixas de Diretoria:** A inclusão do bloco de citação `> *FAIXAS DE CMV (DIRETORIA)*` gerou sobrecarga cognitiva para o gerente de loja. O usuário determinou a remoção total da legenda de metas no rodapé.
2. **Sistema de Badges & Anti-Slop Visual:**
   - Adoção da **bolinha azul (🔵)** para CMV em nível Bom (≤ 21,99%).
   - Escala cromática: `🔵` (Bom, ≤ 21,99%), `🟢` (Dentro do Objetivo, 22,0% a 24,99%), `🟡` (Alerta, 25,0% a 26,99%), `🔴` (Fora do Objetivo, 27,0% a 29,99%) e `🚨` (Crítico, ≥ 30,0%).
   - **Remoção de textos descritivos** `(BOM)`, `(DENTRO DO OBJETIVO)`, `(ALERTA)`, mantendo estritamente o emoji e o percentual com precisão (`15,78%`).
3. **Novo Indicador de Rentabilidade: % de Serviço Prestado:**
   - A participação de mão de obra própria (% Serviço Prestado sobre faturamento bruto) é determinante para a margem de contribuição da loja.
   - **No aviso do Gerente:** Incluir a linha de Serviço Prestado com semáforo:
     - `< 45%`: Marcador vermelho `🔴` (ex: `🔴 *44,48%*`).
     - `>= 45%`: Marcador verde `🟢` (ex: `🟢 *51,36%*`).
   - **No Grupo dos Sócios (`120363425738307789@g.us`):** Quando houver lojas com participação de Serviço Prestado **abaixo de 45%**, enviar um balão executivo compilando as unidades críticas para ação rápida da diretoria.
4. **Discrepância Factual no Pátio Ativo (12 vs 4 OSs em Rudge):**
   - O preview de Rudge Ramos exibiu 12 veículos no pátio com 12 pendências, enquanto no ERP ao vivo a loja conta com apenas **4 OSs em aberto** (`ALERTAS Qtd OS's em aberto: 4`) e 0 com checklist.
   - Causa raiz: `os_store_MPrudge.json` havia sido gerado ontem às 23:29 BRT. Na manhã de hoje, 8 OSs foram finalizadas no ERP, mas nenhum crawler de pátio havia rodado antes do meio-dia para atualizar o arquivo.
5. **Fidelidade e Exibição de Faturamento e Meta:**
   - Na Kennedy, o faturamento real é **R$ 71.640,61**, a meta é **R$ 99.900,00** (-16%) e o CMV é **15,78%** (conforme dados confirmados em `relatorio_operacao_MPkennedy.json` e `metas_rede.json`).
   - Desmembrar faturamento e meta em duas linhas formatadas em moeda brasileira.

## 2. Solução Proposta
1. **Redesenho do Bloco de Indicadores (`formatarMsgCmvKpiGerente`):**
   - Eliminar definitivamente o bloco de faixas da diretoria.
   - Adotar bolinhas coloridas sem texto redundante para CMV (`🔵`, `🟢`, `🟡`, `🔴`, `🚨`).
   - Inserir linha de Serviço Prestado: `- _Serviço Prestado:_ 🔴 *44,48%*` (ou `🟢 *51,36%*` se ≥ 45%).
   - Apresentar Faturamento e Meta em duas linhas dedicadas em reais:
     ```
     - _Faturamento Acumulado:_ *R$ 71.640,61*
     - _Meta do Mês:_ *R$ 99.900,00* (-16%)
     ```
2. **Alerta Consolidado de Serviço Prestado para o Grupo dos Sócios:**
   - No orquestrador `run_cmv_kpi_gerentes.js`:
     - Avaliar todas as lojas ativas após a coleta dos dados horários.
     - Filtrar lojas com `% Serviço Prestado < 45%`.
     - Caso existam unidades críticas, formatar e disparar o comunicado executivo para o grupo oficial dos sócios (`120363425738307789@g.us`).
     - Em ambiente de teste (`--target=dev` ou `--dry-run`), o alerta é redirecionado para o Davi (`5511996242812`) ou simulado no log, preservando o grupo real.
3. **Extração Unificada dos Dados de Serviço Prestado (`carregarDadosCmvEMetas`):**
   - Extrair `faturamento_percentual` e `faturamento` da área `SERVIÇO PRESTADO` diretamente de `relatorio_operacao_<slug>.json` (ou fallback na tabela SQLite `faturamento_areas`).
4. **Sincronização de Pátio Ativo e Atualização de Snapshots:**
   - Garantir sincronização das OSs abertas para que o número de carros no pátio bata 100% com o widget `ALERTAS Qtd OS's em aberto` do ERP da loja.
5. **Validação & Preview:**
   - Enviar novo preview individual para o WhatsApp do Davi (`5511996242812`) validando a nova estética limpa e os dados exatos de Kennedy e Rudge Ramos, além do balão de alerta dos sócios.

## 3. Riscos e Mitigações
- **Risco de Spam no Grupo dos Sócios:**
  - *Mitigação:* O disparo para os sócios só ocorre se houver pelo menos 1 unidade com Serviço Prestado < 45%. Se todas estiverem conformes (≥ 45%), nenhum disparo é feito. Além disso, conta com trava de lock diário.
- **Risco de Inconsistência nos Nomes das Áreas:**
  - *Mitigação:* Fazer busca case-insensitive e normalizada (`area.toUpperCase().includes('SERVI')`), compatível com "SERVIÇO PRESTADO", "SERVICO PRESTADO", etc.
- **Risco de Vazamento em Testes:**
  - *Mitigação:* Suíte protegida por Mock WhatsApp Guard e `--target=dev` que redireciona 100% dos envios (incluindo o alerta dos sócios) para o Davi.
