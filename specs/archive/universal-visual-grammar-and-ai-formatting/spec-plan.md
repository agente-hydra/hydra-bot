# Plano de Implementação: Gramática Visual Universal do Hydra & Calibração de Formatação da IA

## Tarefas de Implementação

### 1. Camada de Prompt & Ensino da IA
- [x] [PROMPT] Atualizar `system_prompt.md` formalizando a **Gramática Visual Universal do Hydra (Hermes 2.0)**:
  - Primitiva 1: Super Cabeçalho Institucional (`*HYDRA | ...* \n *DD/MM/AAAA · HH:mm*`).
  - Primitiva 2: Títulos de Seção com Blockquote (`> *Nome da Seção*`).
  - Primitiva 3: Parágrafos de Narrativa Executiva (texto puro em prosa direta, sem bullets desnecessários).
  - Primitiva 4: Listas Chave-Valor Padronizadas (`- *Chave:* Valor`, sem marcadores duplos `* *`).
  - Primitiva 5: Cards de Entidade / OS em Árvore Indivisível (`*OS #XXXX — MODELO (PLACA)*` com joelhos `  └ ` e linha em branco entre cada OS).
  - Primitiva 6: Divisão Semântica de Balões (`\n\n---BLOCK---\n\n` entre seções lógicas para evitar quebras abruptas no mobile).
- [x] [PROMPT] Adicionar regras operacionais estritas no prompt:
  - Determinação de status: se houver data/hora de término preenchida, reportar como *Finalizada / Entregue*.
  - Proibição estrita de reticências (`...`) em nomes de clientes, veículos ou lojas.
  - Proibição de campos de metadados vazios (ex: `*Checklist de Entrada:* ` em branco).
- [x] [PROMPT] Atualizar `agent_dispatcher.ts` para injetar a Gramática Visual Universal em **todos** os turnos (inclusive quando a sessão de conversa já possui `agyConvId`), impedindo o drift do modelo.

### 2. Camada de Sanitização & Normalização Determinística (`format_utils.ts`)
- [x] [FORMAT] Adicionar normalizador de marcadores duplos de lista: converter `* *Chave:*` para `- *Chave:*`.
- [x] [FORMAT] Adicionar normalizador de títulos de OS com negrito parcial: converter `*OS #1129* — CORSA WIND (CYG2B02)` para negrito integral `*OS #1129 — CORSA WIND (CYG2B02)*`.
- [x] [FORMAT] Adicionar reparador determinístico de joelhos desmembrados em `alignWhatsAppList`:
  - Consolidar `└ *STATUS*` seguido de `└ *X dias*` em `└ Status: *STATUS* · *X dias* no pátio`.
  - Remover marcadores soltos `·` no fim de linha.
  - Preencher `Saldo:` sem valor como `*Quitado*` ou `*R$ 0,00*`.
- [x] [FORMAT] Adicionar normalizador de campos de checklist/documentos vazios: converter `- *Checklist:*` em branco para `- *Checklist:* Não informado / Pendente`.

### 3. Camada de Dados Operacionais (`db_repository.ts` & `operational_data_repository.ts`)
- [x] [DATA] Implementar função centralizadora `determineCanonicalOSStatus` em `db_repository.ts` e `operational_data_repository.ts` que considera como finalizada qualquer OS com `data_fim`, `hora_fim`, `finalizado_em` ou status faturado/entregue.
- [x] [DATA] Garantir que `clienteNome` nunca sofra truncamento ou corte em nenhuma query ou adaptador.

### 4. Compilação, Testes e Validação na VPS
- [x] [BUILD] Recompilar `format_utils.js` e `balloon_composer.js` via `esbuild`.
- [x] [TESTS] Adicionar testes unitários em `test_query_routing_and_formatting.ts` cobrindo:
  - Entrada do Exemplo 1 (08/10): `VOYAGE LS #18503` com marcadores `* *`, status finalizado com hora de término, nome completo do cliente sem `...` e checklists preenchidos.
  - Entrada do Exemplo 2 (09/10): `Jorge Beretta #1129` com título em negrito integral, joelhos unificados sem campos vazios e sem pontuação solta.
  - Preservação da Gramática Visual em múltiplos balões.
- [x] [DEPLOY] Sincronizar arquivos para `/home/operacional/hydra-deploy/current/` e `/opt/bots/`.
- [x] [PM2] Reiniciar `hydra-bot` e auditar logs de inicialização.

---

## Critérios de Aceite
1. **Gramática Universal em Todos os Turnos:** Em turnos iniciais e de continuidade, a resposta segue consistentemente a hierarquia de cabeçalho, seções com `> *...*`, listas com `- *...*` e cards de OS em árvore.
2. **Zero Bullets Duplos:** `* *Chave:*` é 100% eliminado em favor de `- *Chave:*`.
3. **Zero Títulos de OS com Negrito Parcial:** Títulos de OS são 100% em negrito contínuo `*OS #XXXX — MODELO (PLACA)*`.
4. **Zero Joelhos Desmembrados ou Vazios:** Nenhum joelho aparece sem nome de campo, sem valor ou com `·` solto.
5. **Status de OS com Término:** OSs com data/hora de finalização são sempre apresentadas como Finalizadas.
6. **Nomes de Cliente por Extenso:** Zero nomes abreviados com `...`.
7. **Suíte 100% Green:** Todos os testes unitários passando sem quebras.
