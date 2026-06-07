"""Fixtures compartilhadas dos testes de tribunais.

Instala o roteamento pelo proxy CORS uma unica vez por sessao (igual ao app
publicado) e expoe a lista de (tribunal, endpoint) lida do mesmo
``courts_meta.json`` que alimenta o front — garantindo que testamos exatamente o
que o app oferece.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from proxy_session import install, proxy_url

REPO_ROOT = Path(__file__).resolve().parent.parent
COURTS_META = REPO_ROOT / "web" / "src" / "data" / "courts_meta.json"


def load_courts() -> list[dict]:
    data = json.loads(COURTS_META.read_text(encoding="utf-8"))
    return data["courts"]


def endpoint_cases() -> list[tuple[str, str, str]]:
    """(sigla, endpoint, status) para cada par tribunal/endpoint do app."""
    cases: list[tuple[str, str, str]] = []
    for court in load_courts():
        status = court.get("support", {}).get("status", "supported")
        for endpoint in court["endpoints"]:
            cases.append((court["sigla"], endpoint, status))
    return cases


@pytest.fixture(scope="session", autouse=True)
def _proxy():
    """Roteia todo o `requests` pelo proxy CORS antes de qualquer teste."""
    url = install()
    print(f"\n[tribunais] proxy = {url}")
    return url


@pytest.fixture(scope="session")
def proxy():
    return proxy_url()
