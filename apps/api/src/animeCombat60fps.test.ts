import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("60 FPS Anime Combat Manifest & Output Metadata", () => {
  const rootDir = process.cwd().endsWith("apps/api") ? resolve(process.cwd(), "../..") : process.cwd();
  const docManifestPath = resolve(rootDir, "docs", "episodes", "fight-manifest-1080p60.json");
  const outputManifestPath = resolve(rootDir, "output", "fight-manifest-1080p60.json");
  const manifestPath = existsSync(docManifestPath) ? docManifestPath : outputManifestPath;
  const ffprobePath = resolve(rootDir, "output", "ffprobe-verification.json");
  const driveReportPath = resolve(rootDir, "output", "google-drive-import-status.json");

  it("validates fight manifest format, resolution, 60 FPS target, and frame count", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.resolution).toEqual([1920, 1080]);
    expect(manifest.fps).toBe(60);
    expect(manifest.durationSeconds).toBe(10.0);
    expect(manifest.totalFrames).toBe(600);

    expect(manifest.characters).toHaveProperty("characterA");
    expect(manifest.characters).toHaveProperty("characterB");
    expect(manifest.characters.characterA.name).toBe("Nightshade J Friedrich");
    expect(manifest.characters.characterB.name).toBe("Prisoner B Styperek");

    expect(Array.isArray(manifest.shots)).toBe(true);
    expect(manifest.shots.length).toBeGreaterThanOrEqual(2);

    for (const shot of manifest.shots) {
      expect(shot).toHaveProperty("id");
      expect(shot).toHaveProperty("startTime");
      expect(shot).toHaveProperty("duration");
      expect(Array.isArray(shot.keyframes)).toBe(true);
      expect(Array.isArray(shot.effectEvents)).toBe(true);
      expect(Array.isArray(shot.audioCues)).toBe(true);
    }
  });

  it("validates FFprobe output verification metadata for true 60 FPS and 1080p H.264/AAC video", () => {
    expect(existsSync(ffprobePath)).toBe(true);
    const report = JSON.parse(readFileSync(ffprobePath, "utf-8"));

    expect(report.width).toBe(1920);
    expect(report.height).toBe(1080);
    expect(report.fps).toBe(60.0);
    expect(report.duration).toBeCloseTo(10.0, 1);
    expect(report.nb_frames).toBe(600);
    expect(report.video_codec).toBe("h264");
    expect(report.audio_codec).toBe("aac");
    expect(report.decode_verified).toBe(true);
  });

  it("validates Google Drive import status report and blocker transparency", () => {
    expect(existsSync(driveReportPath)).toBe(true);
    const driveReport = JSON.parse(readFileSync(driveReportPath, "utf-8"));

    expect(driveReport).toHaveProperty("token_configured");
    expect(driveReport).toHaveProperty("files");
    expect(driveReport).toHaveProperty("blockers");
    expect(Array.isArray(driveReport.blockers)).toBe(true);
  });
});
