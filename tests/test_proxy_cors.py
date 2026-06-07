"""Regressao do proxy CORS: o `Access-Control-Allow-Origin: *` do worker deve
SEMPRE prevalecer, mesmo quando o upstream ecoa o proprio CORS.

Contexto: a API do TJES responde com ``Access-Control-Allow-Origin:
http://127.0.0.1:5173`` (origin de dev hardcoded) + ``Allow-Credentials: true``.
Antes do fix em ``proxy/worker.js``, o worker copiava esses headers do upstream e
sobrescrevia o proprio ``*``, fazendo o navegador (em https://lab-dados.github.io)
bloquear a resposta com ``net::ERR_FAILED`` / "Failed to fetch". O Python ignora
CORS, entao o bug so aparecia no browser.

Este teste bate no proxy com o alvo do TJES (caso real do bug) e verifica que a
resposta sai com ``*`` e sem ``Allow-Credentials``. Roda contra o proxy de
``JUSCRAPER_PROXY_URL`` (default: producao) — vai falhar ate o worker corrigido
ser publicado (``cd proxy && npx wrangler deploy``).
"""
from __future__ import annotations

import pytest

from proxy_session import UA, proxy_url, raw_session

# Alvo real que dispara o bug: a API do TJES ecoa CORS proprio.
TJES_TARGET = (
    "https://sistemas.tjes.jus.br/consulta-jurisprudencia/api/search"
    "?core=pje2g&q=dano%20moral&page=1&per_page=20"
)


@pytest.mark.network
def test_proxy_forca_allow_origin_wildcard():
    sess = raw_session()
    r = sess.get(
        proxy_url(),
        headers={"X-Target-URL": TJES_TARGET, "X-UA": UA},
        timeout=60,
    )

    # O upstream respondeu de fato (nao e erro do proxy).
    assert r.headers.get("X-Upstream-Status") == "200", (
        f"upstream nao retornou 200: {r.headers.get('X-Upstream-Status')}"
    )
    # O CORS do worker tem que vencer o do upstream.
    assert r.headers.get("Access-Control-Allow-Origin") == "*", (
        f"ACAO devia ser '*', veio {r.headers.get('Access-Control-Allow-Origin')!r} "
        "(o worker copiou o CORS do upstream — ver proxy/worker.js)"
    )
    # Allow-Credentials do upstream nao pode vazar (incompativel com origin '*').
    lower = {k.lower() for k in r.headers.keys()}
    assert "access-control-allow-credentials" not in lower, (
        "Access-Control-Allow-Credentials do upstream vazou pela resposta do proxy"
    )
