#!/usr/bin/env bash
set -euo pipefail
# MuseTalk v1.5 only. Deliberately skip v1.0 and optional SyncNet weights.
ROOT="${MUSETALK_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
mkdir -p models/musetalkV15 models/sd-vae models/whisper models/dwpose models/face-parse-bisent
export HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"

huggingface-cli download TMElyralab/MuseTalk   --local-dir models   --include "musetalkV15/musetalk.json" "musetalkV15/unet.pth"

huggingface-cli download stabilityai/sd-vae-ft-mse   --local-dir models/sd-vae   --include "config.json" "diffusion_pytorch_model.bin"

huggingface-cli download openai/whisper-tiny   --local-dir models/whisper   --include "config.json" "pytorch_model.bin" "preprocessor_config.json"

huggingface-cli download yzd-v/DWPose   --local-dir models/dwpose   --include "dw-ll_ucoco_384.pth"

gdown 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O models/face-parse-bisent/79999_iter.pth
curl -L --fail --retry 3 https://download.pytorch.org/models/resnet18-5c106cde.pth -o models/face-parse-bisent/resnet18-5c106cde.pth

echo "MuseTalk v1.5 minimal inference weights are ready."
