#!/usr/bin/env bash
# Рендер секвенции для скролл-плёнки: каждый кадр — своё положение прокрутки.
#   bash render/sequence.sh 36 D:/tmp/cafe-seq 1100 620 56
# Кадры складываются как frame-000.png … frame-NNN.png.
#
# ⚠️ Пока секвенция считается, scene.py править НЕЛЬЗЯ: Blender запускается
# заново на каждый кадр и читает файл с диска, поэтому правка попадёт в
# середину плёнки и кадры перестанут стыковаться. Готовые кадры скрипт
# пропускает — прерванный прогон продолжается той же командой.
set -u
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
FRAMES="${1:-36}"
OUT="${2:-D:/tmp/cafe-seq}"
RX="${3:-1100}"
RY="${4:-620}"
SAMPLES="${5:-56}"

mkdir -p "$OUT"
for ((i = 0; i < FRAMES; i++)); do
  PHASE=$(python -c "print(f'{$i/($FRAMES-1):.4f}')")
  NUM=$(printf "%03d" "$i")
  FILE="$OUT/frame-$NUM.png"
  if [ -f "$FILE" ]; then
    echo "skip $NUM"
    continue
  fi
  "$BLENDER" -b -P render/scene.py -- \
    --phase "$PHASE" --device cpu --out "$FILE" \
    --samples "$SAMPLES" --rx "$RX" --ry "$RY" 2>&1 | grep -E "Saved|Error" | head -1
done
echo "sequence done: $FRAMES frames in $OUT"
