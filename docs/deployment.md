# Publicação na VPS

Repositório privado: `mktfun/hydra-bot`. Branch de trabalho e publicação: `main`.

## Fluxo ativo

1. Faça commit e push na `main`.
2. GitHub Actions valida o código e os testes do deploy.
3. A automação assina a release e promove o mesmo commit para `production`.
4. A VPS consulta versões aprovadas a cada minuto, aguarda coletas/atendimentos em execução e ativa o commit.
5. A versão passa por pelo menos 10 minutos de verificações locais contínuas antes de entrar no histórico saudável. Outra atualização aguarda essa observação.

O arquivo `/home/operacional/hydra-deploy/status.json` informa o SHA ativo, o anterior, `phase`, `lastHealthy`, `healthyHistory`, `lastHealth`, `healthFailures`, `rejected` e eventuais incidentes. O log está em `/home/operacional/hydra-deploy/sync.log`.

## Recuperação automática

- Cada ciclo verifica primeiro o bot local, antes de consultar o GitHub. O fetch tem limite de 25 segundos para não bloquear o próximo ciclo indefinidamente.
- Saúde local exige HTTP 200 com listener online, processo PM2 online, SQLite acessível por consulta técnica somente leitura e execução de funções reais de interpretação, período e composição com entradas sintéticas.
- São necessários 10 minutos de observação regular e uptime de pelo menos 10 minutos para certificar. Reinício do processo, falha ou intervalo maior que 150 segundos reinicia a janela de observação. O controlador de uma candidata só substitui o controlador estável após certificação.
- Há uma tolerância inicial de 90 segundos após a ativação. Depois, três falhas consecutivas em ciclos locais provocam uma tentativa de retorno à versão saudável anterior. Uma amostra saudável zera a contagem.
- O retorno aguarda o lock do crawler e o término de atendimentos ativos. `rollbackDeferred` explica a espera. Sessões MCP que usam o caminho gerenciado reconectam após a troca.
- O SHA rejeitado é persistido e não volta por repetição do mesmo push. Um novo commit aprovado permite outra tentativa. O sistema mantém as cinco versões certificadas mais recentes; candidatas, releases rejeitadas e arquivos originais de instalação podem existir além desse histórico. Ao retirar uma versão saudável antiga, remove somente seu código e dependências, preservando destinos das sessões e demais dados compartilhados.
- Se a recuperação falhar imediatamente ou nos ciclos seguintes, registra `phase=incident` e `recoveryBlocked=true`, sem percorrer outras versões ou reiniciar a mesma recuperação a cada minuto. Um novo SHA continua podendo entrar pelo fluxo validado. O incidente fica no status e no log; este controlador não envia avisos de WhatsApp.

Evolution, ERP e provedores de IA não são chamados por esses probes. Uma indisponibilidade externa isolada não entra na contagem de falhas locais. Falha de infraestrutura compartilhada que também afete a versão anterior resulta em incidente após a única tentativa de recuperação. Este mecanismo verifica disponibilidade e um percurso funcional limitado; respostas semanticamente erradas exigem testes próprios para as perguntas afetadas.

`PAUSED` suspende atualizações **e recuperação automática**, para permitir manutenção manual. Remover o arquivo retoma ambos. Nenhum rollback de código restaura ou reverte o SQLite; alterações de schema exigem compatibilidade e backup próprios.

SQLite, vault, sessões e credenciais continuam na VPS. Os arquivos originais anteriores à instalação estão preservados em `/home/operacional/hydra-deploy/legacy-paths` e na release `legacy-before-git`.

## Verificação realizada

A instalação limpa, a CI inicial e os 10 testes originais do controlador passaram. O upgrade acrescenta regressões para observação, rejeição persistente, recuperação única, journal, certificação e preservação de sessões, totalizando 26 testes Linux. As falhas são simuladas em diretórios temporários; a validação operacional consulta somente saúde local.

O código operacional foi preservado, com os ajustes de instalação documentados no manifesto. O diagnóstico TypeScript legado ainda aponta sete erros: um import não exportado e dependências/declarações de testes antigos que não fazem parte da captura. A publicação não representa correção desses testes nem dos incidentes anteriores de interpretação do bot.

## Alterações na VPS

Edite pelo Git. Alterações manuais em arquivos de uma release ou nos caminhos gerenciados bloqueiam a atualização automática. Em caso de falha, consulte o log e o README para pausar a sincronização ou retornar à release anterior.
