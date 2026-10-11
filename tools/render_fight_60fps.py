#!/usr/bin/env python3
import os
import sys
import math
import json
import random
import shutil
import subprocess
import wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np

WIDTH = 1920
HEIGHT = 1080
FPS = 60
SAMPLE_RATE = 44100

def lerp(a, b, t):
    return a + (b - a) * t

def clamp(v, min_v, max_v):
    return max(min_v, min(max_v, v))

def draw_background(draw, width, height, frame, total_frames, camera_pan_x, camera_pan_y, camera_zoom):
    # Dark stormy night sky gradient
    for y in range(0, height, 4):
        t = y / height
        r = int(lerp(10, 25, t))
        g = int(lerp(12, 30, t))
        b = int(lerp(35, 65, t))
        draw.rectangle([0, y, width, y + 4], fill=(r, g, b))

    # Distant glowing city skyscrapers
    random.seed(101)
    skyline_y = int(height * 0.65 + camera_pan_y * 0.2)
    for i in range(18):
        bx = int(i * (width / 15) - 100 + camera_pan_x * 0.3)
        bw = random.randint(70, 140)
        bh = random.randint(150, 380)
        by = skyline_y - bh
        draw.rectangle([bx, by, bx + bw, skyline_y], fill=(15, 20, 42))
        # Building lights
        for lx in range(bx + 10, bx + bw - 10, 20):
            for ly in range(by + 15, skyline_y - 20, 30):
                if random.random() > 0.4:
                    draw.rectangle([lx, ly, lx + 8, ly + 12], fill=(234, 179, 8, 180))

    # Arena ground floor
    ground_top = int(height * 0.68 + camera_pan_y)
    draw.rectangle([0, ground_top, width, height], fill=(20, 24, 38))
    # Grid perspective lines
    center_x = width // 2 + int(camera_pan_x)
    for x_offset in range(-2000, 2000, 120):
        gx = center_x + int(x_offset * camera_zoom)
        draw.line([(gx, ground_top), (gx * 1.5 - width * 0.25, height)], fill=(45, 55, 85), width=2)
    for gy in range(ground_top, height, 35):
        draw.line([(0, gy), (width, gy)], fill=(40, 50, 75), width=1)

def draw_aura(image, draw, x, y, radius, color_hex, pulse):
    # Draw radial glowing aura
    color_rgb = tuple(int(color_hex.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
    r = int(radius * (1.0 + 0.15 * math.sin(pulse)))
    aura_img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    aura_draw = ImageDraw.Draw(aura_img)
    for i in range(r, 0, -12):
        alpha = int(lerp(120, 10, i / r))
        aura_draw.ellipse([x - i, y - i, x + i, y + i], fill=(*color_rgb, alpha))
    image.alpha_composite(aura_img)

def draw_speed_lines(draw, width, height, center_x, center_y, intensity):
    if intensity <= 0:
        return
    num_lines = int(40 * intensity)
    for i in range(num_lines):
        angle = random.uniform(0, 2 * math.pi)
        r1 = random.uniform(250, 500)
        r2 = random.uniform(800, 1300)
        x1 = center_x + math.cos(angle) * r1
        y1 = center_y + math.sin(angle) * r1
        x2 = center_x + math.cos(angle) * r2
        y2 = center_y + math.sin(angle) * r2
        w = random.randint(2, 6)
        alpha = int(random.uniform(100, 220) * intensity)
        draw.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, alpha), width=w)

