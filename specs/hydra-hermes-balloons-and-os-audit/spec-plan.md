# Plano de Implementação — Hermes Balões Executivos, Hierarquia de Vistorias e Auditoria de Conversas

**ID da Spec:** `hydra-hermes-balloons-and-os-audit`  
**Status:** Concluído  
**Branch Alvo:** `main`  

---

## Fases de Implementação

### Fase 1: Enriquecimento de Dados no Repositório de OS
- [x] `[DATA]` Em `src/hydra-sync/operational_data_repository.ts`, expandir a extração de `getOSDetails` para capturar os campos de auditoria do `raw_payload`: `clienteTelefone`, `clienteCpf`, `observacao`, `historicoCriadoEm`, `historicoCriadoPor`, `historicoAtualizadoEm`, `historicoAtualizadoPor`.
- [x] `[DATA]` Adicionar testes unitários garantindo que ordens sem esses campos façam fallback gracioso para `undefined`.

### Fase 2: Hierarquização de Checklists, Formatação de Serviços/Peças e Particionamento
- [x] `[FORMATTER]` Em `src/hydra-sync/os_situation_composer.ts`, refatorar `composeFullOS360Card`:
  - Implementar pareamento hierárquico estrito de checklists: "Check-List de Inspeção" deve ser impresso imediatamente abaixo de "Checklist de Entrada", antes de "Checklist do Mecânico".
  - **Formatação Inteligente de Serviços e Peças:**
    - Converter caixa alta em Title Case limpo (`DIAGNOSTICO NACIONAL` -> `Diagnóstico Nacional`).
    - Higienizar placeholders do ERP (remover `(Preencher Executor...)`).
    - Suprimir códigos de catálogo longos `(AP89123803120)` da visualização padrão.
    - Implementar agrupamento semântico por sistemas mecânicos (⚡ Elétrica & Arrefecimento, 🔧 Suspensão & Rodagem, 🛑 Freios, 📦 Revisão/Apoio) com subtotais e cabeçalhos claros.
  - Utilizar delimitador explícito `\n\n---BLOCK---\n\n` entre seções temáticas para que `splitIntoWhatsAppBlocks` envie balões independentes e limpos no WhatsApp.
  - Implementar chunking inteligente de peças se a lista exceder 10 itens ou 800 caracteres para impedir o botão `... Ler mais` no smartphone.
  - Remover separadores de traços soltos no início de qualquer balão.

### Fase 3: Card Factual Enriquecido de Conversas e Histórico
- [x] `[COMPOSER]` Em `src/hydra-sync/os_situation_composer.ts`, atualizar `composeOSConversationCard`:
  - Receber os novos parâmetros de auditoria do ERP (`observacao`, `historicoCriadoEm`, `historicoCriadoPor`, `historicoAtualizadoEm`, `historicoAtualizadoPor`, `clienteTelefone`, `documentosAnexos`).
  - Quando a OS não tiver conversa analisada no grafo de IA, renderizar o bloco de Auditoria Operacional do ERP com datas, responsáveis, fotos/anexos, status do campo de observação e situação do telefone nos canais.
- [x] `[DISPATCHER]` Em `src/hydra-sync/agent_dispatcher.ts`, repassar os novos metadados da OS para `composeOSConversationCard` ao processar consultas sobre conversas e histórico (`isOSConv`).

### Fase 4: Validação, Build Gate e Testes Automatizados
- [x] `[TEST]` Criar suíte de testes `src/hydra-sync/tests/test_hermes_balloons_and_audit.ts`:
  - Validar divisão de balões com `---BLOCK---` e conformidade com limites de caracteres (<900 chars).
  - Validar pareamento hierárquico de checklists de inspeção sob o checklist de entrada.
  - Validar geração do card de conversas com histórico e auditoria do ERP para a OS #18503.
  - Validar ausência de asteriscos duplos `**` em todas as saídas.
- [x] `[GATE]` Executar esbuild syntax check garantindo zero erros sintáticos.
- [x] `[GATE]` Executar testes locais garantindo 100% PASS (39 testes aprovados).

---

## Critérios de Aceite
1. Consulta `"detalhes da os 18503"` despacha no WhatsApp balões separados e legíveis, com o bloco de peças separado e sem corte de `... Ler mais`.
2. O "Check-List de Inspeção" de Roberto Aquino aparece subordinado ao "Checklist de Entrada", acima de "Checklist do Mecânico".
3. Pergunta `"mas nao tem detalhes da conversa? e/ou historico cara"` responde com a auditoria fática do ERP (criador, atualizador, anotações e anexos) em vez de repetir uma única linha idêntica.
