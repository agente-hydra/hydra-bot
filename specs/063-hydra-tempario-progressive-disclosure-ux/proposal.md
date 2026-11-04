# Proposta Refinada — Spec 063: Tempário Híbrido Aberto, Auto-Persistência na Web por Ano/Geração, Placa e Progressive Disclosure

## 1. Contexto e Diagnóstico

### Visão e Diretriz do Usuário
> *"mas ai fodeu se vc for ficar fechando por busca semantica, tem que ser hybrido e nao engessado, se eu falar um novo modelo de carro fodeu a ia quebra na hora ent no hybrido, ao buscar um novo modelo de carro seja ele 2000 ou 2010 tem que especificar tbm pq ai muda, por isso comentei a placa, ele salva, e se nao tiver no banco ao buscar ele busca na internet, assim como e hybrida a busca do tempario, sacou? e comandos tbm mano mesma coisa..."*

---

### Diagnóstico Técnico das Fragilidades Anteriores
1. **Reconhecimento Estático e Engessado:**
   - O uso de uma regex fechada com 20-30 carros em `intent_rewriter.ts` quebrava se o operador citasse um modelo novo (`Tiggo`, `Haval`, `Dolphin`, `Corsa`, `Tracker 2023`, `Opala`, `2008`, etc.).
   - Em oficina real, a variedade de modelos é aberta. A extração de intenção deve ser **sintática e adaptativa**: identificar ação de oficina (`troca`, `substituir`, `manutenção`, `revisão`, `quanto tempo`, etc.) + componente mecânico (`farol`, `radiador`, `correia`, etc.) e extrair o modelo/ano livremente.

2. **Diferenciação Estrita por Ano e Geração do Veículo:**
   - Um Corsa 2000 (Geração B / Wind / Classic) possui frentes, fixações, faróis e tempos completamente diferentes de um Corsa 2010 (Geração C / Maxx / Premium).
   - O Golf 2000 (MK4) difere do Golf 2010 (MK4.5) e do Golf 2015 (MK7 TSI).
   - A busca híbrida deve segmentar rigorosamente por ano/geração, impedindo que o operador receba dados de montagem de um carro antigo para um modelo recente ou vice-versa.

3. **Falta de Auto-Persistência (Search -> Ingest -> Save -> Serve):**
   - Anteriormente, quando um carro não estava no catálogo pré-semeado, o fluxo ou caía em quarentena estéril ou vazava para a CLI lenta de 72 segundos.
   - O tempário deve ser **auto-alimentável**: se o modelo/ano não está no banco, pesquisa na Web (manuais, Doutor-IE, fóruns de reparadores), extrai tempo tabelado, passos, peças e ferramentas, e **salva no banco SQLite permanente** (`tempario_vehicles`, `tempario_engines`, `tempario_operations`, `tempario_fts`). As consultas seguintes respondem em < 10ms.

4. **Resolução de Placas Não Cadastradas:**
   - Se o operador fornece uma placa (`FOE6I25`):
     - Primeiro busca no ERP local (`ordens_servico`).
     - Se não existir no ERP, decodifica a placa, obtém modelo/ano/motor, salva a correlação no cache local e segue a cotação de tempário com auto-persistência.

5. **Apresentação e Comandos Interativos (Progressive Disclosure):**
   - Eliminação da enxurrada de 5 balões amontoados.
   - Entrega inicial executiva (Resumo limpo com Horas Líquidas, Total a R$ 270,00/h e Economia de Acesso).
   - Menu numerado e natural:
     - `1` ou `peças` -> Card detalhado de peças (obrigatórias vs preventivas).
     - `2` ou `ferramentas` -> Bancada de ferramentas e torques críticos.
     - `3` ou `passo a passo` -> Sequência de montagem/desmontagem.
     - `4` ou `tudo` -> Relatório técnico integral.

---

## 2. Nova Arquitetura do Tempário Híbrido Aberto

```
[Operador no WhatsApp]
  │  Exemplos abertos:
  │  - "troca farol dianteiro corsa 2010"
  │  - "Golf 1.4 TSI 2015 quanto tempo e valor de mao de obra pra trocar farol e radiador?"
  │  - "FOE6I25 quanto tempo pra trocar radiador"
  │  - "trocar correia dentada tiggo 7 pro 2023"
  ▼
[Reconhecedor Sintático Aberto & Extrator Adaptativo]
  ├─ Ação Mecânica + Componente Mecânico identificados (Intenção TEMPARIO_TEMPO_SERVICO)
  ├─ Ano isolado (ex: 2010, 2015, 2023)
  ├─ Placa isolada (se houver, resolve no ERP ou decodificador e persiste)
  └─ Veículo e Motor extraídos de forma aberta (sem regex fechada)
  ▼
[Coordenador Híbrido com Auto-Persistência]
  ├─ 1. Cache L1 e Banco Local (tempario_vehicles / tempario_operations)
  │    └─ Achou com ano/geração compatível? ──► [RETORNA EM 15ms]
  │
  └─ 2. NÃO ACHOU NO BANCO? (Ex: Corsa 2010, Tiggo 7 2023, etc.)
       ├─ Dispara Pesquisa Técnica Web (Doutor-IE, Reparador, Manuais OEM)
       ├─ Extrai: tempo padrão, etapas de desmontagem, peças, ferramentas e torques
       ├─ AUTO-PERSISTÊNCIA NO BANCO:
       │    ├─ Salva Veículo em tempario_vehicles (com faixa de anos e geração)
       │    ├─ Salva Motor em tempario_engines
       │    ├─ Salva Operações em tempario_operations e sub-operações
       │    ├─ Salva Peças em tempario_operation_parts
       │    └─ Atualiza índice tempario_fts
       └─ Serve a resposta (< 2 a 4s no primeiro aprendizado, < 10ms nos seguintes)
  ▼
[Balloon Composer Executivo]
  ├─ Balão 1: Resumo Executivo + Valores (R$ 270/h) + Menu Interativo (1 a 4)
  └─ Salva TemparioPendingContext no turn_context do telefone
  ▼
[Turno 2 — Comandos e Linguagem Natural]
  └─ "1", "2", "3", "4", "peças", "ferramentas", "passo a passo"
       └─ Dispatcher intercepta em < 5ms e entrega o detalhe específico solicitado!
```

---

## 3. Garantias Contratuais e Regras de Segurança

1. **Taxa Horária Intocável:** R$ 270,00/h em todas as cotações, estimativas e cálculos da rede.
2. **Anti-Alucinação & Rastreabilidade:**
   - Todo veículo/serviço aprendido via Web recebe flag `PESQUISA_TECNICA_WEB` e link das fontes consultadas no bloco de proveniência.
3. **Persistência Incremental Idempotente:**
   - Inserções com `INSERT OR IGNORE` e verificação de chave única de veículo (`marca_modelo_ano_inicio_ano_fim`) para nunca duplicar registros no SQLite.
4. **Segurança WhatsApp:** Remetentes exclusivos `hydra` e `atendimento`; zero uso de aparelhos de gerentes.
