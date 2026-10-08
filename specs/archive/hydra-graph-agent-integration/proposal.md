# Proposta: Integração do Grafo de Atendimentos nas Buscas do Hydra Agent & Estabilização de Presença WhatsApp

## 1. Contexto e Problema Atual

Atualmente, o Hydra Agent opera em produção com duas camadas de busca:
1. **Busca Operacional ERP / SQLite:** Consulta status de pátio, faturamento, ordens de serviço (`ordens_servico`), busca textual (FTS5) e busca vetorial (`sqlite-vec`).
2. **Auditoria de Conversas (Watchdog):** Audita conversas de WhatsApp dos gerentes após a janela de 20 minutos de inatividade (`sliding idle debounce`), mas persiste seus resultados primariamente em memória/Redis (`state:conv:${id}`).

Embora a infraestrutura do **Grafo de Casos e Atendimentos** (`hydra-case-history-graph` v2.1) esteja 100% desenvolvida e testada com 26 gates aprovados localmente (`src/hydra-sync/case_graph_projection.ts`, `case_memory_reader.ts`, `real_analysis_repository.ts`), existem dois gargalos críticos na experiência do usuário:

### Gargalo A: Desacoplamento do Grafo nas Buscas
- Quando o usuário pergunta pelo WhatsApp: *"Como tá a situação do Linea do Jabaquara?"* ou *"Por que a OS 501 tá demorando?"*, o agente consulta apenas o estado do ERP (dias no pátio, valor, status da oficina) e um campo simples `raw_payload`.
- A IA **não tem acesso ao Grafo de Atendimentos**: não sabe o que o consultor prometeu ao cliente no WhatsApp, se o orçamento foi aprovado pelo cliente, se faltou uma peça específica (saldo de peças) ou qual foi o motivo real do atraso informado.
- Por outro lado, expor o grafo bruto de nós e arestas (`nodes`, `edges`) diretamente para uma LLM via MCP geraria **sobrecarga cognitiva, alto consumo de tokens, latência excessiva e risco de alucinação**.

### Gargalo B: Instabilidade e "Pisca-Pisca" do Indicador "Digitando..." no WhatsApp
- **Comportamento Atual:** No início do processamento, o webhook dispara um único sinal `sendPresence(phone, 'composing', 1000)`. Esse sinal expira em 2 a 3 segundos na Evolution API/WhatsApp.
- Enquanto a IA pensa, consulta ferramentas MCP e processa a resposta (janela de 5s a 20s), o indicador de digitação **desaparece completamente**. O usuário fica no vácuo sem saber se o bot travou, morreu ou parou.
- Imediatamente antes de enviar os balões finais, o sistema dispara outro `sendPresence` de ~1s e envia. O efeito no celular do usuário é um pisca-pisca confuso: *"digitando..."* aparece 1s, some por 15s, reaparece por 0.5s e entrega a mensagem.

---

## 2. Solução Proposta: Arquitetura Híbrida de Baixo Impacto (Zero Conflito)

A estratégia recomendada para integrar o Grafo nas buscas sem conflitar com nada existente e tornando o consumo trivial para a IA é dividida em **3 pilares operacionais**:

```
[ Usuário envia mensagem no WhatsApp ]
             │
             ├──▶ 1. Heartbeat Contínuo de Presença ("Digitando..." Estável)
             │       - Inicia loop de presença (pulso a cada 4s)
             │       - Mantém "digitando..." ativo sem interrupções durante todo o raciocínio
             │       - Desativa limpo no envio do 1º balão ou em abort (/reset)
             │
             ├──▶ 2. Fast-Path Determinístico (Perguntas Diretas de Veículo/OS)
             │       - "como tá o Linea", "OS 501", placa "ABC1234"
             │       - resolveCaseContext lê o Grafo diretamente em <5ms (custo $0, sem LLM)
             │       - Retorna balão WhatsApp nativo cruzando Oficina + Grafo
             │
             └──▶ 3. Camada Autônoma LLM / MCP (Perguntas Analíticas & Follow-ups)
                     - "por que atrasou?", "o que o consultor prometeu?", "quais peças faltam?"
                     - Ferramenta MCP cirúrgica: `get_os_case_history(os_id, loja_slug)`
                     - Enriquecimento transparente em `get_os_details`
                     - Retorna JSON sintetizado de fatos (zero nós/arestas brutos para a LLM)
```

