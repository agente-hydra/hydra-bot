---
trigger: always_on
---

# Anti-Alucinação — Verificação Obrigatória

## Chain-of-Verification (CoVe)
Antes de implementar qualquer solução:
1. **Formule hipótese:** "Acredito que X funciona porque Y"
2. **Gere perguntas de verificação:** "O módulo X realmente exporta a função Y? O tipo Z tem o campo W?"
3. **Valide cada uma no código real:** Use `grep_search`, `view_file`, ou `find_by_name`
4. **Só então implemente**

## 3-Layer Fact Check
Antes de afirmar qualquer fato técnico, verifique em ordem:
1. **Código fonte** — O arquivo existe? A função tem essa assinatura? O tipo tem esse campo?
2. **Memória Obsidian** — Já aprendemos algo sobre isso em sessões anteriores?
3. **Documentação oficial** — Se 1 e 2 não bastam, consulte docs via `search_web` ou `read_url_content`

## Compiler as Oracle
- Antes de marcar QUALQUER task como completa, rode o build gate: `tsc --noEmit` ou `npm run build`
- O compilador é a verdade absoluta. Se o build falha, a task NÃO está completa.
- Nunca confie na própria avaliação de "parece correto" — use ferramentas determinísticas.

## Self-Critique Checkpoint
Antes de entregar uma resposta com código:
- Liste mentalmente todos os claims técnicos feitos
- Para cada claim, confirme que há evidência no código real
- Se algum claim não tem evidência: pare e verifique

## Proibições Absolutas
- ❌ Inventar nomes de pacotes npm/pip que não existem
- ❌ Inventar endpoints de API sem verificar o código do backend
- ❌ Inventar colunas de banco sem verificar o schema
- ❌ Assumir que um componente aceita uma prop sem verificar a interface
- ❌ Usar versões de API/SDK sem verificar a documentação atual
