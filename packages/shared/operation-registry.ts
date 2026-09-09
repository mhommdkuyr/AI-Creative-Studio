export const EDITING_OPERATION_CATEGORIES = {
  source: 'source',
  temporal: 'temporal',
  transform: 'transform',
  compositing: 'compositing',
  color: 'color',
  audio: 'audio',
  text: 'text',
  transitions: 'transitions',
  timeline: 'timeline',
  analysis: 'analysis',
  export: 'export',
} as const;

export type EditingOperationCategory = typeof EDITING_OPERATION_CATEGORIES[keyof typeof EDITING_OPERATION_CATEGORIES];

export const EDITING_OPERATION_DEFINITIONS = [
  ['insert_clip','source'], ['replace_source','source'], ['relink_asset','source'], ['proxy_clip','source'], ['freeze_frame','source'],
  ['split','temporal'], ['delete_clip','temporal'], ['ripple_delete','temporal'], ['close_gap','temporal'], ['duplicate_clip','temporal'], ['move_clip','temporal'],
  ['trim_clip','temporal'], ['slip_clip','temporal'], ['slide_clip','temporal'], ['extend_clip','temporal'], ['set_speed','temporal'], ['set_speed_ramp','temporal'],
  ['set_time_remap','temporal'], ['reverse_clip','temporal'], ['loop_clip','temporal'], ['hold_frame','temporal'],
  ['set_opacity','transform'], ['transform','transform'], ['crop','transform'], ['fit_clip','transform'], ['fill_clip','transform'],
  ['mirror_clip','transform'], ['set_perspective','transform'], ['set_anchor','transform'], ['set_blend_mode','compositing'], ['set_mask','compositing'],
  ['set_chroma_key','compositing'], ['set_luma_key','compositing'], ['set_matte','compositing'], ['group_clips','compositing'], ['ungroup_clips','compositing'], ['nest_sequence','compositing'],
  ['set_color_adjustments','color'], ['set_hsl','color'], ['set_curves','color'], ['set_levels','color'], ['add_lut','color'], ['set_sharpen','color'],
  ['set_denoise','color'], ['set_vignette','color'], ['set_grain','color'],
  ['set_volume','audio'], ['mute_clip','audio'], ['set_pan','audio'], ['audio_fade','audio'], ['normalize_audio','audio'], ['audio_effect','audio'],
  ['duck_audio','audio'], ['set_audio_speed','audio'], ['replace_audio','audio'], ['remove_audio','audio'],
  ['add_text','text'], ['update_text','text'], ['delete_text','text'], ['add_caption','text'], ['update_caption','text'], ['delete_caption','text'],
  ['import_captions','text'], ['export_captions','text'],
  ['add_effect','transitions'], ['remove_effect','transitions'], ['update_effect','transitions'], ['set_effect_stack','transitions'],
  ['set_keyframe','transitions'], ['add_transition','transitions'], ['remove_transition','transitions'],
  ['add_track','timeline'], ['delete_track','timeline'], ['duplicate_track','timeline'], ['reorder_track','timeline'], ['rename_track','timeline'],
  ['set_track_state','timeline'], ['set_track_type','timeline'], ['add_marker','timeline'], ['remove_marker','timeline'], ['clear_markers','timeline'],
  ['set_timeline','timeline'], ['set_selection','timeline'], ['clear_selection','timeline'],
  ['detect_scenes','analysis'], ['detect_silence','analysis'], ['detect_beats','analysis'], ['transcribe','analysis'], ['auto_caption','analysis'],
  ['track_subject','analysis'], ['smart_reframe','analysis'], ['extract_highlights','analysis'], ['auto_cut','analysis'],
  ['render_preview','export'], ['render_export','export'], ['extract_frame','export'], ['generate_thumbnail','export'],
  ['noop','timeline'],
] as const;

export type RegisteredOperationName = typeof EDITING_OPERATION_DEFINITIONS[number][0];

export const EDITING_OPERATION_NAMES = EDITING_OPERATION_DEFINITIONS.map(([name]) => name) as RegisteredOperationName[];

export const EDITING_OPERATION_CAPABILITIES = Object.fromEntries(
  EDITING_OPERATION_DEFINITIONS.map(([name, category]) => [name, { category, version: 1, execution: category === 'analysis' || category === 'export' ? 'job' : 'timeline' }]),
) as Record<RegisteredOperationName, { category: EditingOperationCategory; version: 1; execution: 'timeline' | 'job' }>;