### Por que esta abordagem não conflita e não atrapalha a IA:
1. **Presença Firme e Confiável:** O usuário vê o status "digitando..." contínuo e estável do início ao fim do processamento, transmitindo certeza de que a IA está trabalhando na consulta.
2. **Zero Nós/Arestas Brutos para a LLM:** A IA não recebe grafos matemáticos complexos. Ela recebe uma síntese factual mastigada (`aprovacao_orcamento`, `motivo_atraso_declarado`, `saldo_pecas_pendentes`, `proximo_passo_prometido`).
3. **Latência Mínima no Fast-Path:** Perguntas triviais sobre um carro específico continuam sendo respondidas em milissegundos sem gastar tempo de chamada de LLM.
4. **Retrocompatibilidade com Ferramentas Existentes:** A ferramenta `get_os_details` já usada com frequência pela LLM passa a incluir um bloco opcional `historico_atendimento` quando houver projeção no grafo, permitindo que a IA aproveite os dados mesmo sem aprender um comando novo.
5. **Isolamento Estrito de Segurança (RBAC):** Gerentes só acessam histórico de casos da sua loja autorizada. Tentativas de consulta cross-store são bloqueadas na raiz.
6. **Regra de Ouro Anti-Alucinação:** Se o grafo não possuir motivo documentado de atraso para aquela OS, a resposta declara honestamente a limitação factual (`limitationDeclared: true`), impedindo que a IA invente "falta de peças" ou "mecânico ausente".

---

## 3. Contratos de Dados Resumidos

### A. Ferramenta MCP: `get_os_case_history`
- **Entrada:** `{ os_id: string, loja_slug?: string }`
- **Saída:**
  ```json
  {
    "status": "AVAILABLE",
    "os_id": "501",
    "loja_slug": "jabaquara",
    "veiculo": "Fiat Linea (ABC1234)",
    "status_oficina": "EM ANDAMENTO",
    "dias_patio": 4,
    "origem_evidencia": "GRAPH_PROJECTION",
    "posicao_consolidada": {
      "status_aprovacao": "APROVADO_V1",
      "orcamento_pendente": null,
      "motivo_atraso_documentado": "Aguardando sensor de rotação da concessionária",
      "proximo_passo_prometido": "Montagem prevista para amanhã às 14h",
      "data_ultimo_contato": "2026-10-05T12:00:00Z",
      "saldo_pecas": [
        { "peca": "Sensor de Rotação", "solicitado": 1, "chegou": 0, "status": "PENDENTE" }
      ],
      "gaps_cobertura": []
    },
    "limitacao_declarada": false
  }
  ```

### B. Gestor de Presença: `PresenceHeartbeatKeeper`
- **Contrato Operacional:**
  - `start(phone: string)`: Dispara imediatamente `sendPresence(phone, 'composing')` e agenda repetições a cada 4.000ms com timeout seguro de 60s.
  - `stop(phone: string)`: Cancela o timer e encerra o ciclo de presença antes da entrega do primeiro balão.
  - `isAborted`: Interrompe o pulso imediatamente se `/reset` for invocado.

---

## 4. Riscos Principais e Mitigações

1. **Risco:** Latência adicional ao consultar o grafo durante o turno da LLM.  
   **Mitigação:** Leitura direta indexada por `(loja_slug, os_id)` em `hydra_case_graph_projections` e `hydra_case_current_position`, com tempo de resposta inferior a 2ms.
2. **Risco:** Ausência de tabelas no banco de produção (`hydra_ops.db` da VPS).  
   **Mitigação:** Chamada compulsória e idempotente a `ensureCaseAnalysisTables` no boot do servidor MCP e na inicialização do repositório. Se as tabelas estiverem vazias, o leitor aciona o fallback gracioso para os dados do ERP sem estourar exceção.
3. **Risco:** Loop infinito de presença se o despachante falhar ou travar.  
   **Mitigação:** Teto de segurança rigoroso (`maxDurationMs: 60000`). O heartbeat para compulsoriamente após 60 segundos mesmo se o callback de encerramento não for chamado.
4. **Risco:** Ingestão de conversas sem vínculo formal com a OS.  
   **Mitigação:** Manter a trava de `coveredOsIds`: uma análise só alimenta a projeção de uma OS se o número ou placa constar expressamente nos metadados validados do atendimento.
