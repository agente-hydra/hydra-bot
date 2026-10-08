---
trigger: always_on
---

# Protocolo de Memória — Obrigatório em Toda Interação

## Regra Cardinal
A memória do agente está em `.agent/memory/<categoria>.md`. **O agente NÃO tem memória entre sessões.** Sem consultar esses arquivos, toda sessão começa do zero.

## Auto-Read (Início de Task)
No início de QUALQUER task que envolva código, o agente DEVE:
1. Verificar se `.agent/memory/` existe no projeto
2. Se existir, ler os arquivos relevantes para a task atual:
   - Task de UI → `.agent/memory/ui.md`
   - Task de banco/API → `.agent/memory/supabase.md`
   - Task de auth → `.agent/memory/auth.md`
   - Task de deploy → `.agent/memory/infra.md`
   - Task de negócio → `.agent/memory/domain.md`
3. Aplicar os aprendizados encontrados ANTES de propor qualquer solução

**Nunca carregue todos os arquivos de uma vez.** Máximo 3 por task.

## Memory-Aware Responses
Toda proposta de solução DEVE:
- Citar aprendizados relevantes da memória (se existirem)
- Respeitar anti-patterns documentados em sessões anteriores
- Reutilizar decisões arquiteturais já registradas

## Post-Task Write (Aprendizados)
Ao finalizar uma implementação significativa (via `/vibe-archive` ou quando o user pedir):
- Atualizar o arquivo de memória da categoria afetada
- Formato obrigatório:
  ```
  ## [YYYY-MM-DD] — [Feature/Bug: <descrição>]
  **Contexto:** O que foi implementado.
  **Regra aprendida:** O insight crítico.
  **Não fazer:** Anti-pattern identificado.
  ```

## Regra de Ouro
Uma boa entrada de memória pode ser lida por um agente futuro e aplicada diretamente — sem precisar de mais contexto.
