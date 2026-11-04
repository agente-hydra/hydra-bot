# Spec 058 — Hydra como assistente operacional de admin e sócios

Data: 02/11/2026. Status: especificação; implementação e implantação pendentes.

## Documentos

- [Arquitetura e contratos](design.md)
- [Fases e plano de implementação](spec-plan.md)
- [Testes, validação e liberação](validation.md)
- [Pesquisa e evidências](research.md)

## 1. Objetivo

Transformar o Hydra na interface principal de operação da rede: entender solicitações por texto, áudio, imagem e vídeo; pesquisar fontes autorizadas; produzir relatórios verificáveis; e, para administradores, executar operações explicitamente solicitadas, como enviar uma mensagem, ativar um sócio ou conceder um perfil administrativo delegado.

A experiência desejada é a de um assistente persistente semelhante ao Hermes: entende o pedido, utiliza ferramentas, acompanha trabalhos demorados e retorna resultados comprovados. A liberdade vem de ferramentas operacionais abrangentes e seguras, com autorização aplicada por software fora do modelo.

## 2. Requisitos confirmados pelo usuário

| ID | Requisito obrigatório |
|---|---|
| R01 | Somente admin e sócios podem conversar com a IA. Gerentes, operadores e desconhecidos não recebem acesso por esta iniciativa. |
| R02 | Texto, áudio, imagem e vídeo estão disponíveis para admin e sócios, dentro do escopo de cada perfil. |
| R03 | Reaproveitar o transcritor que já funciona na análise de conversas. Não substituir o motor sem evidência de necessidade. |
| R04 | Davi/admin pode solicitar envio de mensagem a um destinatário explicitado. |
| R05 | Davi/admin pode ativar, revogar e alterar permissões de usuários por conversa, mediante política de autoridade. |
| R06 | Sócios podem consultar dados autorizados da rede e pedir relatórios; não recebem gestão de acessos ou controle administrativo. |
| R07 | Hydra coordena os serviços e agentes existentes por interfaces limitadas e auditadas. |
| R08 | A IA não pode editar código, instalar dependências, modificar sua política de segurança ou se conceder privilégios. |
| R09 | A transcrição não deve adicionar cobrança de API por áudio. Custos de infraestrutura e inferência geral são contabilizados separadamente. |
| R10 | Planejamento fundamentado no ambiente real, documentação Hermes/OpenClaw e leitura crítica de experiências do Reddit. |

Receber alertas do bot não equivale a ter acesso à IA. Ser gerente de loja ou estar na agenda de destinatários não concede autorização conversacional. O admin pode conceder explicitamente um novo papel a uma pessoa, mas isso é uma operação separada e auditável.

## 3. Decisões propostas

1. Evoluir o Hydra existente com um coordenador e um serviço de ferramentas autorizadas. Não migrar toda a produção para Hermes/OpenClaw nesta entrega.
2. Davi será o proprietário administrativo (`owner`); outros admins terão capacidades delegadas. Confirmar o identificador canônico do proprietário na instalação, sem confiar em nome de exibição ou fala.
3. Operações comuns claramente solicitadas podem executar sem confirmação repetida. Mudanças de privilégio, ações de impacto e destinatários ambíguos recebem confirmação específica ou autenticação adicional conforme a matriz do design.
4. Áudio usa o pipeline atual. OCR e processamento de vídeo locais são reaproveitados; compreensão visual semântica terá um adaptador de modelo, validado em benchmark antes da escolha definitiva.
5. A leitura de infraestrutura será ampla, mas curada: saúde, filas, logs redigidos, configurações não secretas e resultados. Escrita fica restrita a endpoints específicos; o agente não recebe shell geral nem credenciais amplas.

## 4. Alternativas avaliadas

| Alternativa | Benefício | Limitação | Decisão |
|---|---|---|---|
| Evoluir Hydra e reutilizar mídia/autorização | Menor mudança de integração e reaproveitamento dos fluxos da rede | Exige contratos e testes de segurança próprios | Recomendada |
| Hermes como coordenador isolado sobre as mesmas APIs | Sessões, ferramentas e memória já disponíveis no framework | Versão instalada e integração ainda não auditadas; isolamento precisa existir de qualquer forma | Possível experimento posterior |
| Migrar para OpenClaw | Ecossistema de ferramentas/canais e políticas | Migração maior, compatibilidade e operação adicionais | Fora do primeiro rollout |

Não há evidência comparativa suficiente para declarar um framework universalmente superior. O teste de aceitação será o conjunto real de tarefas do Hydra.

## 5. Exemplos de comportamento

- Sócio: “Ouve esse áudio e me traz o relatório da loja citada.” → transcrever, resolver loja/período, consultar fonte, apresentar dados e horário real da base.
- Sócio: “Ativa esse número como admin.” → negar a ação administrativa; não criar uma tarefa privilegiada para outro agente executar.
- Davi: “Envia ‘reunião às 16h’ para este número.” → validar destinatário e texto, executar pelo remetente Hydra, retornar estado da operação com comprovante técnico.
- Davi: “Coloca este número como sócio.” → mostrar identidade/escopo da concessão, confirmar alteração sensível, gravar e conferir resultado; enviar convite externo apenas quando solicitado ou previsto na política aprovada.
- Davi: “Promove este número a admin.” → verificar autoridade do proprietário, exigir confirmação com autenticação adicional, aplicar o perfil delegado, registrar antes/depois.
- Davi: “Verifica por que o relatório não chegou.” → consultar execução, fila e erro; executar nova coleta/reenvio apenas conforme pedido e política de idempotência.
- Qualquer usuário: “Edita o código do bot.” → ferramenta indisponível; o assistente pode produzir diagnóstico/proposta para o fluxo de desenvolvimento.

## 6. Fora do escopo

Dar acesso conversacional a gerentes; autoedição de código; auto-instalação de skills; acesso root; movimentação financeira; compra automática de serviços; disparos em massa irrestritos; aprendizado que altere políticas de autorização; promessa de percepção de vídeo completa a partir de poucos quadros.

## 7. Critério de conclusão

Todos os requisitos R01–R10 têm evidências conforme [validation.md](validation.md). A liberação depende de testes de identidade, permissões, ausência de escrita em código, mídia e fluxos reais em ambiente de teste, seguidos de piloto controlado. Esta documentação não representa implementação concluída.
