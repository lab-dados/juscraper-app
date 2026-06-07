# Testes dos tribunais (via proxy)

Estes testes rodam o **juscraper de cada tribunal exposto pelo app, passando pelo
proxy CORS** — o mesmo caminho de rede do site publicado. Servem para descobrir
quais tribunais estão funcionando e diagnosticar quebras (mudança no site do
tribunal, problema no proxy, etc.).

A lista de tribunais/endpoints vem de `web/src/data/courts_meta.json` (a mesma
fonte que alimenta o front), então testamos exatamente o que o app oferece.

## Como funciona

- `tests/proxy_session.py` — instala um `HTTPAdapter` que encaminha todo o
  `requests` ao proxy CORS, fazendo o threading de cookies por host. É o espelho,
  em Python, do glue que roda no navegador (`web/src/pyodide/glue.py`).
- `tests/test_tribunais.py` — um caso de teste por `(tribunal, endpoint)`. Faz uma
  busca mínima (`pesquisa="dano moral"`, `paginas=1`) e verifica que voltam linhas.

Política por status de suporte (definido em `scripts/gen_courts_meta.py`):

| Status | Comportamento no teste |
|---|---|
| `supported` | deve passar; falha = regressão real |
| `experimental` | `xfail(strict=False)`: falha vira xfail, sucesso vira xpass |
| `unsupported` | `skip` (bloqueado de propósito, ex.: captcha) |

## Rodar localmente

```bash
# instala dev deps (pytest) no .venv gerenciado pelo uv
uv sync --group dev

# todos os tribunais (proxy de produção por padrão)
uv run pytest tests/ -v

# um tribunal específico
uv run pytest tests/ -v -k tjes

# contra o wrangler local (proxy/worker.js): cd proxy && npx wrangler dev
JUSCRAPER_PROXY_URL=http://localhost:8787 uv run pytest tests/ -v
```

> **Importante:** o transporte aqui é `requests` (Python). O app real usa XHR
> síncrono no navegador. O proxy e a lógica do juscraper são idênticos, mas uma
> falha que só aconteça no navegador (e não aqui) aponta para o transporte XHR em
> `web/src/pyodide/glue.py`, não para o proxy.

## CI

`.github/workflows/test-tribunais.yml` roda a suíte diariamente (e sob demanda via
*workflow_dispatch*, com opção de informar outro proxy). A cada execução, um resumo
por tribunal aparece no *Summary* do job (gerado por `scripts/junit_summary.py`).
