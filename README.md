# Atletas — MVP

App de treino para atletas: perfil, provas, upload e análise de treinos (GPX/TCX), blocos previsto×realizado, feed e coach de voz ao vivo (GPS + fala no navegador).

Construído em **Node.js puro** — sem `npm install`, sem framework, sem build step. Só o que já vem com o Node 18+ (`node:http`, `node:sqlite`, `node:crypto`) + HTML/CSS/JS simples.

## Como rodar

```
node server.js
```

Abra `http://localhost:3000` no navegador. Crie uma conta e comece a usar.

Requisitos: Node.js **20.19+ / 22.5+** (usa `node:sqlite`, ainda experimental — o aviso no terminal é esperado e inofensivo).

## O que tem

- **Perfil** (`/`, `/settings`) — nome, cidade, prova-alvo, meta de tempo.
- **Provas** (`/races`) — CRUD de provas futuras/passadas.
- **Treinos** (`/activities`) — importe `.gpx`/`.tcx` do relógio (o app calcula distância, pace, splits por km, FC, elevação) ou registre manualmente.
- **Blocos previsto × realizado** — na página de cada treino, defina blocos (ex: "Aquecimento km 0–6, alvo 5:35/km") e o app calcula o pace/FC reais naquele trecho a partir dos splits.
- **Análise com IA** (opcional) — cole sua própria chave da API da Anthropic em Config para gerar uma análise técnica de cada treino (o uso é cobrado na sua conta, não é uma chave compartilhada).
- **Feed** (`/feed`) — poste sobre os treinos.
- **Coach de voz ao vivo** (`/coach`) — usa GPS + síntese de voz do navegador para falar o pace e o bloco atual durante a corrida (com celular no bolso). FC por Bluetooth funciona em Android/Chrome; no iPhone/Safari só o pace por bloco.

## Por que sem npm

O ambiente onde este MVP foi construído tem o registro do npm (`registry.npmjs.org`) bloqueado pela política de rede da sessão — não deu pra instalar Next.js, Prisma, etc. Isso não afeta você rodando localmente: se quiser migrar para Next.js/Prisma depois (com npm liberado na sua máquina), o banco de dados e as rotas aqui já mapeiam 1:1 pro schema que seria usado lá (`db.js` tem o schema completo).

## Estrutura

```
server.js        rotas HTTP + lógica de cada página
db.js             schema SQLite (users, races, activities, blocks, posts, sessions)
lib/auth.js       sessão por cookie + senha com scrypt
lib/gpx.js        parser de GPX/TCX (sem dependências)
lib/anthropic.js  chamada direta à API da Anthropic (fetch nativo)
lib/http.js       parse de formulário e upload multipart
lib/format.js     helpers de pace/tempo/data
views.js          HTML das páginas do app
views_coach.js    página standalone do coach de voz
public/style.css  tema visual (claro/escuro automático)
```

## Limitações do MVP (por escopo, não por técnica)

- Sem login social / OAuth do Strava — importação é por arquivo GPX/TCX.
- Sem grafo social (seguir outros atletas) — feed é só o seu próprio histórico.
- Sem app nativo ainda — é web, responsivo, funciona bem no celular pelo navegador (conforme combinado: web primeiro, nativo depois).
- Banco SQLite local (`data/app.db`) — ótimo pra uso pessoal; para múltiplos usuários simultâneos em produção, trocar por Postgres seria o próximo passo natural.
