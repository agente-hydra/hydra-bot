# Proposta de Melhoria — Hermes Balões Executivos, Hierarquia de Vistorias e Auditoria de Conversas

**ID da Spec:** `hydra-hermes-balloons-and-os-audit`  
**Data:** 08/10/2026  
**Contexto:** Feedback direto da Diretoria com capturas de tela do WhatsApp evidenciando truncamento de texto com "... Ler mais", blocos amontoados em balão único, inversão visual da hierarquia de checklists e resposta repetitiva/muda quando questionado sobre detalhes do histórico e conversas da OS #18503 (Voyage LS).

---

## 1. Problemas Identificados

### Problema A: Truncamento no WhatsApp e Ausência de Quebra por Balões (`---BLOCK---`)
- **Evidência Visual:** Nas capturas de tela (`Captura de tela 2026-10-08 222.png` e `162810.png`), a resposta da OS foi entregue como uma única muralha de texto contínua de mais de 2.500 caracteres.
- **Impacto no Usuário:** O WhatsApp mobile trunca o texto exibindo o botão `... Ler mais`, escondendo a lista de peças e os blocos de pagamento e vistorias. Todas as seções aparecem coladas sem respiro visual.
- **Causa Raiz:** A função `composeFullOS360Card` unia os 6 blocos estruturados apenas com `\n\n`, e cada bloco iniciava com uma linha de traços `----------------------------------------`. Como a primeira linha não correspondia a um cabeçalho reconhecido por `isSectionHeader`, o algoritmo `splitIntoWhatsAppBlocks` não quebrou por tópicos, deixando a mensagem inteira condensada em um balão excessivo.
- **Diretriz do Usuário:** As peças e os blocos complementares devem residir em balões dedicados no WhatsApp.

### Problema A.1: Lista Monótona, em Caixa Alta e Indecifrável de Serviços e Peças
- **Evidência no Chat:** O usuário relatou textualmente: *"a lista de todos os serviços, dá até preguiça de ler de tão ruim que tá mano, tem formas melhores de apresentar essa porra"*.
- **Causa Raiz da Má Experiência Visual:**
  1. **Caixa Alta Gritante do ERP:** Todos os nomes vêm em maiúsculas sem tratamento (`DIAGNOSTICO NACIONAL`, `REMOÇAO ALTERNADOR`, `LIMPEZA SISTEMA ARREFECIMENTO`, `GITANES AGUA PARA BATERIA E RADIADOR`).
  2. **Poluição com Placeholders do ERP:** Textos internos como `(Preencher Executor...)` repetidos linha após linha poluem a tela.
  3. **Códigos de Barras / Referências Irrelevantes:** O usuário no WhatsApp não quer ler códigos de catálogo como `(AP89123803120)` ou `(111504154842)`.
  4. **Ausência de Agrupamento Semântico (Flat Dump):** Uma lista reta de 7 serviços e outra de 19 peças misturando elétrica, suspensão, freios, arrefecimento e logística em ordem aleatória de digitação, sem subtotais e sem categorias escaneáveis.
  5. **Falta de Destaque por Valor:** Itens de R$ 26,00 aparecem no mesmo peso visual que itens de R$ 1.260,00 ou R$ 680,00.

### Problema B: Inversão Hierárquica no Bloco "Vistorias e Documentos"
- **Evidência Visual:**
  ```text
  > Vistorias e Documentos
  - Checklist de Entrada: Realizado
  - Checklist do Mecânico: Pendente
   └ Check-List de Inspeção: Finalizado (Roberto Aquino Carneiro Lima, 02/10/26)
  - Nota Fiscal: Não emitida para esta OS.
  - Anexos: 2 documento(s) arquivado(s).
  ```
- **Impacto no Usuário:** O usuário apontou expressamente: *"era pro coisinho do checklist de inspeção estar ABAIXO DO DE ENTRADA e não abaixo dos 2, aí fica td confuso pra cacete mano"*. A renderização atual dá a falsa impressão de que a inspeção de Roberto Aquino pertence ao Checklist do Mecânico (que está Pendente).
- **Causa Raiz:** Em `os_situation_composer.ts`, o código emitia primeiro as duas linhas de status resumido (`Checklist de Entrada` e `Checklist do Mecânico`) e só depois iterava pela lista `params.checklists`, fazendo com que a inspeção de entrada do consultor ficasse indentada após o checklist do mecânico.

