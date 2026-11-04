# Spec 061 — Proposta: Tempário Comercial Completo (Mão de Obra R$ 270/h + Associativa de Peças e Ferramentas + Pesquisa Web Real + Testes nas 10 Lojas)

**ID da Spec:** `061-hydra-tempario-bateria-testes-estresse-rede`  
**Data:** 03/11/2026  
**Status:** PROPOSTA / HARD STOP ATIVO  
**Dependências:** Spec 054 (`054-hydra-tempario-hibrido-automotivo`)  
**Autor:** Antigravity (Single-Agent Headless Lead)

---

## 1. Problema e Diagnóstico

A consulta de tempário nas oficinas da Rede Mecânica Popular não é apenas um cálculo acadêmico de tempo de oficina. O gestor, o consultor técnico e o sócio precisam de uma resposta comercial pronta para fechar o orçamento com o cliente:
1. **Quanto Cobrar na Mão de Obra (Taxa Fixa R$ 270,00/h):**
   A rede opera com a taxa horária padrão de **R$ 270,00 por hora de mão de obra**. O sistema não pode apenas dizer "demora 3,05h"; ele deve calcular explicitamente:
   - *Tempo de Mão de Obra:* `3,05h` (3h 03 min)
   - *Taxa da Rede:* `R$ 270,00/h`
   - *Valor a Cobrar da Mão de Obra:* `R$ 823,50` (com demonstrativo do valor bruto individual vs valor com desconto de sobreposição de acesso).
2. **Associativa de Peças Necessárias:**
   Ao trocar uma correia dentada, um radiador ou uma embreagem, quais peças são obrigatórias e quais são preventivas recomendadas? (Ex: ao trocar correia dentada do Onix, exige-se kit de correia, tensor, retentor, junta de distribuição, 4L de óleo Dexos 1 Gen 3 e filtro de óleo). O agente precisa listar a cesta associativa de peças para o consultor não esquecer de cotar os insumos.
3. **Associativa de Ferramentas Especiais:**
   Quais ferramentas a oficina precisa ter na bancada para executar o serviço com segurança e sem retrabalho? (Ex: ferramenta de fasagem de comando de válvulas, torquímetro calibrado com torque especificado em Nm, alicate de abraçadeira elástica, regloscópio).
4. **Pesquisa Técnica Real na Web para Veículos de Fora do Catálogo:**
   Quando o consultor perguntar de um carro que ainda não está no banco de dados local (ex: *Tracker 1.2 Turbo*, *Compass 2.0 Diesel*, *Polo 1.0 TSI*, etc.), o sistema não pode dar resposta vazia. Ele deve executar **pesquisa técnica ativa na Web em fontes automotivas reais** (manuais técnicos, portais de reparadores, TSBs), extrair o tempo médio, as ferramentas de fasagem e as peças associadas, calculando o orçamento comercial a R$ 270,00/h com evidência auditada.
5. **Validação Factual em Todas as 10 Lojas da Rede:**
   Comprovar que o motor responde corretamente para todas as 10 lojas físicas (`maua`, `jabaquara`, `jorge beretta`, `dom pedro`, `santo andre`, `saobernardo`, `sorocaba`, `campinas`, `osmar`, `diadema`) e isola gerentes sem jamais contaminar médias com `MPMaster`.

---

## 2. Solução Proposta

### 2.1. Motor Comercial de Precificação (Taxa R$ 270,00/h)
- Inclusão do parâmetro `hourlyRate = 270.00` em todo o cálculo de cadeia de execução.
- Geração automática nos balões Hermes:
  - *Valor de Mão de Obra Unitário:* `tempoIndividual * R$ 270,00`.
  - *Valor do Pacote com Acesso Compartilhado:* `tempoLiquidoTotal * R$ 270,00`.
  - *Economia Proporcionada ao Cliente:* `(tempoBruto - tempoLiquido) * R$ 270,00`.

### 2.2. Associativa de Peças e Insumos Obrigatórios
- Criação da tabela relacional e contratos `tempario_operation_parts`:
  - `nome_peca`: Descrição da peça/insumo.
  - `quantidade`: Quantidade recomendada.
  - `unidade`: `UN`, `L`, `JG`, `PAR`.
  - `obrigatoria`: Booleano (1 para peças indispensáveis, 0 para preventivas recomendadas).
  - `especificacao_tecnica`: Código OEM, viscosidade, norma (ex: `G13`, `DOT4`, `Dexos 1 Gen 3`).

### 2.3. Associativa Consolidada de Ferramentas e Torques
- Agregação deduplicada das ferramentas exigidas em cada etapa (`tempario_suboperations.ferramentas_json`) e consolidação de todos os torques críticos especificados (em Nm e graus).