def draw_character_nightshade(draw, x, y, scale, pose, rotation):
    # Nightshade J Friedrich: Sleek dark hooded assassin with dual violet blades
    s = scale
    cx, cy = x, y

    # Shadow Cloak
    cloak_pts = [
        (cx - 35 * s, cy - 60 * s),
        (cx + 35 * s, cy - 60 * s),
        (cx + 65 * s, cy + 90 * s),
        (cx - 65 * s, cy + 90 * s)
    ]
    draw.polygon(cloak_pts, fill=(30, 27, 75), outline=(139, 92, 246), width=int(3 * s))

    # Inner suit / Torso
    draw.rectangle([cx - 20 * s, cy - 50 * s, cx + 20 * s, cy + 40 * s], fill=(15, 15, 25))

    # Hood & Mask
    draw.ellipse([cx - 22 * s, cy - 100 * s, cx + 22 * s, cy - 56 * s], fill=(30, 27, 75), outline=(139, 92, 246), width=int(2 * s))
    # Glowing eyes
    draw.ellipse([cx - 10 * s, cy - 82 * s, cx - 3 * s, cy - 76 * s], fill=(192, 132, 252))
    draw.ellipse([cx + 3 * s, cy - 82 * s, cx + 10 * s, cy - 76 * s], fill=(192, 132, 252))

    # Dual Shadow Blades
    if "strike" in pose or "slash" in pose or "blade" in pose:
        # Extended blades with energy glow
        draw.line([(cx - 25 * s, cy - 20 * s), (cx - 120 * s, cy - 80 * s)], fill=(168, 85, 247), width=int(8 * s))
        draw.line([(cx + 25 * s, cy - 20 * s), (cx + 120 * s, cy - 80 * s)], fill=(168, 85, 247), width=int(8 * s))
        draw.line([(cx - 25 * s, cy - 20 * s), (cx - 120 * s, cy - 80 * s)], fill=(255, 255, 255), width=int(3 * s))
        draw.line([(cx + 25 * s, cy - 20 * s), (cx + 120 * s, cy - 80 * s)], fill=(255, 255, 255), width=int(3 * s))
    else:
        # Sheathed / Guard blades
        draw.line([(cx - 20 * s, cy), (cx - 60 * s, cy - 40 * s)], fill=(139, 92, 246), width=int(5 * s))
        draw.line([(cx + 20 * s, cy), (cx + 60 * s, cy - 40 * s)], fill=(139, 92, 246), width=int(5 * s))

def draw_character_prisoner_b(draw, x, y, scale, pose, rotation):
    # Prisoner B Styperek: Heavy armored gladiator with crimson gauntlets
    s = scale
    cx, cy = x, y

    # Heavy armor torso & pauldrons
    draw.polygon([
        (cx - 50 * s, cy - 65 * s),
        (cx + 50 * s, cy - 65 * s),
        (cx + 40 * s, cy + 50 * s),
        (cx - 40 * s, cy + 50 * s)
    ], fill=(69, 10, 10), outline=(239, 68, 68), width=int(4 * s))

    # Pauldrons / Shoulders
    draw.ellipse([cx - 75 * s, cy - 75 * s, cx - 35 * s, cy - 35 * s], fill=(127, 29, 29), outline=(220, 38, 38), width=int(3 * s))
    draw.ellipse([cx + 35 * s, cy - 75 * s, cx + 75 * s, cy - 35 * s], fill=(127, 29, 29), outline=(220, 38, 38), width=int(3 * s))

    # Head / Helmet
    draw.rectangle([cx - 20 * s, cy - 105 * s, cx + 20 * s, cy - 65 * s], fill=(25, 10, 10), outline=(220, 38, 38), width=int(2 * s))
    # Crimson visor slit
    draw.rectangle([cx - 14 * s, cy - 92 * s, cx + 14 * s, cy - 86 * s], fill=(248, 113, 113))

    # Iron Crimson Gauntlets
    if "strike" in pose or "block" in pose or "hook" in pose or "slam" in pose:
        draw.ellipse([cx - 85 * s, cy - 30 * s, cx - 45 * s, cy + 10 * s], fill=(220, 38, 38), outline=(255, 255, 255), width=int(3 * s))
        draw.ellipse([cx + 45 * s, cy - 30 * s, cx + 85 * s, cy + 10 * s], fill=(220, 38, 38), outline=(255, 255, 255), width=int(3 * s))
    else:
        draw.rectangle([cx - 45 * s, cy + 10 * s, cx - 25 * s, cy + 60 * s], fill=(127, 29, 29))
        draw.rectangle([cx + 25 * s, cy + 10 * s, cx + 45 * s, cy + 60 * s], fill=(127, 29, 29))

