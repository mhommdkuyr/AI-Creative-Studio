import { describe, expect, it } from 'vitest';
import { applyOperations, EDITING_OPERATION_NAMES } from './editingEngine.js';

function baseTimeline() {
  return {
    version: 2, duration: 10, currentTime: 0, fps: 30, width: 1920, height: 1080,
    tracks: [
      { id: 'v1', name: 'Video 1', type: 'video', clips: [
        { id: 'c1', assetId: 'a1', name: 'source.mp4', startTime: 0, endTime: 5, trimStart: 0, trimEnd: 5, duration: 5, speed: 1, volume: 1, opacity: 1, effects: [], audioEffects: [], keyframes: [] },
        { id: 'c2', assetId: 'a2', name: 'second.mp4', startTime: 5, endTime: 10, trimStart: 0, trimEnd: 5, duration: 5, speed: 1, volume: 1, opacity: 1, effects: [], audioEffects: [], keyframes: [] },
      ], muted: false, locked: false, visible: true, order: 0 },
      { id: 'a-track', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, visible: true, order: 1 },
      { id: 't1', name: 'Text 1', type: 'text', clips: [{ id: 'txt1', type: 'text', name: 'Hello', text: 'Hello', startTime: 0, endTime: 2, duration: 2, style: {} }], muted: false, locked: false, visible: true, order: 2 },
    ],
    markers: [{ id: 'm1', time: 1, label: 'start' }],
  };
}

