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

## Dev local

```bash
cd proxy
npx wrangler dev          # sobe em http://localhost:8787
```

## Segurança

Este proxy repassa qualquer URL passada em `X-Target-URL`. Para uso público,
considere restringir os domínios de destino a `*.jus.br` (há um ponto de extensão
em `resolveTarget`/`handle` no `worker.js`).
