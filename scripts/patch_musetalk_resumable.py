#!/usr/bin/env python3
"""Patch MuseTalk inference loop with a session time budget and per-clip done markers."""
from pathlib import Path
import argparse

def patch_text(text: str) -> str:
    if '--max_runtime_seconds' in text and '.done' in text:
        return text
    if 'import time' not in text:
        if 'import os\n' not in text:
            raise ValueError('Cannot locate import os')
        text = text.replace('import os\n', 'import os\nimport time\n', 1)
    loop = '    for task_id in inference_config:\n'
    guarded = (
        '    batch_started = time.monotonic()\n'
        '    for task_id in inference_config:\n'
        '        if args.max_runtime_seconds > 0 and time.monotonic() - batch_started >= args.max_runtime_seconds:\n'
        '            print("Session GPU time budget reached; stopping before the next clip.")\n'
        '            break\n'
    )
    if loop not in text:
        raise ValueError('Cannot locate inference task loop')
    text = text.replace(loop, guarded, 1)
    saved = '            print(f"Results saved to {output_vid_name}")\n'
    marker = (
        '            print(f"Results saved to {output_vid_name}")\n'
        '            if os.path.exists(output_vid_name) and os.path.getsize(output_vid_name) > 10000:\n'
        '                with open(output_vid_name + ".done", "w", encoding="utf-8") as marker_file:\n'
        '                    marker_file.write("ok")\n'
    )
    if saved not in text:
        raise ValueError('Cannot locate successful output message')
    text = text.replace(saved, marker, 1)
    parser = '    parser.add_argument("--output_vid_name", type=str, default=None, help="Name of output video file")\n'
    add = '    parser.add_argument("--max_runtime_seconds", type=int, default=0, help="Stop before the next task after this many seconds")\n' + parser
    if parser not in text:
        raise ValueError('Cannot locate CLI parser insertion point')
    return text.replace(parser, add, 1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inference_py')
    args = ap.parse_args()
    p = Path(args.inference_py)
    original = p.read_text(encoding='utf-8')
    updated = patch_text(original)
    if updated != original:
        p.with_suffix(p.suffix + '.orig').write_text(original, encoding='utf-8')
        p.write_text(updated, encoding='utf-8')
    print('MuseTalk resumable patch applied:', p)

if __name__ == '__main__':
    main()