def generate_audio(output_wav, duration_sec):
    num_samples = int(SAMPLE_RATE * duration_sec)
    audio = np.zeros((num_samples, 2), dtype=np.float32)
    t = np.linspace(0, duration_sec, num_samples, endpoint=False)

    # Ambient low fight drone
    drone = 0.15 * np.sin(2 * np.pi * 55.0 * t) + 0.08 * np.sin(2 * np.pi * 110.0 * t)
    audio[:, 0] += drone
    audio[:, 1] += drone

    # Key impact timings (in seconds)
    impact_times = [2.5, 3.2, 5.2, 5.4, 6.2, 7.6, 8.0]
    for it in impact_times:
        if it < duration_sec:
            idx = int(it * SAMPLE_RATE)
            length = int(0.25 * SAMPLE_RATE)
            end_idx = min(num_samples, idx + length)
            imp_t = np.linspace(0, (end_idx - idx) / SAMPLE_RATE, end_idx - idx)
            # High punch impact transient + low explosion thud
            impact_wave = 0.6 * np.exp(-imp_t * 20.0) * np.sin(2 * np.pi * (150.0 - 100.0 * imp_t) * imp_t)
            noise = 0.2 * np.exp(-imp_t * 30.0) * np.random.uniform(-1.0, 1.0, end_idx - idx)
            audio[idx:end_idx, 0] += impact_wave + noise
            audio[idx:end_idx, 1] += impact_wave + noise

    # Normalize audio
    max_val = np.max(np.abs(audio))
    if max_val > 0:
        audio = (audio / max_val) * 0.95

    # Write WAV file
    audio_int16 = (audio * 32767).astype(np.int16)
    with wave.open(output_wav, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_int16.tobytes())
    print(f"Generated WAV audio: {output_wav}")

