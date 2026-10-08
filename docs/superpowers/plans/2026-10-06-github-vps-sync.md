# Hydra GitHub/VPS Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Execução autorizada diretamente pelo usuário nesta conversa; não criar agentes adicionais.

**Goal:** Publicar o Hydra real em mktfun/hydra-bot e manter produção atualizada por versões verificadas.

**Architecture:** Captura dos arquivos de produção, ajuste mínimo de configuração, CI que promove SHA validado e agente de deploy na VPS com chave somente leitura, lock e rollback.

**Tech Stack:** Node 22, TypeScript, npm, Python 3, GitHub Actions, Git, SSH, PM2, cron.

**Spec:** ../specs/2026-10-06-github-vps-sync-design.md

## Global Constraints

- Não versionar dados, conversas, sessões, credenciais ou backups.
- Preservar implementações operacionais; documentar alterações de instalação.
- Não executar suites que enviam mensagens ou consultam clientes.
- Não substituir outras integrações de /opt/bots.
- Nunca interromper coleta em andamento para aplicar release.

## Review Focus

- Imports absolutos e sessões precisam funcionar após mudar instalação.
- CI não pode promover commits reprovados ou supersedidos.
- Falha de health check deve restaurar código anterior.
- Divergência manual em produção deve bloquear deploy.
- Mudanças de banco não permitem afirmar rollback de dados.

## Task 1: Baseline

- [ ] Capturar arquivos, referências e hashes; sanitizar segredos com relatório sem valores.
- [ ] Preparar dependências, README, env.example e verificação estática.
- [ ] Commit da baseline e push privado após verificação.

## Task 2: Deploy

- [ ] Escrever testes de regressão do controlador (SHA, divergência, lock, rollback); observar falha inicial.
- [ ] Implementar controlador, health check e workflow de promoção; verificar testes e sintaxe.
- [ ] Criar deploy key readonly e instalar configuração privada na VPS.
- [ ] Preparar release e ativar preservando PM2, MCP e cron.

## Task 3: Homologação

- [ ] Testar push → CI → promotion → VPS, conferindo SHA e health check.
- [ ] Verificar rollback e proteção contra divergência sem enviar mensagens.
- [ ] Registrar situação final, limitações e comandos de operação.
