<USER_REQUEST>
# Proposta: melhorar metas e relatórios financeiros no WhatsApp

## Objetivo

Corrigir a apresentação das respostas financeiras do Hydra e completar os dados que as sustentam. Hoje o bot tenta enviar uma tabela com cabeçalho e colunas; no WhatsApp ela quebra linhas e perde alinhamento. No exemplo de 29/09/2026, a pergunta “falta mt pra bater a meta?” recebeu faturamento de 10 lojas e “Meta: não disponível” em cada uma. O bot precisa capturar a meta da tela Mapa de Metas, relacioná-la ao faturamento do mesmo período e responder diretamente quanto falta.

## Escopo

Esta proposta cobre a captura, persistência, consulta e apresentação de: faturamento, metas do Mapa de Metas, CMV por loja, Faturamento por Área e tabela de Pesquisa de Mídia do Relatório de Operação. O acesso ao relatório foi indicado como `https://sistemaoficinainteligente.com.br/wfRelatorioOperacao.aspx`, pelo botão `#ctl00_cph_btnGestaoPeriodica`, selecionando cada loja. A página exige conferência na sessão autenticada; seus campos e valores não foram inspecionados nesta conversa. Não alterar regras de cálculo sem confirmar a definição dos campos na fonte.

## Dados a captar e salvar

1. **Mapa de Metas:** localizar a tabela que exibe a meta, identificar loja, período, unidade monetária, valor da meta e data de atualização. Capturar a meta de cada loja e a meta da rede somente se esta existir como dado próprio ou se a soma das metas das lojas elegíveis for uma regra de negócio confirmada. Verificar se a meta é mensal, diária, acumulada ou de outro tipo antes de compará-la ao faturamento.
2. **Relatório de Operação:** abrir a tela autenticada, selecionar uma loja por vez, acionar `#ctl00_cph_btnGestaoPeriodica` e capturar as tabelas de CMV, Faturamento por Área e Pesquisa de Mídia, com o período e os rótulos originais. Inventariar os campos reais antes de modelar o banco. Não presumir o significado de CMV, das áreas ou das colunas de mídia apenas pelo nome.
3. **Persistência:** salvar cada extração por fonte, loja, período e data de captura, com chave única para atualização idempotente. Manter o valor original e a unidade de cada métrica; registrar ausência e erro de captura separadamente. Uma atualização parcial de lojas não deve sobrescrever um conjunto completo anterior como se fosse completo.
4. **Cobertura:** comparar o catálogo de lojas com as lojas encontradas em cada fonte. No exemplo recebido, o bot informou 10 lojas; investigar se a 11ª não tinha dados, não foi selecionada ou ficou fora da extração. Exibir “10 de 11 lojas com dados”, se for esse o caso, em vez de chamar o conjunto incompleto de total da rede sem ressalva.

## Responder à pergunta feita, antes de listar números

Para “falta muito para bater a meta?”, buscar primeiro o contexto de loja e período. Se o usuário não restringir a loja, responder pela rede quando a meta da rede for válida e indicar as lojas que ainda não bateram a meta. Se a comparação da rede não for válida, explicar o motivo e apresentar as metas por loja disponíveis.

- `falta = max(meta - faturamento comparável, 0)`.
- `atingimento = faturamento comparável / meta × 100`, somente com meta positiva e bases compatíveis.
- Se a meta já foi atingida, dizer isso; não mostrar falta negativa.
- Comparar valores da mesma loja, mesma métrica e mesmo período de referência. Não tratar faturamento acumulado até hoje como faturamento do mês inteiro.
- Não estimar ritmo ou projeção de fechamento sem pedido explícito e regra definida.
- Quando a meta estiver ausente ou desatualizada, dizer qual dado falta e quando foi a última captura válida. Não responder “Meta: não disponível” para todas as lojas sem antes verificar a tabela do Mapa de Metas.

Exemplo de estrutura, sem valores inventados:

