# Proposta de Arquitetura: Padronização Hermes 360° da OS & Continuidade do Grafo de Conversas

**Spec ID:** `hydra-os-360-formatting-and-conversation-continuity`  
**Data:** 08/10/2026  
**Status:** Planejamento  

---

## 1. Problema Identificado

1. **Degradação na Formatação da Ordem de Serviço (Layout Feio e Incompleto):**
   - Ao consultar uma OS (ex: Voyage LZQ0669 na Planalto, OS #18503), a resposta foi gerada em formato desestruturado, sem a tipografia executiva padrão Hermes, sem divisores visuais `----------------------------------------` e, criticamente, **omitindo 100% das peças e materiais aplicados** (que correspondiam a R$ 4.890,20 do total de R$ 6.731,10 da ordem).
   - O card da OS deixou de incluir a situação operacional vinda do Grafo de Atendimento (motivo de retenção no pátio, peças que faltam e próximo passo prometido).

2. **Perda de Continuidade Conversacional (Quebra de Contexto / Anáfora):**
   - Imediatamente após visualizar os dados do Voyage, o operador perguntou:
     `ok mas nao temcesso a nenhuma conversa?`
   - O roteador de intenções não associou a pergunta à OS ativa (#18503), descartou a memória de curto prazo do turno e encaminhou o texto solto ao modelo de linguagem.

3. **Alucinação Institucional de "Falta de Acesso a Conversas de Balcão":**
   - O LLM, recebendo a pergunta descontextualizada e sem ferramentas de conversa no prompt, gerou uma resposta genérica alucinada ("HYDRA | Acesso e Visibilidade de Conversas") afirmando categoricamente que *não tem acesso às conversas entre consultor e cliente*, ignorando completamente o **Grafo de Atendimento** (`hydra_case_graph`, `hydra_afirmacoes_analisadas`, `hydra_case_current_position`) construído exatamente para registrar esses diálogos, prazos e aprovações.

---

## 2. Solução Arquitetural Proposta

### 2.1. Formatação Canônica Executiva Hermes 360° (Template Determinístico Obrigatório)
Toda consulta a uma OS ou veículo específico (seja direta ou via LLM) deve utilizar compulsoriamente o layout oficial Hermes em 6 blocos delimitados:
1. **Cabeçalho Executivo:**
   `> *OS #XXXX — MODELO (PLACA)*`
   `- *Loja:* [Unidade]`
   `- *Status:* *[STATUS]* ([Aberta/Finalizada])`
   `- *Permanência:* [X] dias no pátio`
   `- *Cliente:* [Nome Completo]`
   `- *Valor Total:* *R$ X.XXX,XX* (Saldo: *R$ X.XXX,XX*)`
2. **Situação e Atendimento (Grafo de Atendimento):**
   `----------------------------------------`
   `> *Situação e Atendimento*`
   `- *Motivo Operacional:* [Motivo documentado do Grafo / Peças / Orçamento]`
   `- *Próximo Passo Prometido:* [Próxima ação documentada]`
   `- *Última Interação Registrada:* [Data e canal]`
3. **Serviços Discriminados:**
   `----------------------------------------`
   `> *Serviços Discriminados*`
   `- [SERVIÇO]: *R$ [VALOR]* ([EXECUTOR])`
4. **Peças e Materiais Aplicados (Obrigatório — Nunca Omitir):**
   `----------------------------------------`
   `> *Peças e Materiais Aplicados*`
   `- [PEÇA]: [QTD]x *R$ [VALOR]* ([CÓDIGO])`
   *(Se não houver peças cadastradas mas houver diferença entre valor total e serviços, discriminar analiticamente: `- Peças / Reparo de Bancada: *R$ [SALDO]*`)*
5. **Formas de Pagamento e Parcelas:**
   `----------------------------------------`
   `> *Formas de Pagamento*`
   `- Parcela X: *R$ [VALOR]* ([MODALIDADE], Venc: [DATA])`
6. **Vistorias e Documentos:**
   `----------------------------------------`
   `> *Vistorias e Documentos*`
   `- *Checklist de Entrada:* [✅ Realizado / ⚠️ Pendente]`
   `- *Checklist do Mecânico:* [✅ Realizado / ⚠️ Pendente]`
   `- *Nota Fiscal:* [Emitida / Não emitida]`
   `- *Anexos:* [X documentos arquivados]`

### 2.2. Continuidade Conversacional (Anáfora de Conversas da OS)
- Quando o usuário enviar mensagens curtas ou perguntas de continuidade sobre conversas logo após uma OS ativa:
  `"tem acesso a alguma conversa?"`, `"o que falaram?"`, `"o que o cliente disse?"`, `"qual a conversa?"`, `"tem áudio?"`, `"o que foi combinado?"`
- O `agent_dispatcher.ts` e `intent_rewriter.ts` devem herdar compulsoriamente a OS ativa (`TurnState.osId`), invocar o Grafo de Atendimento (`getCaseContext` / `get_os_case_history`) e responder com o histórico factual das conversas daquela OS.

### 2.3. Blindagem Anti-Alucinação no Prompt do Sistema
- Atualizar `system_prompt.md` e o catálogo de ferramentas MCP para registrar formalmente que o Hydra **possui acesso ao Grafo de Atendimento e às análises de conversas com clientes da OS**.
- Proibição absoluta de mensagens automáticas afirmando que conversas de WhatsApp com clientes "não passam pelo sistema". Se não houver conversa vinculada para uma OS específica, a IA deve declarar honestamente:
  `> *Conversas e Alinhamentos — OS #XXXX*\n- Nenhuma conversa ou aprovação de cliente foi vinculada a esta OS no Grafo de Atendimento até o momento.`

---

## 3. Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| **OS sem peças cadastradas no sistema gerando saldo fantasma** | Médio | Se a OS tiver saldo em peças mas sem itens cadastrados no ERP, discriminar explicitamente como `Peças / Reparo de Bancada: R$ X.XXX,XX`, garantindo que a soma bata perfeitamente com o total da OS. |
| **Troca de veículo em perguntas sequenciais** | Baixo | Se a mensagem trouxer explicitamente outro modelo ou placa, o resolvedor sobrepõe o contexto anterior. Se for pergunta de continuidade ("e as conversas?", "o que falaram?"), preserva a OS anterior. |
| **Alucinação de diálogos inexistentes** | Alto | O Grafo de Atendimento só relata afirmações com evidência concreta e status de validação factual comprovado no banco SQLite. |