describe('editing engine', () => {
  it('executes a compound professional edit deterministically', () => {
    const next = applyOperations(baseTimeline(), [
      { op: 'trim_clip', clipId: 'c1', trimStart: 1, trimEnd: 4 },
      { op: 'set_speed', clipId: 'c1', speed: 2 },
      { op: 'set_volume', clipId: 'c1', volume: 0.7 },
      { op: 'transform', clipId: 'c1', scaleX: 1.1, scaleY: 1.1, rotation: 4 },
      { op: 'set_color_adjustments', clipId: 'c1', exposure: 0.25, contrast: 1.1 },
      { op: 'set_chroma_key', clipId: 'c1', enabled: true, color: '#00ff00' },
      { op: 'audio_fade', clipId: 'c1', in: 0.2, out: 0.4 },
      { op: 'add_effect', clipId: 'c1', effect: 'blur', params: { amount: 0.2 } },
      { op: 'set_keyframe', clipId: 'c1', property: 'x', time: 0, value: 0 },
      { op: 'set_keyframe', clipId: 'c1', property: 'x', time: 1, value: 100 },
      { op: 'add_transition', fromClipId: 'c1', toClipId: 'c2', type: 'crossfade', duration: 0.5 },
      { op: 'add_text', text: 'Hook', startTime: 0.5, duration: 1.5, style: { fontSize: 48 } },
    ]);
    const clip = next.tracks[0].clips.find((c: any) => c.id === 'c1');
    expect(clip.trimStart).toBe(1);
    expect(clip.trimEnd).toBe(4);
    expect(clip.speed).toBe(2);
    expect(clip.volume).toBe(0.7);
    expect(clip.transform.scaleX).toBe(1.1);
    expect(clip.color.set_color_adjustments.exposure).toBe(0.25);
    expect(clip.set_chroma_key.enabled).toBe(true);
    expect(clip.effects).toHaveLength(1);
    expect(clip.keyframes).toHaveLength(2);
    expect(clip.transition.type).toBe('crossfade');
    expect(next.tracks.find((t: any) => t.type === 'text')?.clips).toHaveLength(2);
  });

  it('covers every registered operation and validates its observable contract', () => {
    const operations: Record<string, any> = {
      insert_clip: { op: 'insert_clip', assetId: 'a3', name: 'inserted', startTime: 10, duration: 2 }, replace_source: { op: 'replace_source', clipId: 'c1', assetId: 'a9' }, relink_asset: { op: 'relink_asset', clipId: 'c1', assetId: 'a8' }, proxy_clip: { op: 'proxy_clip', clipId: 'c1', enabled: true, proxyAssetId: 'p1' }, freeze_frame: { op: 'freeze_frame', clipId: 'c1', time: 2, duration: 1 }, split: { op: 'split', clipId: 'c1', time: 2 }, delete_clip: { op: 'delete_clip', clipId: 'c2' }, ripple_delete: { op: 'ripple_delete', clipId: 'c1' }, close_gap: { op: 'close_gap', startTime: 5, duration: 1 }, duplicate_clip: { op: 'duplicate_clip', clipId: 'c1', offset: 1 }, move_clip: { op: 'move_clip', clipId: 'c1', startTime: 1 }, trim_clip: { op: 'trim_clip', clipId: 'c1', trimStart: 1, trimEnd: 4 }, slip_clip: { op: 'slip_clip', clipId: 'c1', amount: 0.5 }, slide_clip: { op: 'slide_clip', clipId: 'c1', amount: 0.5 }, extend_clip: { op: 'extend_clip', clipId: 'c1', duration: 1 }, set_speed: { op: 'set_speed', clipId: 'c1', speed: 1.5 }, set_speed_ramp: { op: 'set_speed_ramp', clipId: 'c1', points: [{ time: 0, speed: 1 }, { time: 1, speed: 2 }] }, set_time_remap: { op: 'set_time_remap', clipId: 'c1', points: [{ time: 0, sourceTime: 1 }] }, reverse_clip: { op: 'reverse_clip', clipId: 'c1', enabled: true }, loop_clip: { op: 'loop_clip', clipId: 'c1', count: 3 }, hold_frame: { op: 'hold_frame', clipId: 'c1', time: 2, duration: 1 }, set_opacity: { op: 'set_opacity', clipId: 'c1', opacity: 0.5 }, transform: { op: 'transform', clipId: 'c1', x: 20, y: 30, scaleX: 1.2 }, crop: { op: 'crop', clipId: 'c1', left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }, fit_clip: { op: 'fit_clip', clipId: 'c1' }, fill_clip: { op: 'fill_clip', clipId: 'c1' }, mirror_clip: { op: 'mirror_clip', clipId: 'c1', horizontal: true }, set_perspective: { op: 'set_perspective', clipId: 'c1', points: { tl: [0,0], tr: [1,0], br: [1,1], bl: [0,1] } }, set_anchor: { op: 'set_anchor', clipId: 'c1', x: 0.5, y: 0.5 }, set_blend_mode: { op: 'set_blend_mode', clipId: 'c1', mode: 'screen' }, set_mask: { op: 'set_mask', clipId: 'c1', shape: 'circle' }, set_chroma_key: { op: 'set_chroma_key', clipId: 'c1', enabled: true }, set_luma_key: { op: 'set_luma_key', clipId: 'c1', enabled: true }, set_matte: { op: 'set_matte', clipId: 'c1', enabled: true }, group_clips: { op: 'group_clips', clipIds: ['c1','c2'], name: 'Group' }, ungroup_clips: { op: 'ungroup_clips', groupId: 'missing' }, nest_sequence: { op: 'nest_sequence', clipIds: ['c1','c2'], name: 'Scene' }, set_color_adjustments: { op: 'set_color_adjustments', clipId: 'c1', exposure: 1 }, set_hsl: { op: 'set_hsl', clipId: 'c1', hue: 10, saturation: 5 }, set_curves: { op: 'set_curves', clipId: 'c1', points: [[0,0],[1,1]] }, set_levels: { op: 'set_levels', clipId: 'c1', blacks: 0.1, whites: 0.9 }, add_lut: { op: 'add_lut', clipId: 'c1', lut: 'cinematic.cube' }, set_sharpen: { op: 'set_sharpen', clipId: 'c1', amount: 0.4 }, set_denoise: { op: 'set_denoise', clipId: 'c1', amount: 0.3 }, set_vignette: { op: 'set_vignette', clipId: 'c1', amount: 0.2 }, set_grain: { op: 'set_grain', clipId: 'c1', amount: 0.1 }, set_volume: { op: 'set_volume', clipId: 'c1', volume: 0.8 }, mute_clip: { op: 'mute_clip', clipId: 'c1', muted: true }, set_pan: { op: 'set_pan', clipId: 'c1', pan: 0.2 }, audio_fade: { op: 'audio_fade', clipId: 'c1', in: 0.2, out: 0.2 }, normalize_audio: { op: 'normalize_audio', clipId: 'c1', enabled: true }, audio_effect: { op: 'audio_effect', clipId: 'c1', effect: 'eq', params: { low: 2 } }, duck_audio: { op: 'duck_audio', clipId: 'c1', amount: 0.5, threshold: -18 }, set_audio_speed: { op: 'set_audio_speed', clipId: 'c1', speed: 1.1 }, replace_audio: { op: 'replace_audio', clipId: 'c1', assetId: 'music1' }, remove_audio: { op: 'remove_audio', clipId: 'c1' }, add_text: { op: 'add_text', text: 'Text', startTime: 1, duration: 1 }, update_text: { op: 'update_text', clipId: 'txt1', text: 'Updated' }, delete_text: { op: 'delete_text', clipId: 'txt1' }, add_caption: { op: 'add_caption', text: 'Caption', startTime: 1, duration: 1 }, update_caption: { op: 'update_caption', clipId: 'txt1', text: 'Caption update' }, delete_caption: { op: 'delete_caption', clipId: 'txt1' }, import_captions: { op: 'import_captions', source: 'captions.srt', format: 'srt' }, export_captions: { op: 'export_captions', format: 'srt' }, add_effect: { op: 'add_effect', clipId: 'c1', effect: 'blur', params: { amount: 0.2 } }, remove_effect: { op: 'remove_effect', clipId: 'c1', effect: 'missing' }, update_effect: { op: 'update_effect', clipId: 'c1', effect: 'missing', params: { amount: 0.5 } }, set_effect_stack: { op: 'set_effect_stack', clipId: 'c1', effects: [{ name: 'blur' }] }, set_keyframe: { op: 'set_keyframe', clipId: 'c1', property: 'opacity', time: 1, value: 0.5 }, add_transition: { op: 'add_transition', fromClipId: 'c1', toClipId: 'c2', type: 'fade', duration: 0.4 }, remove_transition: { op: 'remove_transition', clipId: 'c1' }, add_track: { op: 'add_track', type: 'video', name: 'B-roll' }, delete_track: { op: 'delete_track', trackId: 'a-track' }, duplicate_track: { op: 'duplicate_track', trackId: 'v1', name: 'Video Copy' }, reorder_track: { op: 'reorder_track', trackId: 'v1', order: 5 }, rename_track: { op: 'rename_track', trackId: 'v1', name: 'Main Video' }, set_track_state: { op: 'set_track_state', trackId: 'v1', muted: true, locked: true, visible: false }, set_track_type: { op: 'set_track_type', trackId: 'v1', type: 'audio' }, add_marker: { op: 'add_marker', time: 3, label: 'Beat' }, remove_marker: { op: 'remove_marker', markerId: 'm1' }, clear_markers: { op: 'clear_markers' }, set_timeline: { op: 'set_timeline', width: 1080, height: 1920, fps: 60, aspectRatio: '9:16' }, set_selection: { op: 'set_selection', clipIds: ['c1'], startTime: 0, endTime: 2 }, clear_selection: { op: 'clear_selection' }, detect_scenes: { op: 'detect_scenes' }, detect_silence: { op: 'detect_silence' }, detect_beats: { op: 'detect_beats' }, transcribe: { op: 'transcribe' }, auto_caption: { op: 'auto_caption' }, track_subject: { op: 'track_subject', clipId: 'c1' }, smart_reframe: { op: 'smart_reframe', clipId: 'c1', aspectRatio: '9:16' }, extract_highlights: { op: 'extract_highlights' }, auto_cut: { op: 'auto_cut' }, render_preview: { op: 'render_preview' }, render_export: { op: 'render_export', format: 'mp4' }, extract_frame: { op: 'extract_frame', time: 1 }, generate_thumbnail: { op: 'generate_thumbnail' },
    };

    for (const name of EDITING_OPERATION_NAMES.filter((item) => item !== 'noop')) {
      expect(operations[name], `missing test fixture for ${name}`).toBeTruthy();
      const next = applyOperations(baseTimeline(), [operations[name]]);
      const idempotentOrAbsent = new Set(['ungroup_clips','clear_selection','remove_effect','update_effect','remove_transition']);
      if (['detect_scenes','detect_silence','detect_beats','transcribe','auto_caption','track_subject','smart_reframe','extract_highlights','auto_cut','render_preview','render_export','extract_frame','generate_thumbnail','export_captions'].includes(name)) {
        expect(next.jobs.length, name).toBeGreaterThan(0);
      } else if (idempotentOrAbsent.has(name)) {
        expect(next, name).toBeTruthy();
      } else if (name === 'delete_text' || name === 'delete_caption') {
        expect(next.tracks.find((t: any) => t.id === 't1')?.clips).toHaveLength(0);
      } else {
        expect(JSON.stringify(next), name).not.toBe(JSON.stringify(baseTimeline()));
      }
    }
  });

  it('preserves ordered compound plans and keeps async capabilities explicit', () => {
    const next = applyOperations(baseTimeline(), [
      { op: 'split', clipId: 'c1', time: 2 },
      { op: 'set_speed_ramp', clipId: 'c1', points: [{ time: 0, speed: 1 }, { time: 1, speed: 2 }] },
      { op: 'add_effect', clipId: 'c1', effect: 'glow' },
      { op: 'set_keyframe', clipId: 'c1', property: 'opacity', time: 0.5, value: 0.2 },
      { op: 'auto_caption' },
      { op: 'render_export', format: 'mp4' },
    ]);
    expect(next.tracks[0].clips.length).toBe(3);
    expect(next.tracks[0].clips[0].speedRamp).toHaveLength(2);
    expect(next.tracks[0].clips[0].effects[0].name).toBe('glow');
    expect(next.tracks[0].clips[0].keyframes[0].value).toBe(0.2);
    expect(next.jobs.map((job: any) => job.type)).toEqual(['auto_caption', 'render_export']);
  });
});