```text
> *Meta da rede — setembro/2026*
- *Faturamento até 29/09:* [valor]
- *Meta do mês:* [valor]
- *Falta para bater:* [valor] ([percentual] da meta)
- *Lojas na comparação:* [quantidade com faturamento e meta válidos]

> *Lojas que ainda não bateram a meta*
- *Dom Pedro:* faltam [valor]; atingimento [percentual]
- *Jabaquara:* faltam [valor]; atingimento [percentual]

_Atualizado em [data/hora]._ 
```

Para perguntas de CMV, Faturamento por Área ou Pesquisa de Mídia, responder com o recorte pedido e uma conclusão curta apoiada nos dados. Mostrar a tabela completa apenas se o usuário pedir “completo”; ainda assim, usar blocos legíveis, nunca colunas alinhadas por espaços.

## Formato esperado

1. Nunca enviar tabela em Markdown, texto alinhado por espaços, cabeçalho com colunas ou bloco de código em respostas de faturamento.
2. Abrir com um título curto e o período exato consultado. Se o período não estiver definido, mostrar claramente o período que a fonte usa; não inventar “hoje” ou “mês” como rótulo.
3. Mostrar o total da rede somente quando a consulta abranger a rede e esse total estiver disponível. Não somar valores de períodos ou métricas diferentes.
4. Para “faturamento das lojas”, apresentar **todas as lojas encontradas**, com nome e valor em cada bloco. Não transformar o pedido em top 3. Se houver paginação, informar o total de lojas e como obter a continuação.
5. Usar uma linha por métrica, com rótulo explícito. Se houver meta, percentual, saldo ou comparação, deixar claro o que cada número representa e evitar misturar “faturamento”, “recebido” e “a receber”.
6. Indicar data ou hora de atualização quando a fonte fornecer esse dado. Se houver aviso de defasagem, exibi-lo de forma curta e visível.
7. Dado ausente deve aparecer como “não disponível” ou ser omitido com explicação. Não convertê-lo para R$ 0,00.
8. Preservar a ordenação pedida pelo usuário. Se ele não pedir ordenação, usar uma ordem estável e previsível, por exemplo o catálogo de lojas, sem sugerir ranking.

### Modelo de resposta

Os valores abaixo são apenas marcadores de formato; devem ser substituídos pelos dados consultados.

```text
> *Faturamento das lojas*
*Período:* [início] a [fim]
*Total da rede:* [valor, se aplicável]

> *Santo André*
- *Faturamento:* [valor]
- *Meta:* [valor, se disponível]
- *Atingimento:* [percentual, se calculado com dados válidos]

> *Jabaquara*
- *Faturamento:* [valor]
- *Meta:* [valor, se disponível]
- *Atingimento:* [percentual, se calculado com dados válidos]

[Demais lojas, sem truncamento silencioso]

_Dados atualizados em [data/hora, se disponível]._ 
```

Para uma loja só, mostrar apenas o bloco dela, sem repetir um consolidado da rede que o usuário não pediu. Para comparação entre lojas, usar blocos por loja e uma conclusão curta baseada nos mesmos campos e período.

## Divisão em balões

- Se a resposta ultrapassar o limite confortável de leitura, dividir entre blocos de lojas. Não cortar nome, valor, marcador `*` ou uma métrica no meio.
- O primeiro balão contém título, período, total e a indicação do número de lojas. Os seguintes contêm grupos de lojas, mantendo o contexto do período quando necessário.
- Todos os balões da resposta devem permanecer associados ao mesmo turno e sair na ordem correta.
- Não substituir a lista completa por um resumo sem informar que houve limitação ou oferecer continuação.

## Regras de estilo do WhatsApp

- Títulos de bloco: `> *Título*`.
- Negrito: `*texto*`; itálico: `_texto_`.
- Listas: `- `.
- Sem `#` de título Markdown, tabelas com `|`, cercas de código, separadores `---` ou emojis decorativos em cada linha.
- Formatar moeda em pt-BR e manter casas decimais consistentes. Não usar espaços para alinhar colunas.

## Implementação sugerida ao agente

### Etapa 1 — conferir fontes e corrigir captura

