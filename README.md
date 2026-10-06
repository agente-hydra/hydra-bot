# Hydra Bot

Bot operacional e crawler da oficina, capturados da versão em produção na VPS em 06/10/2026. Repositório privado.

## Código

- `webhook-listener.js`: entrada WhatsApp/Evolution, executada pelo PM2.
- `src/hydra-sync/`: dispatcher, consultas, memória, MCP e crawlers.
- `src/workers/oficina-agent/`: ações Playwright e dependências do crawler.
- `scripts/`: execução financeira horária e coleta diária completa.
- `docs/app-map/empresas.json`: configuração das unidades.
- `deploy/`: validação, sincronização e testes do deploy.
- `docs/production-baseline.json`: arquivos de origem, hashes e ajustes para publicação.

## Instalação

Node 22, npm, Python 3.12 ou superior e Linux para os agendamentos de produção.

```sh
npm ci
cp .env.example .env
# Preencha somente as configurações necessárias ao ambiente.
npm run verify
python3 -m unittest discover -s deploy/tests -v
```

O crawler precisa de Chromium instalado pelo Playwright e acesso autorizado ao ERP. `npm start`, `npm run crawl:finance` e `npm run crawl:full` executam integrações reais; use-os somente no ambiente configurado.

## Publicar uma alteração

```sh
git pull --ff-only origin main
# Faça e verifique sua alteração.
git add <arquivos>
git commit -m "Descrição da alteração"
git push origin main
```

GitHub Actions verifica sintaxe JS/TS, módulos locais dos pontos de entrada, credenciais reconhecidas e testes do controlador. Se aprovado, assina uma tag `hydra-release/<SHA>` e promove o mesmo commit para `production`. A VPS consulta essa branch a cada minuto, exige a assinatura da chave da CI, instala dependências da release, verifica drivers SQLite em memória e aguarda os locks antes de ativar o código. Um push direto na branch `production` sem uma tag assinada válida não é aceito pelo deploy.

Somente pushes na `main` atualizam produção. A versão ativa é identificada pelo SHA do commit. Mudanças manuais em arquivos gerenciados na VPS bloqueiam o deploy para evitar que sejam sobrescritas.

## Dados e configuração

SQLite, vault, históricos de conversa, sessões de navegador, logs e credenciais permanecem na VPS, fora do Git e das releases. O deploy não contém migrações destrutivas nem sincroniza bancos entre ambientes. Segredos literais encontrados na captura foram substituídos por variáveis de ambiente; os valores existentes permanecem em configuração privada.

## Operação na VPS

```sh
cat /home/operacional/hydra-deploy/status.json
tail -n 50 /home/operacional/hydra-deploy/sync.log
touch /home/operacional/hydra-deploy/PAUSED
# Rollback de código para a release anterior; também pausa deploy automático:
python3 /home/operacional/hydra-deploy/sync.py --rollback
# Retomar sincronização:
rm /home/operacional/hydra-deploy/PAUSED
```

Falha de health check restaura o código anterior. Isso não desfaz alterações de dados realizadas por uma aplicação; mudanças de schema exigem plano próprio de compatibilidade e backup.

O controlador registra uma transação pendente antes de ativar código e recupera a versão anterior se o processo for interrompido. Uma preparação que falha é registrada pelo SHA e não reinstala indefinidamente. Para repetir esse SHA após resolver o problema, remova somente `failed` e `lastError` do `status.json` com a sincronização pausada.

## Limites da verificação

A captura preserva regras de negócio existentes. A publicação não comprova correção de incidentes de interpretação do Hydra. `npm run typecheck` está disponível para diagnosticar código legado; sua situação é registrada no relatório de entrega. A CI não executa scripts antigos que enviam mensagens, leem conversas reais ou fazem coletas no ERP.