def render_sequence(manifest_path, output_mp4, duration_limit=None):
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    duration = manifest["durationSeconds"] if duration_limit is None else min(manifest["durationSeconds"], duration_limit)
    total_frames = int(FPS * duration)
    temp_dir = Path("/tmp") / f"frames_temp_{Path(output_mp4).stem}"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    print(f"Rendering '{output_mp4}' ({total_frames} frames @ {FPS} FPS, 1920x1080)...")

    shots = manifest["shots"]

    for frame_idx in range(total_frames):
        current_time = frame_idx / FPS

        # Find active shot
        active_shot = shots[0]
        for s in shots:
            if s["startTime"] <= current_time < s["startTime"] + s["duration"]:
                active_shot = s
                break

        # Calculate camera transform and character keyframe interpolation
        cam_info = active_shot.get("camera", {})
        shake_intensity = cam_info.get("shakeIntensity", 0.0)
        camera_shake_x = random.uniform(-shake_intensity, shake_intensity) if shake_intensity > 0 else 0
        camera_shake_y = random.uniform(-shake_intensity, shake_intensity) if shake_intensity > 0 else 0
        camera_pan_x = cam_info.get("panX", 0) + camera_shake_x
        camera_pan_y = cam_info.get("panY", 0) + camera_shake_y
        camera_zoom = cam_info.get("zoom", 1.0)

        # Interpolate keyframes in active shot
        kfs = active_shot.get("keyframes", [])
        char_a_state = {"x": 400, "y": 700, "scale": 1.0, "pose": "guard_stand", "rotation": 0}
        char_b_state = {"x": 1520, "y": 700, "scale": 1.0, "pose": "heavy_stance", "rotation": 0}

        if len(kfs) >= 2:
            # Find boundary keyframes
            k1 = kfs[0]
            k2 = kfs[-1]
            for i in range(len(kfs) - 1):
                if kfs[i]["time"] <= current_time <= kfs[i+1]["time"]:
                    k1 = kfs[i]
                    k2 = kfs[i+1]
                    break
            t_rel = 0.0 if k2["time"] == k1["time"] else (current_time - k1["time"]) / (k2["time"] - k1["time"])
            t_rel = clamp(t_rel, 0.0, 1.0)

            cA1, cA2 = k1["characterA"], k2["characterA"]
            char_a_state = {
                "x": lerp(cA1["x"], cA2["x"], t_rel) + camera_pan_x,
                "y": lerp(cA1["y"], cA2["y"], t_rel) + camera_pan_y,
                "scale": lerp(cA1["scale"], cA2["scale"], t_rel) * camera_zoom,
                "pose": cA1["pose"] if t_rel < 0.5 else cA2["pose"],
                "rotation": lerp(cA1["rotation"], cA2["rotation"], t_rel)
            }

            cB1, cB2 = k1["characterB"], k2["characterB"]
            char_b_state = {
                "x": lerp(cB1["x"], cB2["x"], t_rel) + camera_pan_x,
                "y": lerp(cB1["y"], cB2["y"], t_rel) + camera_pan_y,
                "scale": lerp(cB1["scale"], cB2["scale"], t_rel) * camera_zoom,
                "pose": cB1["pose"] if t_rel < 0.5 else cB2["pose"],
                "rotation": lerp(cB1["rotation"], cB2["rotation"], t_rel)
            }

        # Check impact frame requirement
        is_impact_frame = False
        impact_mode = None
        for evt in active_shot.get("effectEvents", []):
            if evt.get("type") == "impact_frame":
                evt_frame = evt.get("frame", 0)
                dur = evt.get("durationFrames", 3)
                if evt_frame <= frame_idx < evt_frame + dur:
                    is_impact_frame = True
                    impact_mode = evt.get("mode", "black_white_invert")
                    break

        # Render frame image
        img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 255))
        draw = ImageDraw.Draw(img)

        draw_background(draw, WIDTH, HEIGHT, frame_idx, total_frames, camera_pan_x, camera_pan_y, camera_zoom)

        # Draw Auras
        draw_aura(img, draw, char_a_state["x"], char_a_state["y"], 130 * char_a_state["scale"], "#8B5CF6", frame_idx * 0.2)
        draw_aura(img, draw, char_b_state["x"], char_b_state["y"], 140 * char_b_state["scale"], "#EF4444", frame_idx * 0.2)

        # Draw Characters
        draw_character_nightshade(draw, char_a_state["x"], char_a_state["y"], char_a_state["scale"], char_a_state["pose"], char_a_state["rotation"])
        draw_character_prisoner_b(draw, char_b_state["x"], char_b_state["y"], char_b_state["scale"], char_b_state["pose"], char_b_state["rotation"])

        # Speed lines
        if 2.4 <= current_time <= 3.5 or 7.4 <= current_time <= 8.2:
            draw_speed_lines(draw, WIDTH, HEIGHT, WIDTH // 2, HEIGHT // 2, 0.8)

        # Impact frame effect handling
        if is_impact_frame:
            if impact_mode == "black_white_invert":
                # High-contrast black and white inversion
                img_rgb = img.convert("RGB")
                img_inverted = ImageOps.invert(img_rgb)
                img = img_inverted.convert("RGBA")

        frame_path = temp_dir / f"frame_{frame_idx:05d}.png"
        img.save(frame_path)

    # Generate synchronized WAV audio
    wav_path = temp_dir / "audio.wav"
    generate_audio(str(wav_path), duration)

    # Encode MP4 using FFmpeg
    cmd = [
        "ffmpeg", "-y",
        "-framerate", "60",
        "-i", str(temp_dir / "frame_%05d.png"),
        "-i", str(wav_path),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-r", "60",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_mp4
    ]
    subprocess.run(cmd, check=True)
    print(f"Successfully rendered: {output_mp4}")

    # Clean up temp frames directory
    shutil.rmtree(temp_dir)

if __name__ == "__main__":
    manifest_file = "docs/episodes/fight-manifest-1080p60.json" if os.path.exists("docs/episodes/fight-manifest-1080p60.json") else "output/fight-manifest-1080p60.json"

    # 1. Proof of concept (5 seconds)
    poc_mp4 = "output/anime-fight-poc-preview.mp4"
    render_sequence(manifest_file, poc_mp4, duration_limit=5.0)

    # 2. Full video (10 seconds)
    full_mp4 = "output/anime-fight-full-1080p60.mp4"
    render_sequence(manifest_file, full_mp4, duration_limit=10.0)