1. Capturar uma resposta real de faturamento que hoje sai em tabela, removendo dados pessoais antes de colocá-la no relatório.
2. Inspecionar, em modo de leitura, o Mapa de Metas e o Relatório de Operação. Registrar seletores, cabeçalhos, exemplos de valor, período e comportamento da seleção de loja. Verificar se o clique em Gestão Periódica carrega todas as tabelas no mesmo estado de filtro.
3. Confrontar os valores capturados com os números visíveis na tela para ao menos duas lojas, além de um caso sem dados. Conferir a cobertura das 11 lojas do catálogo.
4. Implementar extração com logs por loja/fonte/período, detecção de alteração de layout e falha explícita quando uma tabela esperada não aparecer. Não gravar zeros para esconder falhas.

### Etapa 2 — persistir e consultar corretamente

1. Criar migrações e rotinas idempotentes para as metas e os três conjuntos do relatório. Preservar a data de referência da fonte e a data de captura.
2. Acrescentar consultas estruturadas para meta, diferença para meta, atingimento, CMV, Faturamento por Área e Pesquisa de Mídia, com filtro obrigatório de loja e período quando a fonte assim exigir.
3. Verificar se os totais do relatório representam valores brutos, líquidos ou outra base antes de cruzá-los. Definir o significado de CMV a partir da tela e da regra de negócio usada pela rede.
4. Impedir comparações entre períodos ou métricas incompatíveis. Devolver estado estruturado para sucesso, vazio, dado antigo e falha de captura.

### Etapa 3 — responder no WhatsApp e conferir execução

1. Localizar a etapa que transforma o resultado financeiro estruturado em `replyText` e a divisão em balões. Usar um renderizador determinístico para meta e faturamento, sem pedir à LLM que monte tabela.
2. Para “falta muito para bater a meta?”, priorizar a diferença e o atingimento. Deixar a lista detalhada de lojas como complemento, conforme o escopo da pergunta.
3. Passar o resultado pelo formatador de balões e conferir o payload final com transporte simulado, inclusive em resposta longa.
4. Verificar, em modo de leitura, qual arquivo e comando o PM2 está executando, horário de início do processo, versão do webhook carregada, horário e hash dos arquivos em disco e logs da resposta observada às 14:33 de 29/09/2026. A resposta nova pode vir de código já carregado ou de módulos TypeScript carregados por mensagem; não inferir apenas pelo contador de reinícios.
5. Preparar instruções de aplicação e rollback que indiquem exatamente quais arquivos e processos mudariam. **Não copiar código para `/opt/bots`, alterar o webhook ativo nem recarregar PM2 sem aprovação do Davi.**

## Critérios de aceite

- “Faturamento das lojas” retorna todas as lojas elegíveis, com nome e valor legíveis, sem tabela nem top 3 implícito.
- “Faturamento de Santo André” mostra só Santo André, com período e rótulo correto da métrica.
- A meta exibida para cada loja corresponde à linha da mesma loja e período no Mapa de Metas; uma comparação manual com a tela confere os valores.
- “Falta muito para bater a meta?” responde primeiro quanto falta, qual meta foi usada e qual o atingimento, sem despejar uma tabela de faturamento.
- CMV, Faturamento por Área e Pesquisa de Mídia podem ser consultados por loja e período, com rótulos fiéis à tela e sem misturar resultados de lojas diferentes.
- Metas e faturamento aparecem como métricas distintas; percentual só aparece quando calculável.
- A cobertura de lojas é explícita; o total da rede não é apresentado como completo se alguma loja esperada ficou sem captura.
- Valores ausentes, consulta vazia e fonte desatualizada têm mensagens próprias e não viram zero.
- Uma resposta longa é dividida em balões em limites de bloco, sem quebrar marcação ou misturar turnos.
- Testes verificam o texto **após** a divisão em balões e um exemplo renderizado como o usuário o veria no WhatsApp.

## Entrega e limite

O agente deve entregar: inventário das tabelas e campos reais, mapeamento loja/período, arquivos e migrações, comparação de valores com a tela, exemplo de antes e depois com valores fictícios, comandos e resultados dos testes, amostra do payload final, diagnóstico do PM2, limitações e declaração explícita sobre o estado de produção. Preparar a alteração em staging. Qualquer cópia para os arquivos executados pelo bot ou reinício de serviço exige aprovação do Davi.
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-09-29T14:43:06-03:00.
</ADDITIONAL_METADATA>