### Problema C: Resposta Repetitiva e Vazia sobre Histórico de Conversas
- **Evidência no Chat:**
  ```text
  [16:28] Davi: mas nao tem detalhes da conversa? e/ou historico cara
  [16:28] Hydra Agent: > OS #18503 — VOYAGE LS (LZQ0669) | Histórico e Conversas
  - Loja: MPplanalto
  - Status: ABERTO (Em Aberto)
  - Permanência: 6 dia(s) no pátio
  - Cliente: MAURO LUIZ RODRIGUES BU...

  > Posição de Atendimento no Grafo
  - Última Interação Registrada: 02/10/26 13:24
  ```
- **Impacto no Usuário:** O bot respondeu exatamente o mesmo stub mudo duas vezes, sem detalhar o que de fato aconteceu.
- **Causa Raiz:** Quando consultado por conversas/histórico sem registro no grafo de IA (`coverage === 'NOT_IN_ANALYSIS'`), o sistema caía em fallback direto que retornava apenas a data de abertura da OS (`02/10/26 13:24`). Não eram extraídas nem apresentadas as informações fáticas reais disponíveis no ERP e no histórico operacional:
  1. Abertura da OS por Roberto Aquino Carneiro Lima em 02/10/2026 às 13:24.
  2. Última alteração no sistema por Marcos Vinycius em 06/10/2026 às 17:29.
  3. Campo de Observação no sistema em branco (nenhum registro ou alinhamento textual lançado na OS pelo consultor).
  4. Documentos e anexos arquivados com datas (comprovante `DOCUMENTO` de 06/10 e foto/anexo `CCI_001246.jpg` de 07/10).
  5. Telefone do cliente cadastrado `(11) 97444-3375` consultado no Chatwoot sem conversas de chat vinculadas.

---

## 2. Solução Proposta

1. **Particionamento Nativo de Balões Hermes com Delimitador `---BLOCK---`:**
   - `composeFullOS360Card` separará estruturalmente os balões utilizando o delimitador canônico `\n\n---BLOCK---\n\n`:
     - **Balão 1 (Cabeçalho & Atendimento):** Dados do veículo, pátio, cliente, valor/saldo e status da negociação/grafo.
     - **Balão 2 (Serviços Discriminados):** Todos os serviços com seus respectivos executores.
     - **Balão 3 (Peças e Insumos):** Lista discriminada de peças com quantidades, valores e códigos (subdividido automaticamente em `---BLOCK---` se exceder 800 caracteres para listas com >12 itens).
     - **Balão 4 (Pagamento e Vistorias):** Formas de pagamento, parcelas, checklists hierarquizados e anexos.
   - Cada balão inicia no topo com seu próprio cabeçalho em blockquote (`> *Título*`), eliminando linhas de traços no topo do balão e garantindo que o WhatsApp mobile nunca force o corte com `... Ler mais`.

2. **Hierarquização Fiel dos Checklists:**
   - O item `Check-List de Inspeção` (ou qualquer checklist de entrada/recepção) será renderizado **imediatamente abaixo** de `- Checklist de Entrada:`:
     ```text
     > *Vistorias e Documentos*
     - Checklist de Entrada: Realizado
       └ Check-List de Inspeção: Finalizado (Roberto Aquino Carneiro Lima, 02/10/26)
     - Checklist do Mecânico: Pendente
     - Nota Fiscal: Não emitida para esta OS.
     - Anexos: 2 documento(s) arquivado(s).
     ```
   - Se houver checklist técnico do mecânico, ele será indentado imediatamente abaixo de `- Checklist do Mecânico:`.

3. **Card Enriquecido de Histórico e Evidências Operacionais (`composeOSConversationCard`):**
   - Quando o operador indagar por detalhes do histórico ou conversa, o card consolidará todas as evidências fáticas reais:
     - **Tratativas de Balcão / WhatsApp:** Se não houver conversa vinculada no Chatwoot/Grafo, declarar claramente: *Nenhum diálogo registrado nos canais integrados para o telefone (11) 97444-3375*.
     - **Anotações da OS no ERP:** Verificar o campo de observações. Se vazio: *Campo de observações da OS em branco no ERP (sem autorizações anotadas)*; se preenchido, exibir na íntegra.
     - **Auditoria de Movimentações:** Identificar quem criou a OS (`Roberto Aquino em 02/10 às 13:24`) e quem realizou a última atualização (`Marcos Vinycius em 06/10 às 17:29`).
     - **Linha do Tempo de Anexos:** Listar os comprovantes e fotos anexados com datas (`06/10: DOCUMENTO`, `07/10: CCI_001246.jpg`).

---

## 3. Risco Principal e Mitigação
- **Risco:** Fragmentação excessiva em mensagens curtas no WhatsApp incomodar o operador.
- **Mitigação:** Limitar estritamente a 3 ou 4 balões lógicos agrupados por afinidade temática (Cabeçalho+Grafo, Serviços, Peças, Financeiro+Vistorias). Balões com menos de 280 caracteres nunca serão isolados.
