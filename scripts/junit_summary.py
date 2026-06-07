"""Converte um JUnit XML do pytest numa tabela markdown por tribunal/endpoint.

Usado pelo workflow ``test-tribunais.yml`` para escrever um resumo legivel no
``$GITHUB_STEP_SUMMARY`` a cada execucao, independentemente do exit code.

Uso:
    python scripts/junit_summary.py report.xml          # imprime no stdout
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# (emoji, rotulo) por estado derivado do testcase JUnit.
STATES = {
    "pass": ("✅", "OK"),
    "fail": ("❌", "FALHOU"),
    "error": ("❌", "ERRO"),
    "skip": ("⏭️", "pulado"),
    "xfail": ("⚠️", "xfail (esperado)"),
    "xpass": ("✅", "xpass"),
}


def _state(case: ET.Element) -> str:
    if case.find("failure") is not None:
        return "fail"
    if case.find("error") is not None:
        return "error"
    skip = case.find("skipped")
    if skip is not None:
        # pytest marca xfail como <skipped type="pytest.xfail">.
        return "xfail" if (skip.get("type") or "").endswith("xfail") else "skip"
    return "pass"


def _tribunal(case: ET.Element) -> str:
    """Extrai o id legivel (ex.: 'tjes-cjsg') do nome do caso parametrizado."""
    name = case.get("name", "")
    if "[" in name and "]" in name:
        return name[name.index("[") + 1 : name.rindex("]")]
    return name


def main(path: str) -> int:
    # GitHub Actions (Linux) e UTF-8; no Windows o console e cp1252 e quebraria
    # nos emojis. Forca UTF-8 quando possivel.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    xml = Path(path)
    if not xml.exists():
        print(f"> Relatorio nao encontrado: {path}")
        return 0

    root = ET.parse(xml).getroot()
    cases = root.iter("testcase")

    rows: list[tuple[str, str, str]] = []
    counts = {k: 0 for k in STATES}
    for case in cases:
        state = _state(case)
        # xpass aparece como pass com propriedade; JUnit do pytest nao distingue
        # bem, entao tratamos pass que veio de teste xfail como pass normal.
        emoji, label = STATES[state]
        msg = ""
        node = case.find("failure")
        if node is None:
            node = case.find("error")
        if node is not None:
            msg = (node.get("message") or "").splitlines()[0][:160]
        rows.append((_tribunal(case), f"{emoji} {label}", msg))
        counts[state] += 1

    rows.sort()

    lines = ["## Status dos tribunais (via proxy)", ""]
    total = sum(counts.values())
    resumo = (
        f"**{counts['pass']}** OK · **{counts['fail'] + counts['error']}** falhas · "
        f"**{counts['xfail']}** xfail · **{counts['skip']}** pulados · {total} no total"
    )
    lines += [resumo, "", "| Tribunal/Endpoint | Status | Detalhe |", "|---|---|---|"]
    for trib, status, msg in rows:
        lines.append(f"| `{trib}` | {status} | {msg} |")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "report.xml"))
