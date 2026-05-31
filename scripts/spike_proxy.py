"""Spike headless: valida proxy + cookie-threading + fluxo eSAJ do juscraper.

Mirror da logica do glue.py, mas com transporte via `requests` (em vez de XHR
do browser) apontando pro proxy local (wrangler dev em :8787). Se isto baixar
resultados do TJSP, o caminho de rede inteiro (proxy, cookies, conversationId,
POST de busca) esta validado — so o transporte XHR no browser fica por testar.
"""
import base64
import sys
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from requests.models import Response
from requests.structures import CaseInsensitiveDict
from requests.utils import get_encoding_from_headers

PROXY_URL = "http://localhost:8787"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
FORBIDDEN = {"cookie", "user-agent", "host", "content-length", "connection",
             "accept-encoding", "origin", "referer"}

# Transporte criado ANTES do patch -> usa rede real direto pro proxy (sem recursao).
_transport = requests.Session()


def _parse_set_cookie(raw):
    out = []
    for line in (raw or "").split("\n"):
        first = line.split(";")[0]
        if "=" in first:
            name, _, value = first.partition("=")
            if name.strip():
                out.append((name.strip(), value.strip()))
    return out


class ProxyAdapter(HTTPAdapter):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._cookies_by_host = {}

    def send(self, request, **kwargs):
        real_url = request.url
        host = urlparse(real_url).netloc
        headers = {k: v for k, v in request.headers.items() if k.lower() not in FORBIDDEN}
        stored = self._cookies_by_host.get(host, {})
        existing = request.headers.get("Cookie")
        cookie = "; ".join(x for x in [existing, "; ".join(f"{k}={v}" for k, v in stored.items())] if x)

        proxy_headers = dict(headers)
        proxy_headers["X-Target-URL"] = real_url
        proxy_headers["X-UA"] = UA
        if cookie:
            proxy_headers["X-Cookie"] = cookie

        r = _transport.request(request.method, PROXY_URL, headers=proxy_headers,
                               data=request.body, timeout=60)

        sc_b64 = r.headers.get("X-Set-Cookie", "")
        sc = base64.b64decode(sc_b64).decode("utf-8", "replace") if sc_b64 else ""
        for name, value in _parse_set_cookie(sc):
            self._cookies_by_host.setdefault(host, {})[name] = value

        resp = Response()
        resp.status_code = int(r.headers.get("X-Upstream-Status", r.status_code))
        resp._content = r.content
        resp._content_consumed = True
        resp.url = r.headers.get("X-Final-Url", real_url)
        resp.request = request
        resp.reason = ""
        resp.raw = None
        resp.headers = CaseInsensitiveDict()
        if r.headers.get("Content-Type"):
            resp.headers["Content-Type"] = r.headers["Content-Type"]
        resp.encoding = get_encoding_from_headers(resp.headers)
        return resp


_orig_init = requests.sessions.Session.__init__


def _patched_init(self, *a, **k):
    _orig_init(self, *a, **k)
    adapter = ProxyAdapter()
    self.mount("https://", adapter)
    self.mount("http://", adapter)


requests.sessions.Session.__init__ = _patched_init

# --- roda o juscraper pelo proxy ---
import juscraper as jus  # noqa: E402

print("Rodando tjsp.cjsg('dano moral', paginas=1) PELO PROXY...")
tjsp = jus.scraper("tjsp")
df = tjsp.cjsg("dano moral", paginas=1)
print(f"OK! linhas={len(df)} colunas={list(df.columns)}")
print(df.head(3).to_string())
sys.exit(0 if len(df) > 0 else 1)
