"""Testa cada tribunal/endpoint do app rodando o juscraper PELO PROXY CORS.

Para cada par (tribunal, endpoint) exposto em ``courts_meta.json``, executa uma
busca minima (``pesquisa="dano moral"``, ``paginas=1``) atraves do proxy — o
mesmo caminho de rede do app publicado. Assim, quando um tribunal quebra por
causa do proxy (cookies, TLS, redirect, etc.), o teste correspondente falha e o
diagnostico aponta exatamente qual tribunal e com qual erro.

Politica por status de suporte (definido em scripts/gen_courts_meta.py):
  * ``supported``    -> deve passar; falha = regressao real.
  * ``experimental`` -> roda com xfail(strict=False): falha vira xfail (esperado)
                        e sucesso vira xpass, sem deixar a suite vermelha.
  * ``unsupported``  -> skip (bloqueado de proposito, ex.: captcha).

Rodar:
    .venv/Scripts/python.exe -m pytest tests/ -v
    JUSCRAPER_PROXY_URL=http://localhost:8787 pytest tests/ -v   # wrangler local
"""
from __future__ import annotations

import pytest

import juscraper as jus
from conftest import endpoint_cases

TERMO_BUSCA = "dano moral"

# Tribunais quebrados por causa do PROPRIO tribunal/juscraper (NAO do app/proxy),
# confirmado rodando direto e via proxy com o wheel que o app usa. Marcados xfail
# para o CI ter baseline verde; se recuperarem, viram xpass (visivel). Issues:
KNOWN_BROKEN: dict[tuple[str, str], str] = {
    ("tjrj", "cjsg"): "upstream www3.tjrj.jus.br da HTTP 500 no POST do form "
                      "(jtrecenti/juscraper#278)",
    ("tjap", "cjsg"): "API do TJAP responde 'A verificacao de seguranca falhou' "
                      "(jtrecenti/juscraper#279)",
}


def _case_id(case: tuple[str, str, str]) -> str:
    sigla, endpoint, _status = case
    return f"{sigla}-{endpoint}"


@pytest.mark.network
@pytest.mark.parametrize("case", endpoint_cases(), ids=_case_id)
def test_tribunal_endpoint(case: tuple[str, str, str], request: pytest.FixtureRequest):
    sigla, endpoint, status = case

    if status == "unsupported":
        pytest.skip(f"{sigla} marcado como unsupported em courts_meta.json")
    if status == "experimental":
        request.node.add_marker(
            pytest.mark.xfail(reason=f"{sigla} e experimental (pode falhar pelo proxy)",
                              strict=False)
        )
    broken = KNOWN_BROKEN.get((sigla, endpoint))
    if broken:
        request.node.add_marker(pytest.mark.xfail(reason=broken, strict=False))

    scraper = jus.scraper(sigla)
    df = getattr(scraper, endpoint)(pesquisa=TERMO_BUSCA, paginas=1)

    assert df is not None, f"{sigla}.{endpoint} retornou None"
    assert len(df) > 0, (
        f"{sigla}.{endpoint} nao retornou linhas para '{TERMO_BUSCA}' "
        f"(busca vazia ou pagina nao parseada)"
    )