### 2.4. Módulo de Pesquisa Técnica Real na Web (`tempario_web_researcher.ts`)
- Quando a busca híbrida local retornar `confidenceScore < 0.75` ou veículo não homologado:
  - Disparar busca na Web via mecanismo de busca técnica estruturada (`search_web`).
  - Buscar consultas direcionadas: `"[veiculo] [motor] tempo de troca [servico] manual reparacao horas ferramentas fasagem"`.
  - Extrair deterministicamente:
    1. Tempo médio de reparo reportado por montadoras ou manuais (Doutor-IE, Oficina Brasil, reparador).
    2. Ferramentas especiais de sincronismo/fasagem indicadas.
    3. Peças obrigatórias substituídas no procedimento.
  - Calcular mão de obra a **R$ 270,00/h**.
  - Gravar em `tempario_external_estimates_staging` com procedência `PESQUISA_TECNICA_WEB` e exibir no balão Hermes com indicação explícita da fonte web pesquisada.

### 2.5. Suíte de Testes Extensiva (`test_harness_tempario_stress.ts`)
- **10 Cenários Contratuais:**
  - **C01:** Golf 1.4 TSI Farol + Radiador (cálculo de mão de obra R$ 270/h + peças + ferramentas).
  - **C02:** Onix 1.0 Turbo Correia Banhada a Óleo + Bomba d'Água (cálculo a R$ 270/h + lista de 6 peças + ferramentas de fasagem Raven/Felar).
  - **C03:** Civic 2.0 Embreagem + Retentor do Volante (cálculo a R$ 270/h + kit embreagem, atuador, fluido DOT4).
  - **C04:** Corolla 2.0 Freios Dianteiros Completos (cálculo a R$ 270/h + pastilhas, discos, fluido).
  - **C05:** Renegade 1.3 Turbo Amortecedores + Coxins (cálculo a R$ 270/h + par amortecedores, kit coxim/batente).
  - **C06:** Matriz de 10 Lojas Físicas para Sócio (consolidação de 50 OSs com tempos e faturamento de mão de obra nas 10 unidades).
  - **C07:** Matriz 10x10 de Isolamento de Gerentes (100 permutações: sucesso na própria loja, bloqueio em todas as outras).
  - **C08:** Expurgo Rígido de MPMaster (zero contaminação nas métricas da rede).
  - **C09:** Pesquisa Real na Web para Veículo Desconhecido (disparo de busca web real para veículo novo, extração de tempo e precificação a R$ 270/h).
  - **C10:** Estresse Concorrente de 100 Requisições (estabilidade de heap e ausência de travamentos no SQLite).

---

## 3. Contratos de Dados Estritos (TypeScript)

```ts
export interface TemparioPartItem {
  readonly nomePeca: string;
  readonly codigoReferencia?: string;
  readonly quantidade: number;
  readonly unidade: string;
  readonly obrigatoria: boolean;
  readonly observacao?: string;
}

export interface DeduplicatedGraphChainResult {
  readonly steps: readonly TemparioSubOperationStep[];
  readonly pecasNecessarias: readonly TemparioPartItem[];
  readonly ferramentasNecessarias: readonly string[];
  readonly torquesEspecificados: readonly string[];
  readonly tempoLiquidoTotalHoras: number;
  readonly tempoLiquidoTotalMinutos: number;
  readonly tempoBrutoTotalHoras: number;
  readonly tempoEconomizadoDeduplicacaoHoras: number;
  readonly tempoEconomizadoDeduplicacaoMinutos: number;
  readonly possuiDeduplicacaoAtiva: boolean;
  readonly taxaHorariaPadrao: number; // R$ 270,00
  readonly valorMaoDeObraSugerido: number; // tempoLiquido * 270
  readonly valorMaoDeObraBrutoSemAssociativa: number; // tempoBruto * 270
  readonly economiaMaoDeObraReais: number; // economizado * 270
}
```

---

## 4. Risco Principal e Mitigações

| Risco Principal | Impacto | Mitigação Arquitetural |
| :--- | :---: | :--- |
| Instabilidade ou lentidão em buscas na Web. | Timeout no turno de resposta do WhatsApp. | Fallback com timeout defensivo de 8s; se a web demorar, retorna estimativa técnica preliminar em quarentena sem travar o bot. |
| Invenção de peças inexistentes em pesquisas web. | Orçamento incorreto passado ao cliente. | Regex de validação semântica com lista de vocabulário de peças automotivas homologadas do glossário. |
| Variação de taxas horárias entre lojas. | Cobrança inconsistente. | Taxa horária parametrizada e centralizada (`DEFAULT_HOURLY_RATE = 270.00`), permitindo override controlado por loja se configurado no banco. |

---

## 5. Critérios de Aceitação

1. Todo balão Hermes de tempário deve exibir expressamente o valor sugerido de mão de obra calculado com a taxa horária de **R$ 270,00/h**.
2. Cada serviço homologado deve listar a associativa de peças obrigatórias e preventivas.
3. Todas as ferramentas universais e especiais de cada procedimento devem ser agregadas sem duplicatas.
4. O módulo de pesquisa web deve realizar consultas reais para veículos não cadastrados, capturando tempo e calculando a mão de obra a R$ 270/h.
5. As 10 lojas físicas oficiais devem ser verificadas com dados de pátio e isolamento estrito de gerentes.
6. A bateria de 10 cenários (`test_harness_tempario_stress.ts`) deve ser executada com 100% de sucesso.
