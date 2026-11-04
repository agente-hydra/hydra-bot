# Proposta de Arquitetura — Spec 065: Tempário Técnico por Placa, Expansão do Vocabulário de Suspensão e Roteamento Multiline

## 1. Sumário Executivo & Diagnóstico do Problema

### Contexto do Incidente Real
Em 04/11/2026 às 08:28, o sócio Davi enviou a seguinte mensagem no WhatsApp da Hydra:
```text
FCK2E73 

troca da bieleta dianteira direita
```

### O que o sistema respondeu:
```text
HYDRA | Tempário Técnico e Estimativa Operacional | Rede Mecânica Popular
> Visão geral
Levantamento operacional para substituição da bieleta da barra estabilizadora dianteira direita no veículo de placa FCK2E73. A consulta realizada na base operacional das 10 unidades da rede confirma que o veículo não possui Ordem de Serviço cadastrada ou aberta no ERP. Para veículos de passeio com suspensão dianteira independente (padrão McPherson), o procedimento de troca de bieleta unitária possui baixa complexidade e rápida liberação de elevador.
- Placa consultada: FCK2E73
- Operação solicitada: Substituição da bieleta dianteira direita
- Status no sistema: Sem Ordem de Serviço cadastrada no ERP
- Complexidade técnica: Baixa
...
```

### O que o usuário esperava:
O card executivo padronizado do Tempário Técnico (Spec 062/063):
```text
*HYDRA | Tempário Técnico & Mão de Obra*

> *Chevrolet Tracker (2020-2024)*
- *Serviços:* Substituição da Bieleta Dianteira Direita

*Resumo de Mão de Obra (Taxa da Rede: R$ 270,00/h)*
- *Tempo líquido cobrado:* 0,80h (48 min)
- *Total Mão de Obra a Cobrar:* R$ 216,00
- *Complexidade técnica:* Baixa (1 etapas no grafo de acesso)

*Deseja ver o detalhamento técnico?*
1️⃣ Peças necessárias (1 item)
2️⃣ Ferramentas de bancada e torques (2 itens)
3️⃣ Passo a passo da montagem (sequência otimizada)
4️⃣ Tudo completo (relatório técnico integral)
```

---

## 2. Diagnóstico Técnico de Causa-Raiz (Evidence-Based)

Através da auditoria nos logs reais do SQLite operacional da VPS (`hydra_ops.db` linha 1434) e testes diretos de AST e semântica no código, identificamos 4 gargalos exatos:

1. **Gargalo 1: Glossário Mecânico Incompleto em `isTemparioTechnicalQuery`**
   - No arquivo `src/hydra-sync/intent_rewriter.ts` (linha 1218), `mechanicalComponentPattern` possuía apenas:
     `/(farol|radiador|correia|embreagem|amortecedor|pastilha|disco|vela|bomba|alternador|motor|cabecote|suspensao|freio|oleo|filtro|escapamento|parachoque|para-choque|bico|injecao|turbina|cambio|valvula|pneu)/`
   - Termos vitais de suspensão e mecânica pesada estavam **ausentes**: `bieleta`, `estabilizadora`, `pivo`, `terminal`, `bandeja`, `homocinetica`, `semieixo`, `coxim`, `batente`, `rolamento`, `bobina`, `termostato`, `cambagem`, `alinhamento`.
   - Resultado: A expressão `isTemparioTechnicalQuery("FCK2E73 \n\ntroca da bieleta dianteira direita")` retornou `false`.

2. **Gargalo 2: Omissão de `bieleta` em `recognizedComponents` de `extractAdaptiveTemparioQuery`**
   - Na linha 1384 de `intent_rewriter.ts`, `recognizedComponents` não possuía `bieleta`.
   - A condição de escape `componentes.length > 0 && (Boolean(veiculo) || Boolean(placa))` falhou porque `componentes` resultou em array vazio `[]`.

3. **Gargalo 3: Desvio Indevido para `service_search` de OS do ERP**
   - Com `isTemparioQuery == false`, o classificador de intenção encontrou uma placa (`FCK2E73`) e a palavra `troca`, classificando erroneamente a mensagem como `intent: 'service_search'` (busca de itens já realizados em Ordens de Serviço antigas no ERP).
   - O dispatcher buscou na tabela `ordens_servico` por itens contendo "bieleta". Como a OS #22664 do veículo `FCK2E73` (aberta no Rei do Óleo Mauá) continha freio, sangria e geometria, mas não bieleta, o sistema não encontrou nenhum serviço executado.
   - Ao não encontrar itens na OS, o dispatcher caiu no fallback do LLM completo (`AGY_PRIMARY`), que alucinou afirmando que "o veículo não possui Ordem de Serviço cadastrada no ERP" e cuspiu uma resposta não-tabelada em texto corrido.

