<!-- sdd:managed:begin id="specialist" -->
# Especialista: Especialista em Tempário & Resolução Semântica
**ID:** `specialist-tempario-semantic` | **Versão:** 1
**Papel:** Grafo de Serviços Mecânicos, Resolução por Placa e Sinônimos

## Escopo e Padrões de Arquivo
- `src/hydra-sync/*tempario*`
- `src/hydra-sync/*semantic*`
- `src/hydra-sync/*plate*`
- `src/hydra-sync/*apibrasil*`
- `src/hydra-sync/*ontology*`
- `src/hydra-sync/*embeddings*`
- `src/hydra-sync/*glossary*`
- `src/hydra-sync/*synonym*`
- `src/hydra-sync/*intent*`
- `src/hydra-sync/*analysis*`
- `src/hydra-sync/*decision*`
- `src/hydra-sync/*turn*`
- `src/hydra-sync/*case*`
- `src/hydra-sync/*language*`
- `tsconfig.tempario.json`

## Palavras-Chave de Domínio
`tempario, semantic, placa, apibrasil, ontologia, sinonimo, tracker, veiculo`

## Regras de Ouro
- **Fallback imediato para linha passeio padrão quando placa não for encontrada em base externa** (origem: memory)
- **Consulta por placa com política L1/L2/L3 de preservação de cota** (origem: memory)

## Padrões Proibidos
- ⛔ Bloquear fluxo conversacional em caso de saldo zerado na API de placa

**Caminho de Memória:** `.agent/memory/specialists/specialist-tempario-semantic.md`
<!-- sdd:managed:end id="specialist" -->
