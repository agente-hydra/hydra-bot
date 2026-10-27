# Spec 034 — CMV KPI Alert: Aviso Individual por Gerente (Quarta e Sexta)

**Criado:** 2026-10-27  
**ID:** `034-cmv-kpi-alerta-gerentes-quarta-sexta`  
**Status:** PROPOSAL

---

## Problema

O CMV já é exibido nos balões do grupo executivo (`120363425738307789@g.us`), mas **nenhum gerente de loja recebe feedback individual** sobre sua performance de CMV.

Sem esse feedback pessoal direto:
- O gerente não sabe onde está em relação às faixas de KPI
- Não há urgência gerada no responsável — só a diretoria vê o número
- Os dados de Carros em Pátio e checklist do mecânico ficam só no Excel da diretoria

Além disso, a coluna `instance_evolution` em `hydra_store_managers` registra a instância do gerente (ex: `"Jabaquara"`, `"Kennedy"`) como se fossem remetentes permitidos — **mas pelo AGENTS.md e regras de segurança, essas instâncias de gerentes são TERMINANTEMENTE PROIBIDAS como remetentes**. O envio será exclusivamente via instância `hydra`.

---

## Solução Proposta

Criar um novo orquestrador `run_cmv_kpi_gerentes.js` que executa **toda quarta e sexta à tarde** (14:30 BRT, após o balão 2 das 14:00), que envia para cada gerente de loja **individualmente** (via instância `hydra`, destinatário = `phone_canonical` do gerente) uma mensagem personalizada contendo:

1. **CMV KPI da loja** — percentual do mês atual com badge de faixa:
   - ✅ `BOM` → até 21,99%
   - 🟢 `DENTRO DO OBJETIVO` → 22,00% a 24,99%
   - 🟡 `ALERTA` → 25,00% a 26,99%
   - 🔴 `FORA DO OBJETIVO` → 27,00% a 29,99%
   - 🚨 `CRÍTICO` → 30,00%+

2. **Carros em Pátio — com e sem checklist do mecânico:**
   - Total de carros no pátio da loja
   - Quantos têm checklist (via campo `checklists` do `os_store_<slug>.json`)
   - Quantos estão SEM checklist
   - % de cobertura de checklist

---

## Dados de Entrada Confirmados (evidência real)

### CMV por Loja
- **Fonte:** `hydra_ops.db` → tabela `cmv_lojas` (campos: `loja_slug`, `cmv_percentual`, `faturamento_total`, `data_fim`)
- **Função existente:** `carregarDadosCmvEMetas()` em `whatsapp_patio_dispatcher.js` — já retorna `{ lojas: [{ slug, nome, cmvPercentual, ... }] }`

### Carros em Pátio + Checklist
- **Fonte:** `/home/operacional/hydra-data/crawls/os_store_<slug>.json`
- **Estrutura confirmada:**
  ```json
  {
    "slug_loja": "MPJabaquara",
    "os_map": {
      "246": {
        "is_aberta": true,
        "checklists": [{
          "codigo": "246",
          "tipo": "Check-List de Inspeção",
          "realizado_por": "Vanessa...",
          "status": "Finalizado",
          "progresso": "95,83 %"
        }]
      }
    }
  }
  ```
- `is_aberta = true` → carro no pátio
- `checklists.length > 0` → tem checklist do mecânico

### Destinatários (Gerentes)
- **Fonte:** `hydra_ops.db` → tabela `hydra_store_managers`
- **Schema:** `loja_slug | loja_nome | gerente_nome | phone_canonical | instance_evolution | is_active`
- **Exemplo de dados reais:**
  - `MPJabaquara` → `5511933733131`
  - `MPkennedy` → `5511984926600`
  - `MPdompedro1` → `5511963717410`
  - `MPrudge` → `5511947439443`
  - `MPJorgeBeretta` → `5511998874158`

> [!CAUTION]
> A coluna `instance_evolution` NÃO será usada como remetente. **O envio é EXCLUSIVAMENTE via instância `hydra`.** Os gerentes são apenas os destinatários (números no campo `phone_canonical`).

---

## Risco Principal

1. **Telefones desatualizados** em `hydra_store_managers` → mensagem vai para número errado. Mitigação: log de entrega + alerta ao Dev se retornar erro 400/404.
2. **CMV null** para loja sem dados (nova loja, primeiro ciclo) → mensagem não enviada para essa loja, apenas log de aviso.
3. **os_store_<slug>.json desatualizado** (mtime > 12h) → exibir "dados do pátio desatualizados" em vez de número possivelmente errado.
4. **Envio em dia feriado** → verificar `verificarFeriado()` existente em `feriados_calendario.js`.
