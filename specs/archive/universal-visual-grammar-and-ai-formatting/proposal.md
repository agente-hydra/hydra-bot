# Proposta de Arquitetura: Gramática Visual Universal do Hydra & Calibração de Formatação da IA

## 1. Problema e Diagnóstico

### 1.1 Sintoma Apontado pelo Operador
O operador solicitou enfaticamente que a formatação do Hydra não seja tratada de forma casuística ("relatório X faz de um jeito, relatório Y de outro"), mas sim através de uma **padronização universal ensinada diretamente à IA** para que qualquer resposta, relatório, diagnóstico ou situação de veículo venha naturalmente com a hierarquia, cabeçalhos, títulos, subtítulos, listas, cards e divisões de balões corretos.

O operador anexou dois exemplos reais com anotações pontuais de defeitos:
1. **Exemplo 1 (Situação Operacional / Detalhes de OS):**
   - Status relatado como `ABERTO` quando a OS possui hora/data de finalização (`se tiver hora de finalizacao ent considere finalizado`).
   - Nome do cliente truncado com reticências (`* *Cliente:* MAURO LUIZ RODRIGUES BU... ------> deixe completo`).
   - Marcador duplo defeituoso gerado pela IA (`* *Chave:* Valor` em vez de lista uniforme `- *Chave:* Valor`).
   - Seções de checklists/documentos com campos vazios (`*Checklist de Entrada:* ` com dois-pontos sem valor).
2. **Exemplo 2 (Diagnóstico de Pátio / Listagem de Unidade):**
   - Título de OS com negrito parcial (`*OS #1129* — CORSA WIND (CYG2B02)` em vez de negrito integral `*OS #1129 — CORSA WIND (CYG2B02)*`).
   - Joelhos desmembrados e sem rótulo (`  └ *AGUARDANDO RETIRADA*`, `  └  *8 dias* no pátio`).
   - Pontuação solta e campos vazios (`  └ *Total da OS* R$ 905,00 ·`, `  └ *Saldo:*  `).
   - Fragmentação irregular entre balões.

### 1.2 Causa Raiz
1. **Ausência de Diretrizes Estruturais nos Turnos de Continuidade (`agent_dispatcher.ts`):** Quando uma conversa já possui `agyConvId`, o despachante enviava apenas um lembrete minimalista em parênteses. A IA perdia a referência completa da gramática visual Hermes 2.0 e passava a inventar layouts híbridos (`* *Chave:*`, negrito parcial em títulos, campos desmembrados sem chave).
2. **Falta de Ensino Explícito das Primitivas Visuais:** O prompt do sistema não ensinava a IA como compor cada nível da hierarquia:
   - Super Cabeçalho Institucional vs. Cabeçalho de Entidade Individual.
   - Títulos de Seção em Blockquote (`> *Seção*`).
   - Parágrafos de Narrativa Executiva (texto puro sem bullets).
   - Listas de Propriedades (`- *Chave:* Valor`).
   - Cards de Entidade em Árvore com Joelhos Indivisíveis (`  └ `).
   - Divisão semântica de balões via `\n\n---BLOCK---\n\n` entre blocos lógicos.
3. **Regras Fatuais Não Calibradas:**
   - A determinação de status no banco e no prompt priorizava flags textuais ambíguas (`status_grid = 'ABERTO'`), ignorando `data_fim` / `hora_fim` / `finalizado_em`.
   - A IA truncava nomes longos de clientes com `...` por vício de brevidade do LLM.
   - A IA emitia chaves de metadados vazias quando o campo não continha valor no ERP.
4. **Sanitizador Reativo em vez de Normativo:** O sanitizador `format_utils.ts` continha regexes fragmentados focados em strings específicas em vez de normalizar de forma determinística e idempotente a gramática visual inteira.

---

## 2. Solução Proposta

### 2.1 A Gramática Visual Universal do Hydra (Hermes 2.0)
Definir e ensinar à IA (via `system_prompt.md`, `HERMES_DIRECTIVES` persistente em todos os turnos e few-shots canônicos) as 6 primitivas universais:

