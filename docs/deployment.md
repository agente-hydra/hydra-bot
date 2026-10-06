# Publicação na VPS

Repositório privado: `mktfun/hydra-bot`. Branch de trabalho e publicação: `main`.

## Fluxo ativo

1. Faça commit e push na `main`.
2. GitHub Actions valida o código e os testes do deploy.
3. A automação assina a release e promove o mesmo commit para `production`.
4. A VPS consulta versões aprovadas a cada minuto, aguarda coletas/atendimentos em execução e ativa o commit.

O arquivo `/home/operacional/hydra-deploy/status.json` informa o SHA ativo e o anterior. O log está em `/home/operacional/hydra-deploy/sync.log`.

SQLite, vault, sessões e credenciais continuam na VPS. Os arquivos originais anteriores à instalação estão preservados em `/home/operacional/hydra-deploy/legacy-paths` e na release `legacy-before-git`.

## Verificação realizada

A instalação limpa, a CI e os 10 testes Linux do controlador passaram. O bot respondeu ao health check após a primeira ativação; o SQLite foi verificado por consulta técnica somente leitura.

O código operacional foi preservado, com os ajustes de instalação documentados no manifesto. O diagnóstico TypeScript legado ainda aponta sete erros: um import não exportado e dependências/declarações de testes antigos que não fazem parte da captura. A publicação não representa correção desses testes nem dos incidentes anteriores de interpretação do bot.

## Alterações na VPS

Edite pelo Git. Alterações manuais em arquivos de uma release ou nos caminhos gerenciados bloqueiam a atualização automática. Em caso de falha, consulte o log e o README para pausar a sincronização ou retornar à release anterior.
