# Diretório de Projetos de Landing Pages

Este diretório contém os projetos de Landing Pages gerados pelo Antigravity em conjunto com os Prompt Packs (Nano Banana Pro + Veo 3).

## Estrutura Recomendada por Projeto
Cada landing page fica em sua própria pasta e pode ser vinculada ao repositório Git:

```text
projects/
└── [nome-da-landing-page]/
    ├── .git/
    ├── public/
    │   └── assets/
    │       ├── hero-poster.webp   <- Gerado no Nano Banana Pro
    │       └── hero-bg.mp4        <- Gerado no Veo 3 / Higgsfield
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   └── page.tsx
    │   └── components/
    │       └── CinematicHeroVideo.tsx
    ├── package.json
    └── tailwind.config.ts
```

## Vinculação Git
Para inicializar e vincular a um repositório remoto:
```bash
git init
git add .
git commit -m "feat: landing page initial release with cinematic hero"
git branch -M main
git remote add origin <URL_DO_SEU_REPOSITORIO>
git push -u origin main
```