```
[PRIMITIVA 1: Super Cabeçalho Institucional (Diagnósticos / Visões Globais)]
*HYDRA | Tema do Relatório | Unidade ou Rede*
*DD/MM/AAAA · HH:mm*

[PRIMITIVA 2: Título de Seção (Blockquote com Negrito)]
> *Nome da Seção*

[PRIMITIVA 3: Narrativa Executiva (Contexto e Análise Factual)]
Texto corrido em prosa direta, sem marcadores, trazendo métricas consolidadas.

[PRIMITIVA 4: Lista Chave-Valor (Propriedades e Métricas Gerais)]
- *Chave:* Valor completo e auditado

[PRIMITIVA 5: Card de Entidade / OS (Árvore com Joelhos Indivisíveis)]
*OS #XXXX — MODELO (PLACA)*
  └ Status: *[Status]* · *[X dias]* no pátio
  └ Financeiro: Total *R$ X.XXX,XX* · Saldo: *[R$ X.XXX,XX ou Quitado]*
  └ Operação: Resp: [Nome] · Cliente: [Nome Completo]

[PRIMITIVA 6: Divisor Semântico de Balões]
\n\n---BLOCK---\n\n
(Usado entre seções lógicas para particionar mensagens longas em balões de 600-800 caracteres sem quebrar seções ou cards ao meio)
```

### 2.2 Regras de Negócio e Dados Fatuais
1. **Regra de Finalização de OS:** Se a OS possuir data/hora de finalização (`data_fim`, `hora_fim`, `finalizado_em`, `dt_termino`, `dt_fechamento`) ou se `is_aberta = 0` / status contiver `finalizada|entregue|faturada`, ela DEVE ser informada como *Finalizada* / *Entregue*, mesmo que outro campo textual legado diga "ABERTO".
2. **Regra de Nome Completo:** Proibição absoluta de reticências (`...`) ou truncamento em nomes de clientes. O nome retornado pela base/ferramenta deve ser exibido por extenso.
3. **Regra de Não-Omissão de Campos:** Nunca gerar chave sem valor (ex: `*Checklist de Entrada:* ` em branco). Se não houver registro ou anexo, indicar explicitamente: `Não realizado / Pendente` ou `Nenhum anexo registrado`.
4. **Regra de Joelhos Completos:** Cada joelho `  └ ` deve conter seu identificador de campo (`Status:`, `Financeiro:`, `Operação:`). NUNCA separar status e dias de pátio em linhas distintas e NUNCA deixar pontuações soltas (`·`) ou `Saldo:` vazio.

### 2.3 Camada Sanitizadora e Compositora Universal (`format_utils.ts` & `balloon_composer.ts`)
- Normalização universal de marcadores de lista: converter `* *Chave:*` para `- *Chave:*`.
- Normalização universal de títulos de OS: converter títulos parcialmente em negrito (ex: `*OS #1129* — CORSA WIND (CYG2B02)`) para negrito integral `*OS #1129 — CORSA WIND (CYG2B02)*`.
- Consolidação determinística de joelhos desmembrados:
  - Se um joelho vier como `  └ *STATUS*` seguido de `  └ *X dias*`, unificar em `  └ Status: *STATUS* · *X dias* no pátio`.
  - Remover marcadores soltos `·` no fim de linha.
  - Se `Saldo:` estiver vazio ou sem valor, calcular ou preencher como `*Quitado*` / `*R$ 0,00*`.
- Particionamento semântico de balões com respeito rigoroso às seções `> *Seção*` e aos delimitadores `---BLOCK---`.

---

## 3. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **Drift do modelo em conversas longas** | Médio | Injetar o bloco de Gramática Visual Hermes em **todos** os turnos no despachante, não apenas no primeiro turno. |
| **Quebra de testes legados** | Baixo | A suíte de 59 testes de roteamento e formatação já valida asserções de joelho e ausência de tabelas; adicionar novos casos de teste cobrindo os exemplos reais de 08/10 e 09/10. |
| **Inconsistência de status em OSs antigas** | Baixo | `parseOSDetailRow` e `operational_data_repository.ts` inspecionam formalmente `data_fim` e `hora_fim` para consolidar o status booleano e textual. |
