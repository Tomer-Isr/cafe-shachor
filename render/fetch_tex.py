# -*- coding: utf-8 -*-
"""
Качает PBR-карты сцены с Poly Haven (CC0). Запуск:

  python render/fetch_tex.py            # только то, чего не хватает
  python render/fetch_tex.py --all      # включая отбракованные варианты
  python render/fetch_tex.py --force    # перекачать поверх

Зачем скрипт: карты в 4096 px весят десятки мегабайт каждая, и держать их в
репозитории — значит тащить сотню мегабайт при каждом клоне ради файлов,
которые лежат в открытом доступе. В git остаются только имена и параметры;
сами карты приезжают этой командой.

Имена ассетов Poly Haven → префиксы, которыми их зовёт scene.py.
"""
import json
import os
import sys
import urllib.request

TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "tex")
API = "https://api.polyhaven.com/files/{}"
# Poly Haven отдаёт файлы только с обычным User-Agent: без него CDN отвечает 403.
UA = {"User-Agent": "Mozilla/5.0 (cafe-shachor asset fetcher)"}

# Что сейчас стоит в сцене.
IN_USE = {
    "granular_concrete": "granular",   # камень стойки: ровное мелкое зерно без швов
    "plastered_stone_wall": "plastered",  # стена: тёмная штукатурка по камню
}
# Варианты, которые смотрели и не взяли. Держим список, чтобы вернуться к
# сравнению одной командой, а не искать заново по каталогу.
REJECTED = {
    "granite_tile_03": "granite",            # рыжий, и швы плит читаются кафелем
    "concrete_floor_worn_001": "concrete",   # чистый, но фактуры почти нет
    "sandstone_blocks_04": "sandstone",      # тёсаный песчаник, уводит фон в бежевый
    "medieval_wall_01": "whitewash",         # побелка, самый светлый фон
}
MAPS = (("Diffuse", "diff"), ("Rough", "rough"), ("nor_gl", "nor"))


def fetch(asset, prefix, force=False):
    meta = json.load(urllib.request.urlopen(urllib.request.Request(API.format(asset), headers=UA)))
    for key, suffix in MAPS:
        out = os.path.join(TEX_DIR, f"{prefix}_{suffix}.jpg")
        if os.path.exists(out) and not force:
            print(f"  {prefix}_{suffix}: уже есть")
            continue
        res = meta[key].get("4k") or meta[key].get("2k")
        req = urllib.request.Request(res["jpg"]["url"], headers=UA)
        with urllib.request.urlopen(req) as src, open(out, "wb") as dst:
            dst.write(src.read())
        print(f"  {prefix}_{suffix}: {os.path.getsize(out) // 1024} КБ")


os.makedirs(TEX_DIR, exist_ok=True)
force = "--force" in sys.argv
wanted = dict(IN_USE)
if "--all" in sys.argv:
    wanted.update(REJECTED)

for asset, prefix in wanted.items():
    print(f"{asset} → {prefix}")
    fetch(asset, prefix, force)
