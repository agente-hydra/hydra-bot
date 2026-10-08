# Proposta: Isolamento Estrito de Escopo de Loja por Persona de Gerente (Manager Store Scope)

**ID da Spec:** `manager-store-scope`  
**Data:** 30/09/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply manager-store-scope`)  
**Papel do Agente Atual:** Orquestrador e Integrador Principal  
**Base de Código:** Branch de Staging `codex/manager-store-scope` / Produção no commit ativo da VPS Operacional (`100.126.50.101`)

---

> [!IMPORTANT]
> **DIRETRIZ DE ORQUESTRAÇÃO E DELEGAÇÃO PURA (ZERO CONFLITO NA VPS):**
> O Agente Principal atua como **Orquestrador e Integrador**.
> Para não conflitar com outros agentes ativos na VPS operacional e garantir responsabilidades estritas, o trabalho é estruturado em **3 Executores Especialistas** operando em módulos isolados:
> - **Executor A:** Identidade, Perfil e Comandos Determinísticos (`command_interceptor.ts`).
> - **Executor B:** Consultas e Fontes de Dados Operacionais (`manager_store_access.ts`, `operational_adapter.ts`).
> - **Executor C:** Dispatcher e Suíte de Testes com Sentinelas (`agent_dispatcher.ts`, testes de escopo).
> - **Agente Principal:** Integração final no [webhook-listener.js](file:///home/operacional/hydra/webhook-listener.js), cancelamento in-flight de respostas/lotes de perfil anterior, build gate e validação em produção.
>
> **CIRCUIT BREAKER DE SDD:**
> Esta fase restringe-se exclusivamente à especificação formal da proposta, design e plano. Nenhuma alteração em código de produção ou staging é realizada antes da autorização expressa via `/vibe-apply manager-store-scope`.

---

## 1. Problema Observado e Evidência

No teste recente de validação do Hydra:
1. Com a persona de gerente da loja Dom Pedro ativa (`/dompedro`), o usuário realizou perguntas sobre faturamento da rede e dados da unidade Kennedy.
2. O bot respondeu fornecendo o faturamento consolidado da rede e detalhes da Kennedy, vazando dados externos ao escopo da loja.
3. **Causa Raiz Identificada:**
   - A arquitetura anterior tratava o escopo de loja como uma mera preferência conversacional (herança de elipses). Quando o usuário mencionava palavras como `"rede"`, `"lojas"` ou o nome de outra unidade, o roteador e a IA quebravam a herança e retornavam dados globais.
   - O adaptador geral (`operational_adapter.ts`) e as chamadas aos workers de IA (`dual_worker_router.ts`) possuem consultas globais irrestritas à rede.
4. **Revogação Explícita de Regra Anterior:**
   - A regra de domínio de 2026-09-29 ("expressões generalistas quebram a herança de loja e resetam para escopo global") aplica-se **exclusivamente à persona de Sócio**.
   - Na persona de **Gerente**, o escopo da loja é um **boundary de segurança intransponível**. Qualquer tentativa de acessar dados da rede ou de outra loja deve ser sumariamente bloqueada.

---

## 2. Objetivos e Requisitos do Sistema

1. **Isolamento Estrito da Persona de Gerente:**
   - Em modo gerente, toda e qualquer consulta deve ser restrita à loja ativa autorizada (`loja_slug`).
   - Se o pedido mencionar explicitamente a rede (`"rede"`, `"lojas"`, `"ranking"`, `"todas"`) ou outra loja do catálogo (ex: `"Kennedy"`, `"Jabaquara"`), o bot deve recusar imediatamente a consulta com a mensagem determinística:
     `> *No perfil de gerente, só posso consultar dados da sua loja. Use /perfil para conferir a unidade ativa.*`
   - Zero chamadas a LLM, MCP ou consultas amplas à rede quando o usuário estiver em modo gerente.
2. **Governança de Identidade e Bloqueio de Elevação de Privilégios:**
   - Apenas contas com permissão de administração/teste (Davi `5511996242812` e Marcos `5511970671717`) possuem autorização para alternar perfis via `/socio` ou `/{loja}`.
   - Contas de gerentes reais cadastradas no sistema não podem utilizar `/socio` nem comandos de outras lojas para elevar seus privilégios. Ausência de perfil ou falha de leitura resulta em acesso negado seguro.
3. **Tratamento Imediato de Comandos Inválidos:**
   - Comandos com erro de digitação (ex: `/dompeddro`, `/menuu`, `/loja`) devem ser interceptados no Ingress e responder deterministamente:
     `> *Comando não reconhecido. Use /menu para ver os comandos disponíveis.*`
   - Nenhum comando desconhecido deve atingir o pipeline de IA ou adaptadores operacionais.
4. **Cancelamento em Voo e Troca Segura de Perfil (Anti-Vazamento):**
   - Ao executar `/socio`, `/{loja}` ou `/reset`:
     - O webhook deve cancelar imediatamente qualquer lote em debounce (`messageBatcher.markBatchObsolete`).
     - Abortar requisições em processamento ativo (`InFlightAbortRegistry.getInstance().abort(phone)`).
     - Limpar a fila de processamento da conversa (`activeChatQ.queue = []`).
     - Parar imediatamente o timer de presença `composing` e enviar `paused` para a Evolution API.
     - Garantir que nenhuma resposta pendente do perfil anterior seja entregue após a confirmação da troca.

---

## 3. Divisão de Frentes por Executor Especialista

| Executor | Frente de Trabalho | Arquivos Exclusivos | Escopo e Responsabilidade |
| :--- | :--- | :--- | :--- |
| **Executor A** | Identidade, Perfil e Comandos | `command_interceptor.ts`, `tests/test_commands_composer.ts` | Política de acesso baseada em identidade autenticada, persona ativa e loja autorizada. Bloqueio de elevação de privilégio. Rejeição determinística de comandos inválidos sem passar por IA. |
| **Executor B** | Consultas e Fontes Operacionais | `manager_store_access.ts`, `operational_adapter.ts` | Enforcement de `loja_slug` em 100% das queries SQL (metas, CMV, áreas, OSs, aging). Detecção de termos externos (`isOutsideManagerStore`). Recusa de consultas mistas ou de rede sem expor dados. |
| **Executor C** | Dispatcher e Testes de Segurança | `agent_dispatcher.ts`, `tests/test_manager_store_access.ts` | Desvio pré-IA para `executeManagerStoreQuery` quando `persona === 'gerente'`. Expurgo de referências a outras lojas no contexto de turno. Suíte de testes com sentinelas cruzados. |
| **Agente Principal** | Orquestração, Webhook e Deploy | `webhook-listener.js`, integração dos patches, PM2 | Cancelamento in-flight de respostas/lotes de perfil anterior no webhook, build gate (`tsc --noEmit`), recarga do PM2 e teste de sanidade com números autorizados. |

---

## 4. Riscos Mapeados e Mitigações

1. **Risco de Vazamento por Anáfora ou Pergunta Mista:**
   - *Exemplo:* "Qual a pior área da loja e quanto a rede faturou?"
   - *Mitigação:* `executeManagerStoreQuery` inspeciona a mensagem e sub-intenções decompostas. Se qualquer parte violar o escopo da loja, o pedido inteiro é recusado, sem processar a parte permitida acompanhada de vazamento.
2. **Risco de Conflito com Outros Agentes na VPS:**
   - *Mitigação:* O Agente Principal coordena a aplicação sequencial de patches isolados e trabalha em branch dedicada `codex/manager-store-scope` em staging (`/home/operacional/hydra-staging/`) antes de qualquer alteração no diretório de produção.
3. **Risco de Condição de Corrida na Troca de Perfil:**
   - *Exemplo:* Usuário pede faturamento da rede como sócio e imediatamente digita `/dompedro`. A resposta da rede chega após o `/dompedro`.
   - *Mitigação:* O `InFlightAbortRegistry` e o descarte de lote no `webhook-listener.js` invalidam o job antigo antes de confirmar o novo perfil.

---

## 5. Critérios de Aceite para Produção

- [ ] **Critério 1 (Isolamento Total):** Com `/dompedro` ativo, perguntas como "faturamento da rede", "qual o faturamento das lojas", "como tá a Kennedy", "ranking de lojas" retornam recusa padronizada com 0 dados externos.
- [ ] **Critério 2 (Dados da Própria Loja Funcionando):** Com `/dompedro` ativo, perguntas sobre faturamento, meta, CMV, CMV de óleo, OSs abertas e placas da Dom Pedro respondem corretamente com base no banco.
- [ ] **Critério 3 (Testes com Sentinelas):** Suíte unitária `test_manager_store_access.ts` com dados sentinela (ex: Kennedy com R$ 999.999 e Dom Pedro com R$ 100) atesta 100% de aprovação e ausência de contaminação cruzada.
- [ ] **Critério 4 (Comandos Inválidos):** `/dompeddro`, `/menuu` respondem "Comando não reconhecido" sem disparar IA nem consumir quota.
- [ ] **Critério 5 (Cancelamento em Voo):** Troca de persona durante processamento encerra presença `composing` e aborta envio anterior.
- [ ] **Critério 6 (Build Gate):** `tsc --noEmit` com zero erros e regressão total de testes aprovada.
