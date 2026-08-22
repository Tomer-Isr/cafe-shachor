"""
Скачать шрифты к себе и собрать src/fonts.css.

Гарнитуры берутся из Google Fonts, но отдаются со своего домена: сторонний CDN
в CSP — лишняя связь, а на первой отрисовке ещё и лишний коннект. Файлы кладутся
в public/fonts, правила — в src/fonts.css.

    python scripts/fetch_fonts.py

Состав и обоснование — DESIGN-SYSTEM §2.2. Здесь только механика.
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "public" / "fonts"
CSS_OUT = ROOT / "src" / "fonts.css"

# Без него Google отдаёт ttf вместо woff2.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Греческий и вьетнамский не грузим: на сайте их нет, а вес есть.
KEEP_SUBSETS = {"hebrew", "latin", "latin-ext", "cyrillic"}

FAMILIES = [
    # (запрос к API, короткое имя файла, зачем)
    ("Suez+One", "suez-one", "вордмарк, четыре глифы"),
    ("Frank+Ruhl+Libre:wght@300..900", "frank-ruhl", "дисплей HE/EN"),
    ("Cormorant+Garamond:ital,wght@0,300..700;1,300..700", "cormorant", "дисплей RU"),
    ("Miriam+Libre:wght@400;700", "miriam", "корпус HE/EN"),
    ("Commissioner:wght@200..700", "commissioner", "корпус RU"),
    ("IBM+Plex+Mono:wght@400;500", "plex-mono", "метки, цифры, цены"),
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    blocks: list[str] = [
        "/*",
        " * Шрифты со своего домена. Файл собран scripts/fetch_fonts.py — руками не править,",
        " * состав и обоснование гарнитур: docs/DESIGN-SYSTEM.md §2.2.",
        " */",
        "",
    ]
    total = 0

    for query, slug, note in FAMILIES:
        css = fetch(f"https://fonts.googleapis.com/css2?family={query}&display=swap").decode("utf-8")
        blocks.append(f"/* {slug} — {note} */")

        # Куски CSS идут как: /* subset */ @font-face { ... }
        chunks = re.split(r"/\*\s*([a-z-]+)\s*\*/", css)
        kept = 0
        for i in range(1, len(chunks) - 1, 2):
            subset, body = chunks[i], chunks[i + 1]
            if subset not in KEEP_SUBSETS:
                continue
            url_match = re.search(r"url\((https://[^)]+\.woff2)\)", body)
            if not url_match:
                continue

            style = "italic" if "font-style: italic" in body else "normal"
            weight = re.search(r"font-weight:\s*([^;]+);", body)
            weight_val = weight.group(1).strip() if weight else "400"
            name = f"{slug}-{subset}-{weight_val.replace(' ', '-')}-{style}.woff2"
            path = FONT_DIR / name

            if not path.exists():
                path.write_bytes(fetch(url_match.group(1)))
            size = path.stat().st_size
            total += size
            kept += 1

            family = re.search(r"font-family:\s*'([^']+)'", body).group(1)
            unicode_range = re.search(r"unicode-range:\s*([^;]+);", body)
            rule = [
                "@font-face {",
                f"  font-family: '{family}';",
                f"  font-style: {style};",
                f"  font-weight: {weight_val};",
                "  font-display: swap;",
                f"  src: url('/fonts/{name}') format('woff2');",
            ]
            if unicode_range:
                rule.append(f"  unicode-range: {unicode_range.group(1).strip()};")
            rule.append("}")
            blocks.append("\n".join(rule))

        print(f"{slug:14} {kept} файл(ов)  ·  {note}")
        blocks.append("")

    CSS_OUT.write_text("\n".join(blocks), encoding="utf-8")
    print(f"\n{CSS_OUT.relative_to(ROOT)} собран · всего {total // 1024} КБ в public/fonts")
    print("Не забыть: в index.html убрать ссылки на fonts.googleapis.com и снять их из CSP.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
