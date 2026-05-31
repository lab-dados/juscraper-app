# Proxy CORS — juscraper-app

Relay mínimo que permite o app (rodando no browser via Pyodide) chamar os sites
dos tribunais, contornando a same-origin policy. É **stateless** e roda de graça
no plano free do Cloudflare Workers.

## Como funciona

O glue Python manda a requisição para o proxy com cabeçalhos especiais (porque
`Cookie`/`User-Agent` são *forbidden headers* no navegador):

| Cabeçalho enviado | Vira no upstream |
|-------------------|------------------|
| `X-Target-URL`    | a URL real chamada |
| `X-Cookie`        | `Cookie`         |
| `X-UA`            | `User-Agent`     |

E o proxy devolve:

| Cabeçalho devolvido | Conteúdo |
|---------------------|----------|
| `X-Set-Cookie`      | todos os `Set-Cookie` do upstream (separados por `\n`) |
| `X-Final-Url`       | URL final após redirects |
| `X-Upstream-Status` | status HTTP real do upstream |

O proxy segue redirects manualmente, acumulando cookies na cadeia, para imitar o
`requests.Session`.

## Deploy (free tier)

```bash
cd proxy
npx wrangler login        # autentica na sua conta Cloudflare
npx wrangler deploy       # publica; imprime a URL https://juscraper-proxy.<conta>.workers.dev
```

Copie a URL publicada para `web/.env`:

```
VITE_PROXY_URL=https://juscraper-proxy.<sua-conta>.workers.dev
```

## Geração de notebook no Colab (rota `/gist`)

O botão "Abrir no Colab com esta busca" faz `POST /gist` neste Worker, que cria
um **Gist não listado** com o notebook da busca e devolve a URL do Colab. Para
isso o Worker precisa de um token do GitHub com escopo `gist`:

```bash
# 1. Crie um Personal Access Token (classic) com o escopo "gist"
#    em https://github.com/settings/tokens (idealmente numa conta bot do LabDados).
# 2. Configure como secret do Worker e publique:
cd proxy
npx wrangler secret put GITHUB_GIST_TOKEN   # cole o token quando pedir
npx wrangler deploy
```

Sem o secret, a rota responde 501 e o app cai no notebook genérico do Colab
(o usuário ainda pode copiar o código da aba Código). Os Gists ficam na conta
dona do token, são **não listados** (acessíveis só por URL) e contêm o termo
buscado, então prefira uma conta institucional.

## Dev local

```bash
cd proxy
npx wrangler dev          # sobe em http://localhost:8787
# para testar /gist localmente, crie proxy/.dev.vars com:
#   GITHUB_GIST_TOKEN=ghp_xxx
```

## Segurança

Este proxy repassa qualquer URL passada em `X-Target-URL`. Para uso público,
considere restringir os domínios de destino a `*.jus.br` (há um ponto de extensão
em `resolveTarget`/`handle` no `worker.js`).
