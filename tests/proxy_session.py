"""Roteia todo o `requests` do juscraper por um proxy CORS — fora do browser.

Este modulo e o espelho, em Python puro (transporte via `requests`), do glue que
roda no navegador (``web/src/pyodide/glue.py``): instala um ``HTTPAdapter`` custom
que encaminha cada requisicao ao proxy CORS, faz o threading de cookies por host e
reconstroi a ``Response``. Usado pelos testes (``tests/test_tribunais.py``) para
exercitar exatamente o caminho de rede do app publicado — proxy incluso — e assim
detectar quando um tribunal quebra por causa do proxy.

A unica diferenca para o glue do browser e o transporte: la e XHR sincrono; aqui e
uma ``requests.Session`` criada ANTES do monkeypatch (para nao recursar no proxy).
"""
from __future__ import annotations

import base64
import os
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from requests.models import Response
from requests.structures import CaseInsensitiveDict
from requests.utils import get_encoding_from_headers

# Proxy de producao (mesmo valor da variavel VITE_PROXY_URL do repositorio).
# Sobrescreva com a env JUSCRAPER_PROXY_URL para apontar para o wrangler local
# (http://localhost:8787) ou outro deploy.
DEFAULT_PROXY_URL = "https://juscraper-proxy.julio-trecenti.workers.dev"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Cabecalhos que o browser nao deixa o JS setar; aqui replicamos a mesma omissao
# para manter o comportamento identico ao glue.
FORBIDDEN = {
    "cookie", "user-agent", "host", "content-length", "connection",
    "accept-encoding", "origin", "referer",
}


def proxy_url() -> str:
    return os.environ.get("JUSCRAPER_PROXY_URL", DEFAULT_PROXY_URL).rstrip("/")


def _parse_set_cookie(raw: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for line in (raw or "").split("\n"):
        first = line.split(";")[0]
        if "=" in first:
            name, _, value = first.partition("=")
            if name.strip():
                out.append((name.strip(), value.strip()))
    return out


class ProxyAdapter(HTTPAdapter):
    """Encaminha cada request pro proxy CORS; gerencia cookies por host."""

    def __init__(self, proxy: str, timeout: float = 60.0, *a, **k):
        super().__init__(*a, **k)
        self._proxy = proxy
        self._timeout = timeout
        # Transporte criado ANTES do monkeypatch global -> rede real, sem recursao.
        self._transport = requests.sessions.Session.__new__(requests.sessions.Session)
        _orig_session_init(self._transport)
        self._cookies_by_host: dict[str, dict[str, str]] = {}

    def send(self, request, **kwargs):  # noqa: ARG002
        real_url = request.url
        host = urlparse(real_url).netloc
        headers = {k: v for k, v in request.headers.items() if k.lower() not in FORBIDDEN}

        stored = self._cookies_by_host.get(host, {})
        stored_str = "; ".join(f"{k}={v}" for k, v in stored.items())
        existing = request.headers.get("Cookie")
        cookie = "; ".join(x for x in [existing, stored_str] if x)

        proxy_headers = dict(headers)
        proxy_headers["X-Target-URL"] = real_url
        proxy_headers["X-UA"] = UA
        if cookie:
            proxy_headers["X-Cookie"] = cookie

        r = self._transport.request(
            request.method, self._proxy, headers=proxy_headers,
            data=request.body, timeout=self._timeout,
        )

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


# Guarda o __init__ original ANTES de qualquer patch (usado pelo transporte).
_orig_session_init = requests.sessions.Session.__init__
_installed = False


def raw_session() -> requests.Session:
    """Cria uma Session que NAO passa pelo proxy (usa o __init__ original).

    Necessario para testar o proxy diretamente: depois de ``install()``, toda
    ``requests.Session`` nova roteia pelo proxy, o que causaria proxy-no-proxy.
    """
    s = requests.sessions.Session.__new__(requests.sessions.Session)
    _orig_session_init(s)
    return s


def install(proxy: str | None = None, timeout: float = 60.0) -> str:
    """Faz toda nova ``requests.Session`` rotear pelo proxy. Idempotente.

    Retorna a URL do proxy efetivamente usada.
    """
    global _installed
    proxy = (proxy or proxy_url()).rstrip("/")
    if _installed:
        return proxy

    def _patched_init(self, *a, **k):
        _orig_session_init(self, *a, **k)
        adapter = ProxyAdapter(proxy, timeout=timeout)
        self.mount("https://", adapter)
        self.mount("http://", adapter)

    requests.sessions.Session.__init__ = _patched_init
    _installed = True
    return proxy
