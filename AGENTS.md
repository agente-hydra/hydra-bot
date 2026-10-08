# Regras do Projeto — [Nome do Projeto]

> Copie este arquivo para a raiz do seu projeto e edite as seções relevantes.
> Estas regras se aplicam APENAS a este projeto e complementam as regras globais em `~/.gemini/config/rules/`.

## Stack
- **Framework:** Next.js 14+ (App Router)
- **UI:** shadcn/ui + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Language:** TypeScript (strict mode)
- **Package Manager:** npm

## Comandos do Projeto
```bash
# Build
npm run build

# Dev server
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

## Coding Standards
- TypeScript strict — sem `any`, sem `@ts-ignore`
- Componentes React: function components com arrow syntax
- Hooks customizados: prefixo `use` + arquivo dedicado em `hooks/`
- Server Components por padrão, `"use client"` só quando necessário
- Imports com alias `@/` para o root do projeto
- Tailwind para styling — sem CSS modules, sem styled-components

## Banco de Dados (Supabase)
- Toda query deve respeitar RLS — nunca usar `service_role` key no frontend
- Migrations em `supabase/migrations/` — nunca alterar banco manualmente
- RPCs para lógica complexa — nunca fazer JOINs complexos no frontend

## Memória do Projeto
A memória persistente está em `.agent/memory/`. Consulte ANTES de qualquer proposta.

## Landing Pages & Modo Diretor Criativo
- **Anti-Slop:** Proibido títulos com gradiente violeta/rosa neon sobre fundo preto e grids de 3 cards genéricos.
- **Catálogo de Componentes:** Consultar Shoogle (`shoogle.dev`), 21st.dev e Aceternity UI.
- **Pipeline Visual (Nano Banana Pro + Veo 3):** O agente gera os Prompt Packs calibrados; o usuário roda no Flow e deposita em `projects/<nome-lp>/public/assets/`.
- **Projetos:** Todo projeto de LP deve ser criado em `projects/<nome-lp>/` preparado para vinculação ao repositório Git.

## Segurança
- `.env` e `.env.*` NUNCA devem ser commitados
- Tokens e chaves APENAS em variáveis de ambiente
- Supabase `anon` key é pública — `service_role` key NUNCA no frontend

## Regras Críticas de WhatsApp e Mensageria (Evolution API)
- ⛔ **PROIBIÇÃO ABSOLUTA:** É ESTRITAMENTE PROIBIDO enviar qualquer mensagem (seja teste, automação ou produção) usando instâncias ou números de gerentes de loja (ex: `Maua`, `Jorge Beretta`, `Kennedy`, `Dom Pedro`, `Rudge`, `Jabaquara`, `Piraporinha`, `Planalto`, `Carijós`, etc.). O número/aparelho do gerente de loja NUNCA pode ser usado como remetente!
- ✅ **Instâncias Emissoras Permitidas Exclusivas:** APENAS `hydra` e `atendimento` (ou outra nova instância que o usuário autorizar expressamente por escrito e que NÃO seja de gerente).
- Qualquer script temporário de teste, rotina Node ou ferramenta MCP deve respeitar incondicionalmente essa trava.
