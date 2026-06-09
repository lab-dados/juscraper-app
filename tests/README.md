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

> **Importante — use o wheel vendorizado.** O app carrega o juscraper do wheel em
> `web/public/wheels/` (build do git HEAD), que pode **divergir do PyPI mesmo com a
> mesma versão**. O `.venv` do `uv sync` instala o juscraper do PyPI, então rodar os
> testes assim pode dar falso resultado (ex.: o TJPE passa no app mas falhava na
> versão do PyPI). Para refletir o app, reinstale o juscraper a partir do wheel:
>
> ```bash
> uv sync --group dev
> WHEEL=$(python -c "import json;print(json.load(open('web/public/wheels/manifest.json'))['wheel'])")
> uv pip install --no-deps --reinstall "web/public/wheels/$WHEEL"
> ```
>
> O workflow de CI já faz esse passo automaticamente.

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
por tribunal aparece no *Summary* do job (gerado por `scripts/junit_summary.py`), e o
`report.xml` é publicado como artefato.

**É um monitor, não um gate.** Bater em ~25 sites de tribunais ao vivo gera 5xx/403
transitórios em qualquer dia; falhar o job nisso seria só ruído. Por isso o passo do
pytest usa `continue-on-error: true` — **o job fica verde** e o estado real de cada
tribunal aparece na tabela do *Summary*. Para transformar em gate (falhar quando algum
`supported` quebrar), remova o `continue-on-error` ou adicione um passo final que sai
com erro quando `steps.pytest.outcome == 'failure'`.
