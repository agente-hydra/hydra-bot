# Hydra: GitHub e produção sincronizados

## Objetivo e autorização

O usuário solicitou criar `mktfun/hydra-bot`, publicar o código do bot e crawler realmente utilizado na VPS e atualizar produção automaticamente após push. Repositório privado. Captura inicial preserva os módulos e caminhos internos; somente segredos embutidos e caminhos de instalação recebem ajustes necessários à publicação e instalação reproduzível.

## Produção observada

- Entrada do PM2 hydra-bot: `/home/operacional/hydra/webhook-listener.js`.
- `/home/operacional/hydra/src` aponta para `/opt/bots/src`.
- Código operacional: `/opt/bots/src/hydra-sync` e dependências locais transitivas.
- Cron: atualização financeira a cada hora e coleta completa às 03h, com lock `/tmp/hydra-data-refresh.lock`.
- SQLite, vault, coleta, credenciais e sessões são persistentes e permanecem fora do Git.
- Node 22, npm 10; package-lock de produção capturado como referência.

## Publicação e instalação

Registrar manifesto de hashes dos arquivos de origem e ajustes. Excluir backups, sessões, dados e outras integrações sem dependência do Hydra. Manter código de produção e documentação de limitações existentes. Verificar imports, sintaxe, segredos e testes isolados, sem executar testes que enviam mensagens ou realizam coletas reais.

## Atualização automática

GitHub Actions valida cada push da main, assina uma tag de release com uma chave dedicada e promove somente o SHA validado à branch `production`. A VPS usa uma deploy key somente leitura, consulta essa branch a cada minuto e exige a assinatura da CI. O instalador prepara uma release por SHA, serializa deploys e aguarda o lock do crawler antes da ativação. Credenciais e dados permanecem externos. O health check do bot, a leitura técnica do SQLite e o manifesto determinam sucesso; falha restaura código anterior. Um journal permite recuperação após interrupção. Migrações destrutivas não fazem parte desse deploy.

## Critérios

Código publicado, credenciais ausentes, dependências instaláveis, chave limitada ao repositório, main validada, release ativa identificada por SHA, cron preservado, teste real de atualização e rollback sem efeitos externos de mensagens.
