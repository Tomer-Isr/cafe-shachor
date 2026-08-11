# -*- coding: utf-8 -*-
"""Текстура печати по боку чашки: ивритский вордмарк плюс латинская подпись.

Печать по керамике никогда не лежит ровным слоем — обжиг съедает краску пятнами,
поэтому альфа выедается шумом. Ровная надпись читается наклейкой, а не глазурью.

  python render/make_decal.py
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, random, math

W, H = 1500, 512
OUT = os.path.join(os.path.dirname(__file__), "assets", "decal.png")

HEB = "שחור"          # PIL сам раскладывает иврит справа налево — разворачивать строку НЕ нужно
LAT = "SHACHOR · JAFFA"

FONT_HEB = "C:/Windows/Fonts/frank.ttf"   # Frank Ruhl — шрифт бренда
FONT_LAT = "C:/Windows/Fonts/arial.ttf"

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

heb = ImageFont.truetype(FONT_HEB, 300)
lat = ImageFont.truetype(FONT_LAT, 46)

ink = (232, 226, 214)  # печать светлее глазури: тёмное по тёмному не читается

# вордмарк
text = HEB
bbox = d.textbbox((0, 0), text, font=heb)
d.text(((W - (bbox[2] - bbox[0])) / 2 - bbox[0], H * 0.34 - (bbox[3] - bbox[1]) / 2 - bbox[1]),
       text, font=heb, fill=ink + (255,))

# латинская строка вразрядку
sp = 10
total = sum(d.textlength(ch, font=lat) + sp for ch in LAT) - sp
x = (W - total) / 2
y = H * 0.58
for ch in LAT:
    d.text((x, y), ch, font=lat, fill=ink + (215,))
    x += d.textlength(ch, font=lat) + sp

# выедание обжигом: рваная альфа вместо ровной заливки
random.seed(7)
noise = Image.new("L", (max(4, W // 8), H // 8))
np_ = noise.load()
for j in range(noise.size[1]):
    for i in range(noise.size[0]):
        np_[i, j] = random.randint(0, 255)
noise = noise.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))

a = img.getchannel("A").load()
nl = noise.load()
for j in range(H):
    for i in range(W):
        if a[i, j]:
            k = nl[i, j] / 255.0
            eaten = 0.5 + 0.5 * min(1.0, max(0.0, (k - 0.32) / 0.3))
            a[i, j] = int(a[i, j] * eaten)

# На выпуклой стенке текстура читается с обратной стороны, поэтому зеркалим
# её здесь: так надпись остаётся правильной независимо от знака UV в нодах.
img = img.transpose(Image.FLIP_LEFT_RIGHT)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT)
print("saved", OUT, img.size)
