# juscraper-app

App web para baixar **jurisprudência** dos tribunais brasileiros de forma
interativa, rodando o [`juscraper`](https://github.com/jtrecenti/juscraper)
**direto no navegador** (via Pyodide). Página estática, sem backend próprio —
apenas um proxy CORS mínimo para contornar a same-origin policy.

A pessoa escolhe o tipo de busca (**Jurisprudência / 2º grau** = `cjsg`, ou
**Banco de Sentenças / 1º grau** = `cjpg`) e o tribunal; o formulário de filtros
é gerado automaticamente a partir do schema da função do `juscraper`. A
ferramenta calcula o número de páginas, estima o tempo, pede confirmação, roda
com barra de progresso e mostra uma tabela interativa com download em CSV. Em
caso de erro, gera um link pré-preenchido para abrir issue no `juscraper`.

> ⚠️ **A busca é feita ao vivo.** Não há base pré-baixada — cada consulta acessa
> o site do tribunal na hora. Os dados são processados no seu navegador.

## Arquitetura

```mermaid
flowchart TB
  subgraph BR["Navegador (site estático no GitHub Pages)"]
    UI["UI React + Vite + Tailwind<br/>tribunal · filtros · tabela"]
    subgraph WK["Web Worker (Pyodide)"]
      GLUE["glue.py<br/>count() · run() · progresso via tqdm"]
      JUS["juscraper<br/>(wheel vendorizado)"]
      GLUE --- JUS
    end
    UI <--> GLUE
  end

  PX["Cloudflare Worker<br/>proxy CORS + rota /gist"]
  T["Sites dos tribunais<br/>(eSAJ, eproc, ...)"]
  GIST["GitHub Gist → Google Colab"]
  UM["Umami<br/>analytics (sem cookies)"]

  GLUE -- "XHR: X-Target-URL, X-Cookie" --> PX
  PX -- "HTTP + cookies" --> T
  UI -- "POST /gist (código da busca)" --> PX
  PX -- "cria gist não listado" --> GIST
  UI -. "eventos: busca, download, ..." .-> UM
```

Por que o proxy: o navegador bloqueia requisições diretas aos tribunais (eles
não mandam cabeçalhos CORS). O proxy só repassa o HTTP e devolve a resposta com
`Access-Control-Allow-Origin`. Ver [`proxy/README.md`](proxy/README.md).

## Como funciona

### Jornada do usuário

```mermaid
flowchart TD
  A["Abre o app"] --> B["Escolhe o tipo de busca<br/>Jurisprudência (2º grau) ou Sentenças (1º grau)"]
  B --> C["Escolhe o tribunal"]
  C --> D["Preenche o formulário de filtros<br/>(gerado do schema do juscraper)"]
  D --> E["Calcular e estimar"]
  E --> F{"Estimativa:<br/>nº de páginas + tempo"}
  F -- "Cancelar" --> D
  F -- "Confirmar (até 100 páginas)" --> G["Download com barra de progresso"]
  F -. "precisa de mais de 100?" .-> L["LabDados ou rodar via Colab"]
  G -- "sucesso" --> H["Tabela interativa<br/>filtrar · ordenar · paginar"]
  G -- "erro" --> I["Card de erro<br/>link pré-preenchido p/ issue"]
  H --> J["Baixar CSV / XLSX"]
  H --> K["Aba Código<br/>→ abrir no Colab com a busca"]
```

### O que acontece numa busca

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant App as UI (React)
  participant Py as Pyodide (glue + juscraper)
  participant Px as Proxy (Cloudflare)
  participant T as Tribunal

  U->>App: preenche filtros e clica "Calcular"
  App->>Py: count(tribunal, endpoint, params)
  Py->>Px: 1ª página (X-Target-URL, X-Cookie)
  Px->>T: GET/POST + cookies
  T-->>Px: HTML (Set-Cookie)
  Px-->>Py: HTML + X-Set-Cookie (base64)
  Py-->>App: nº de páginas (capturado do total do tqdm)
  App-->>U: estimativa → confirma
  App->>Py: run(..., paginas)
  loop cada página
    Py->>Px: página N
    Px->>T: requisição
    T-->>Px: HTML
    Px-->>Py: HTML
    Py-->>App: progresso (i / total)
  end
  Py-->>App: DataFrame (JSON + CSV + XLSX)
  App-->>U: tabela + downloads
```

### Suporte por tribunal
- **cjsg**: todos os 25 TJs.
- **cjpg**: TJES, TJSP, TJTO.
- **Experimental**: TJCE (TLS customizado pode falhar pelo proxy).
- **Indisponível no v1**: TJMG (exige resolver captcha de imagem).

## Estrutura

| Caminho | O quê |
|---------|-------|
| `web/` | App React/Vite/Tailwind (UI + bridge Pyodide) |
| `web/src/pyodide/glue.py` | Glue Python: install, roteamento de rede, count/run |
| `web/src/data/courts_meta.json` | Metadados gerados (campos por tribunal) |
| `web/public/wheels/` | Wheel do juscraper vendorizado (versionado) |
| `proxy/` | Cloudflare Worker (proxy CORS) |
| `scripts/gen_courts_meta.py` | Gera `courts_meta.json` a partir dos schemas |
| `scripts/spike_proxy.py` | Teste headless do fluxo proxy + juscraper |

## Desenvolvimento

Pré-requisitos: Node 18+, Python 3.12 com o `juscraper` instalado (use o
`.venv` do repo), e a CLI `wrangler` (via `npx`).

```bash
# 1. Proxy local
cd proxy && npx wrangler dev --port 8787 --local

# 2. Web (em outro terminal)
cd web
cp .env.example .env        # VITE_PROXY_URL=http://localhost:8787
npm install
npm run dev                 # http://localhost:5173
```

### Atualização do juscraper

O app instala um **wheel vendorizado** em `web/public/wheels/`, e descobre qual
carregar em runtime via `web/public/wheels/manifest.json` (`{wheel, version, rev}`).
Nada de versão fica hardcoded no código.

Isso é atualizado automaticamente pela Action
[`update-juscraper.yml`](.github/workflows/update-juscraper.yml), que roda todo
dia às 03:00 (Brasília): rebuilda o wheel a partir do `main` do
[juscraper](https://github.com/jtrecenti/juscraper), regenera o `courts_meta.json`
e, se algo mudou (comparando a SHA do commit), commita e dispara o deploy. Se o
build do wheel ou a geração de metadados falhar, o job aborta e a versão anterior
continua no ar.

Para atualizar **manualmente** (ou regenerar os metadados localmente):
```bash
.venv/Scripts/python.exe scripts/gen_courts_meta.py   # regenera courts_meta.json
# e, se trocar o wheel, atualize web/public/wheels/ + manifest.json
```
Ou dispare a Action na mão: **Actions > Atualizar juscraper (diário) > Run workflow**.

## Deploy

1. **Proxy** (Cloudflare Workers, free): `cd proxy && npx wrangler deploy`.
   Copie a URL para `web/.env` (`VITE_PROXY_URL`).
2. **Site** (GitHub Pages): `cd web && npm run build` gera `web/dist/`.
   Há um workflow em [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   que faz build e publica no Pages a cada push na `main`.

## Notas técnicas
- micropip 0.27.x falha ao baixar wheels por URL; por isso o wheel é buscado em
  JS e instalado via esquema `emfs:` (ver `web/src/pyodide/worker.ts`).
- O proxy segue redirects manualmente, acumulando cookies, para imitar o
  `requests.Session`. Cookies viajam como `X-Cookie`/`X-Set-Cookie` (base64)
  porque `Cookie`/`Set-Cookie` são *forbidden headers* no navegador.
- O total de páginas é capturado pelo argumento `total` do `tqdm` que o
  juscraper cria internamente; quando o tribunal não o expõe, a UI pede um
  limite de páginas.
