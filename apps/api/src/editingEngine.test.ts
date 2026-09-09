import { describe, expect, it } from 'vitest';
import { applyOperations } from './editingEngine.js';

describe('editing engine', () => {
  it('executes a compound editing plan deterministically', () => {
    const timeline = {
      version: 2,
      duration: 10,
      currentTime: 0,
      tracks: [{ id: 'v1', name: 'Video 1', type: 'video', clips: [{ id: 'c1', name: 'source.mp4', startTime: 0, endTime: 10, trimStart: 0, trimEnd: 10, duration: 10, speed: 1, opacity: 1, effects: [], animations: [], keyframes: [] }] }],
      markers: [],
    };

    const next = applyOperations(timeline, [
      { op: 'trim_clip', clipId: 'c1', trimStart: 2, trimEnd: 8 },
      { op: 'set_speed', clipId: 'c1', speed: 2 },
      { op: 'set_volume', clipId: 'c1', volume: 0.7 },
      { op: 'transform', clipId: 'c1', scaleX: 1.1, scaleY: 1.1, rotation: 4 },
      { op: 'add_effect', clipId: 'c1', effect: 'blur', params: { amount: 0.2 } },
      { op: 'set_keyframe', clipId: 'c1', property: 'x', time: 0, value: 0 },
      { op: 'set_keyframe', clipId: 'c1', property: 'x', time: 1, value: 100 },
    ]);

    const clip = next.tracks[0].clips[0];
    expect(clip.trimStart).toBe(2);
    expect(clip.trimEnd).toBe(8);
    expect(clip.speed).toBe(2);
    expect(clip.volume).toBe(0.7);
    expect(clip.transform.scaleX).toBe(1.1);
    expect(clip.effects).toHaveLength(1);
    expect(clip.keyframes).toHaveLength(2);
  });

  it('can add text and markers without knowing implementation details', () => {
    const timeline = { version: 2, duration: 0, tracks: [], markers: [] };
    const next = applyOperations(timeline, [
      { op: 'add_text', text: 'Hello', startTime: 1, duration: 2, style: { fontSize: 48 } },
      { op: 'add_marker', time: 1.5, label: 'Hook' },
      { op: 'set_timeline', width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' },
    ]);
    expect(next.tracks.some((track: any) => track.type === 'text')).toBe(true);
    expect(next.markers[0].label).toBe('Hook');
    expect(next.width).toBe(1080);
    expect(next.height).toBe(1920);
  });
});
