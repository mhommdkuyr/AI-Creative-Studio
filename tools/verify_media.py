#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

def probe_and_decode(mp4_path):
    print(f"Verifying '{mp4_path}' with FFprobe and full frame decode...")
    ffprobe_cmd = [
        "ffprobe", "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        mp4_path
    ]
    res = subprocess.run(ffprobe_cmd, capture_output=True, text=True, check=True)
    probe_data = json.loads(res.stdout)

    video_stream = next((s for s in probe_data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in probe_data.get("streams", []) if s.get("codec_type") == "audio"), None)

    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))
    codec_name = video_stream.get("codec_name")

    # Calculate fps from r_frame_rate or avg_frame_rate
    r_fps_str = video_stream.get("r_frame_rate", "60/1")
    num, den = map(float, r_fps_str.split("/"))
    fps = num / den if den > 0 else 60.0

    duration = float(probe_data.get("format", {}).get("duration", 0))
    nb_frames = int(video_stream.get("nb_frames", int(fps * duration)))

    # Full frame decode test using ffmpeg null output
    decode_cmd = [
        "ffmpeg", "-v", "error",
        "-i", mp4_path,
        "-f", "null", "-"
    ]
    decode_res = subprocess.run(decode_cmd, capture_output=True, text=True)
    decode_passed = (decode_res.returncode == 0)

    report = {
        "filepath": mp4_path,
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "nb_frames": nb_frames,
        "video_codec": codec_name,
        "audio_codec": audio_stream.get("codec_name") if audio_stream else None,
        "audio_channels": int(audio_stream.get("channels", 0)) if audio_stream else 0,
        "audio_sample_rate": int(audio_stream.get("sample_rate", 0)) if audio_stream else 0,
        "decode_verified": decode_passed,
        "full_decode_error": decode_res.stderr.strip() if not decode_passed else None
    }
    return report

def generate_contact_sheet(mp4_path, output_png, num_samples=12, grid_cols=4):
    print(f"Generating contact sheet '{output_png}' from '{mp4_path}'...")
    temp_frames_dir = f"/tmp/contact_sheet_frames_{os.getpid()}"
    os.makedirs(temp_frames_dir, exist_ok=True)

    # Extract 12 keyframes evenly spaced across duration
    probe_res = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mp4_path], capture_output=True, text=True)
    duration = float(probe_res.stdout.strip() or 10.0)

    timestamps = [min(duration - 0.05, duration * i / (num_samples - 1)) for i in range(num_samples)]
    extracted_imgs = []

    for idx, ts in enumerate(timestamps):
        out_img = os.path.join(temp_frames_dir, f"sample_{idx:02d}.png")
        cmd = [
            "ffmpeg", "-y", "-ss", f"{ts:.3f}",
            "-i", mp4_path,
            "-vframes", "1",
            "-s", "480x270",
            out_img
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        extracted_imgs.append((out_img, ts))

    grid_rows = (num_samples + grid_cols - 1) // grid_cols
    thumb_w, thumb_h = 480, 270
    padding = 10
    header_h = 60

    sheet_w = grid_cols * thumb_w + (grid_cols + 1) * padding
    sheet_h = header_h + grid_rows * thumb_h + (grid_rows + 1) * padding

    contact_img = Image.new("RGB", (sheet_w, sheet_h), (18, 24, 38))
    draw = ImageDraw.Draw(contact_img)

    # Header
    draw.text((padding, 15), f"Contact Sheet: {os.path.basename(mp4_path)} | 1920x1080 @ 60 FPS", fill=(255, 255, 255))

    for idx, (img_p, ts) in enumerate(extracted_imgs):
        r = idx // grid_cols
        c = idx % grid_cols
        x = padding + c * (thumb_w + padding)
        y = header_h + padding + r * (thumb_h + padding)

        thumb = Image.open(img_p)
        contact_img.paste(thumb, (x, y))

        # Time label overlay
        label = f"t = {ts:.2f}s (f={int(ts*60)})"
        draw.rectangle([x, y + thumb_h - 24, x + 160, y + thumb_h], fill=(0, 0, 0))
        draw.text((x + 6, y + thumb_h - 20), label, fill=(234, 179, 8))

    contact_img.save(output_png)
    print(f"Saved contact sheet: {output_png}")

if __name__ == "__main__":
    mp4_file = sys.argv[1] if len(sys.argv) > 1 else "output/anime-fight-full-1080p60.mp4"
    report = probe_and_decode(mp4_file)
    print(json.dumps(report, indent=2))

    with open("output/ffprobe-verification.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    generate_contact_sheet(mp4_file, "output/contact-sheet.png")