4. **Gargalo 4: Resolução de Mensagens Multiline `[PLACA]\n\n[SERVIÇO MECÂNICO]`**
   - Padrão comum no WhatsApp de oficinas: o operador cola a placa na primeira linha e digita o serviço na linha seguinte.
   - O sistema deve priorizar deterministicamente: se a mensagem contém `[PLACA VÁLIDA] + [AÇÃO MECÂNICA OU COMPONENTE AUTOMOTIVO]`, a intenção primária é **TEMPÁRIO TÉCNICO DE ORÇAMENTO (TEMPARIO_TEMPO_SERVICO)**, e não histórico de OS.

---

## 3. Solução Proposta

1. **Expansão Abrangente do Vocabulário de Peças e Componentes Automotivos:**
   - Adicionar em `mechanicalComponentPattern`, `recognizedComponents` e `tempario_graph_repository.ts`:
     - **Suspensão & Direção:** bieleta, barra estabilizadora, pivô, terminal de direção, braço axial, bandeja / balança, coxim de amortecedor, batente, bucha de suspensão, caixa de direção.
     - **Transmissão & Tração:** junta homocinética, coifa da homocinética, semieixo, cubo de roda, rolamento de roda.
     - **Motor & Injeção:** bobina de ignição, cabo de vela, válvula termostática, carcaça da válvula termostática, reservatório de expansão, ventoinha / eletroventilador, tensor da correia, junta da tampa de válvulas, junta do cárter, retentor do virabrequim, retentor do comando.
     - **Serviços de Geometria & Fluidos:** alinhamento dianteiro/traseiro, balanceamento de rodas, sangria de freio, fluido de freio DOT4/DOT5.1, troca de óleo de câmbio (manual/automático).

2. **Regra de Precedência Rígida para Placa + Serviço Mecânico:**
   - Se a mensagem contiver uma placa válida (Mercosul ou antiga) E (uma ação mecânica como `troca`, `substituir`, `reparo`, `instalar`, `trocar` OU um componente mecânico reconhecido), a intenção deve ser compulsoriamente fixada como `TEMPARIO_TEMPO_SERVICO`.
   - Apenas se a consulta contiver palavras explícitas de histórico (ex: `"o que foi feito"`, `"itens da os"`, `"historico"`, `"ja trocou"`, `"quando trocou"`) ela é roteada para `service_search`.

3. **Resolução Dinâmica do Veículo no Tempário Híbrido:**
   - A função `resolveVehicleFromPlateOrOs` busca primeiro no cache L1 (`placa_lookup_cache`), depois em L2 (`ordens_servico`).
   - Para o veículo `FCK2E73`, a OS #22664 do ERP tem `veiculo: 'TRACKER'`. O resolvedor deve mapear `TRACKER` para a família Chevrolet Tracker e ano contemporâneo (2020-2024), aplicando o Fast-Path tabelado a **R$ 270,00/h**.

4. **Apresentação Visual Hermes V2 com Progressive Disclosure:**
   - Retornar imediatamente o Card Executivo tabelado com:
     - Veículo: *Chevrolet Tracker*
     - Serviço: *Substituição da Bieleta Dianteira Direita*
     - Tempo líquido tabelado: *0,80h (48 min)*
     - Total Mão de Obra: *R$ 216,00* (calculado estritamente na taxa de R$ 270,00/h)
     - Menu interativo 1️⃣ Peças, 2️⃣ Ferramentas, 3️⃣ Passo a passo, 4️⃣ Relatório completo.

---

## 4. Contrato de Dados & Interfaces

### Schema do Classificador de Tempário
```typescript
export interface TemparioPatternDetection {
  readonly isTempario: boolean;
  readonly reason: 'EXPLICIT_KEYWORDS' | 'TIME_QUERY' | 'LABOR_QUERY' | 'PLATE_PLUS_SERVICE' | 'ACTION_PLUS_COMPONENT';
  readonly placa?: string;
  readonly veiculo?: string;
  readonly componentes: readonly string[];
  readonly acaoMecanica?: string;
}
```

---

## 5. Análise de Riscos & Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Colisão com consultas de histórico de OS daquela placa | Médio | Se a mensagem contiver termos explícitos como `"o que foi feito"`, `"itens"`, `"histórico"`, priorizar `service_search`. Caso contenha `"troca"`, `"valor"`, `"tempo"`, `"mão de obra"`, priorizar `TEMPARIO_TEMPO_SERVICO`. |
| APIBrasil 404 por falta de plano ativo na conta | Baixo | L1 (Cache SQLite) e L2 (Ordens de Serviço locais) resolvem instantaneamente veículos que já passaram pela rede (como o Tracker FCK2E73). Se L3 falhar, orientar o usuário a citar o modelo. |
| Taxa horária divergente de R$ 270,00/h | Crítico | Trava estrita no coordenador: qualquer cálculo de mão de obra de tempário é multiplicado por R$ 270,00/h. |
| Invasão de remetente WhatsApp não autorizado | Crítico | Respeito absoluto às regras da Hydra: apenas `hydra` e `atendimento` podem emitir mensagens. |
