export type AnimeExpression = "neutral" | "happy" | "surprised" | "sad" | "determined";

export interface RigBone {
  id: string;
  name: string;
  parentId: string | null;
  x: number;
  y: number;
  rotation: number;
  length: number;
  scaleX: number;
  scaleY: number;
}

export interface RigSlot {
  id: string;
  name: string;
  boneId: string;
  assetId?: string;
  zIndex: number;
}

export interface AnimeRig {
  name: string;
  bones: RigBone[];
  slots: RigSlot[];
  sourceFormat?: "native" | "spine-json" | "dragonbones-json";
}

export interface AnimeKeyframe {
  id: string;
  timeSeconds: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  opacity: number;
  expression: AnimeExpression;
  label: string;
}

export interface AnimeScene {
  id: string;
  title: string;
  startSeconds: number;
  durationSeconds: number;
  setting: string;
  action: string;
  dialogue: string;
  camera: string;
  mood: string;
}

export interface AnimeProjectDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  durationSeconds: number;
  visualStyle: string;
  background: string;
  character: {
    id: string;
    name: string;
    rig: AnimeRig;
    keyframes: AnimeKeyframe[];
  };
  scenes: AnimeScene[];
  audioCues: Array<{ id: string; timeSeconds: number; label: string; type: "dialogue" | "music" | "sfx" }>;
}

export interface WorldBoneTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type RigInterchangeFormat = "spine" | "dragonbones";

function makeId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function defaultRig(): AnimeRig {
  return {
    name: "anime-hero",
    sourceFormat: "native",
    bones: [
      { id: "root", name: "root", parentId: null, x: 0, y: 0, rotation: 0, length: 0, scaleX: 1, scaleY: 1 },
      { id: "torso", name: "torso", parentId: "root", x: 0, y: 0, rotation: 0, length: 84, scaleX: 1, scaleY: 1 },
      { id: "head", name: "head", parentId: "torso", x: 0, y: -84, rotation: 0, length: 48, scaleX: 1, scaleY: 1 },
      { id: "arm-l", name: "arm-l", parentId: "torso", x: -24, y: -22, rotation: -18, length: 56, scaleX: 1, scaleY: 1 },
      { id: "arm-r", name: "arm-r", parentId: "torso", x: 24, y: -22, rotation: 18, length: 56, scaleX: 1, scaleY: 1 },
      { id: "leg-l", name: "leg-l", parentId: "torso", x: -14, y: 56, rotation: -6, length: 58, scaleX: 1, scaleY: 1 },
      { id: "leg-r", name: "leg-r", parentId: "torso", x: 14, y: 56, rotation: 6, length: 58, scaleX: 1, scaleY: 1 }
    ],
    slots: [
      { id: "body", name: "body", boneId: "torso", zIndex: 1 },
      { id: "face", name: "face", boneId: "head", zIndex: 2 },
      { id: "hair", name: "hair", boneId: "head", zIndex: 3 }
    ]
  };
}

export function createDefaultAnimeProject(): AnimeProjectDocument {
  return {
    schemaVersion: 1,
    id: makeId("anime-project"),
    name: "قصة الأنمي الأولى",
    fps: 24,
    width: 1080,
    height: 1920,
    durationSeconds: 8,
    visualStyle: "أنمي ياباني ثنائي الأبعاد، ألوان سينمائية، خطوط واضحة، تعبيرات وجه مقروءة",
    background: "#111827",
    character: {
      id: "hero",
      name: "البطل",
      rig: defaultRig(),
      keyframes: [
        { id: "kf-0", timeSeconds: 0, x: 50, y: 57, rotation: 0, scale: 1, opacity: 1, expression: "neutral", label: "الاستعداد" },
        { id: "kf-1", timeSeconds: 1.5, x: 50, y: 55, rotation: -5, scale: 1.02, opacity: 1, expression: "happy", label: "يلتفت" },
        { id: "kf-2", timeSeconds: 2.3, x: 53, y: 48, rotation: 4, scale: 1.05, opacity: 1, expression: "surprised", label: "قفزة" },
        { id: "kf-3", timeSeconds: 3.1, x: 54, y: 57, rotation: 0, scale: 1, opacity: 1, expression: "happy", label: "هبوط" },
        { id: "kf-4", timeSeconds: 5, x: 64, y: 55, rotation: 8, scale: 1.02, opacity: 1, expression: "determined", label: "خطوة للأمام" },
        { id: "kf-5", timeSeconds: 8, x: 62, y: 57, rotation: 0, scale: 1, opacity: 1, expression: "happy", label: "نهاية اللقطة" }
      ]
    },
    scenes: [
      { id: "scene-1", title: "بداية الحكاية", startSeconds: 0, durationSeconds: 3, setting: "شارع هادئ وقت الغروب", action: "يلتفت البطل إلى مصدر صوت ثم يقفز بخفة", dialogue: "", camera: "اقتراب بطيء", mood: "فضولي" },
      { id: "scene-2", title: "لحظة الاكتشاف", startSeconds: 3, durationSeconds: 5, setting: "ضوء ذهبي وخلفية مدينة مبسطة", action: "يهبط البطل ويشير إلى الأمام بثقة", dialogue: "", camera: "تحريك جانبي خفيف", mood: "مرح ومتفائل" }
    ],
    audioCues: [
      { id: "audio-1", timeSeconds: 0, label: "موسيقى افتتاحية خفيفة", type: "music" },
      { id: "audio-2", timeSeconds: 2.2, label: "مؤثر قفزة", type: "sfx" }
    ]
  };
}

export function sampleCharacterKeyframes(keyframes: AnimeKeyframe[], timeSeconds: number): Omit<AnimeKeyframe, "id" | "label" | "timeSeconds"> & { label: string } {
  if (!keyframes.length) {
    return { x: 50, y: 55, rotation: 0, scale: 1, opacity: 1, expression: "neutral", label: "وضعية افتراضية" };
  }
  const ordered = [...keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  if (timeSeconds <= ordered[0].timeSeconds) {
    const { x, y, rotation, scale, opacity, expression, label } = ordered[0];
    return { x, y, rotation, scale, opacity, expression, label };
  }
  const last = ordered[ordered.length - 1];
  if (timeSeconds >= last.timeSeconds) {
    const { x, y, rotation, scale, opacity, expression, label } = last;
    return { x, y, rotation, scale, opacity, expression, label };
  }
  const rightIndex = ordered.findIndex((frame) => frame.timeSeconds >= timeSeconds);
  const left = ordered[Math.max(0, rightIndex - 1)];
  const right = ordered[rightIndex];
  const span = Math.max(0.0001, right.timeSeconds - left.timeSeconds);
  const t = Math.max(0, Math.min(1, (timeSeconds - left.timeSeconds) / span));
  const eased = t * t * (3 - 2 * t);
  const mix = (a: number, b: number) => a + (b - a) * eased;
  const expression = t < 0.5 ? left.expression : right.expression;
  return {
    x: mix(left.x, right.x),
    y: mix(left.y, right.y),
    rotation: mix(left.rotation, right.rotation),
    scale: mix(left.scale, right.scale),
    opacity: mix(left.opacity, right.opacity),
    expression,
    label: t < 0.5 ? left.label : right.label
  };
}

export function validateRig(rig: AnimeRig): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const bone of rig.bones) {
    if (ids.has(bone.id)) issues.push("معرّف العظمة مكرر: " + bone.id);
    ids.add(bone.id);
  }
  for (const bone of rig.bones) {
    if (bone.parentId && !ids.has(bone.parentId)) issues.push("العظمة " + bone.id + " تشير إلى أب غير موجود: " + bone.parentId);
    if (bone.parentId === bone.id) issues.push("لا يمكن للعظمة أن تكون أباً لنفسها: " + bone.id);
  }
  for (const slot of rig.slots) {
    if (!ids.has(slot.boneId)) issues.push("الطبقة " + slot.name + " مرتبطة بعظمة غير موجودة: " + slot.boneId);
  }
  const byId = new Map(rig.bones.map((bone) => [bone.id, bone]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      issues.push("تم اكتشاف دورة في تسلسل العظام عند: " + id);
      return;
    }
    visiting.add(id);
    const bone = byId.get(id);
    if (bone?.parentId && byId.has(bone.parentId)) visit(bone.parentId);
    visiting.delete(id);
    done.add(id);
  };
  rig.bones.forEach((bone) => visit(bone.id));
  return [...new Set(issues)];
}

export function solveRigWorldTransforms(rig: AnimeRig): Record<string, WorldBoneTransform> {
  const issues = validateRig(rig);
  if (issues.length) throw new Error(issues.join("؛ "));
  const byId = new Map(rig.bones.map((bone) => [bone.id, bone]));
  const solved: Record<string, WorldBoneTransform> = {};
  const solve = (id: string): WorldBoneTransform => {
    if (solved[id]) return solved[id];
    const bone = byId.get(id);
    if (!bone) throw new Error("عظمة غير معروفة: " + id);
    const localRotation = bone.rotation * Math.PI / 180;
    if (!bone.parentId) {
      solved[id] = { x: bone.x, y: bone.y, rotation: localRotation, scaleX: bone.scaleX, scaleY: bone.scaleY };
      return solved[id];
    }
    const parent = solve(bone.parentId);
    const px = bone.x * parent.scaleX;
    const py = bone.y * parent.scaleY;
    const cos = Math.cos(parent.rotation);
    const sin = Math.sin(parent.rotation);
    solved[id] = {
      x: parent.x + px * cos - py * sin,
      y: parent.y + px * sin + py * cos,
      rotation: parent.rotation + localRotation,
      scaleX: parent.scaleX * bone.scaleX,
      scaleY: parent.scaleY * bone.scaleY
    };
    return solved[id];
  };
  rig.bones.forEach((bone) => solve(bone.id));
  return solved;
}

export function importRigDocument(input: unknown): { rig: AnimeRig; format: "spine-json" | "dragonbones-json"; warnings: string[] } {
  const data = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, any>;
  if (!data || typeof data !== "object") throw new Error("ملف JSON لا يحتوي على هيكل معروف.");
  const armature = Array.isArray(data.armature) ? data.armature[0] : data.armature;
  const dragonBones = Array.isArray(armature?.bone);
  const rawBones = Array.isArray(data.bones) ? data.bones : (Array.isArray(data.skeleton?.bones) ? data.skeleton.bones : (dragonBones ? armature.bone : []));
  if (!rawBones.length) throw new Error("لم أجد قائمة bones في ملف Spine أو DragonBones JSON.");
  const format = dragonBones ? "dragonbones-json" : "spine-json";
  const bones: RigBone[] = rawBones.map((raw: Record<string, any>, index: number) => ({
    id: String(raw.name || raw.id || ("bone-" + index)),
    name: String(raw.name || raw.id || ("bone-" + index)),
    parentId: raw.parent ? String(raw.parent) : null,
    x: Number(raw.x ?? raw.transform?.x ?? 0),
    y: Number(raw.y ?? raw.transform?.y ?? 0),
    rotation: Number(raw.rotation ?? raw.transform?.rotation ?? raw.transform?.skX ?? 0),
    length: Number(raw.length ?? 0),
    scaleX: Number(raw.scaleX ?? raw.transform?.scX ?? 1),
    scaleY: Number(raw.scaleY ?? raw.transform?.scY ?? 1)
  }));
  const rawSlots = Array.isArray(data.slots) ? data.slots : (Array.isArray(armature?.slot) ? armature.slot : []);
  const slots: RigSlot[] = rawSlots.map((raw: Record<string, any>, index: number) => ({
    id: String(raw.name || ("slot-" + index)),
    name: String(raw.name || ("slot-" + index)),
    boneId: String(raw.bone || raw.parent || raw.parentName || (bones[0]?.id ?? "root")),
    assetId: raw.attachment ? String(raw.attachment) : undefined,
    zIndex: Number(raw.z ?? index)
  }));
  const rig: AnimeRig = { name: String(armature?.name || data.skeleton?.name || data.name || "imported-rig"), bones, slots, sourceFormat: format };
  const issues = validateRig(rig);
  if (issues.length) throw new Error(issues.join("؛ "));
  return {
    rig,
    format,
    warnings: [
      "تم استيراد أسماء العظام وعلاقاتها وتحويلاتها الأساسية فقط.",
      "الأوزان، وMesh Deformation، والقيود، والـSkins، ومنحنيات الحركة الخاصة قد تحتاج إلى ضبط داخل الأداة الأصلية."
    ]
  };
}

export function exportRigDocument(rig: AnimeRig, format: RigInterchangeFormat): Record<string, unknown> {
  const issues = validateRig(rig);
  if (issues.length) throw new Error(issues.join("؛ "));
  if (format === "spine") {
    return {
      skeleton: { hash: "", spine: "4.2.0", x: 0, y: 0, width: 0, height: 0 },
      bones: rig.bones.map((bone) => ({
        name: bone.name,
        ...(bone.parentId ? { parent: bone.parentId } : {}),
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        length: bone.length,
        scaleX: bone.scaleX,
        scaleY: bone.scaleY
      })),
      slots: rig.slots.map((slot) => ({ name: slot.name, bone: slot.boneId, attachment: slot.assetId || null })),
      skins: [],
      animations: {},
      _exportNotes: ["Basic hierarchy interchange only.", "Re-open and validate in Spine; attachments, skins, constraints and animation curves are not reconstructed."]
    };
  }
  return {
    name: rig.name,
    version: "5.6",
    frameRate: 24,
    armature: [{
      name: rig.name,
      frameRate: 24,
      type: "Armature",
      bone: rig.bones.map((bone) => ({
        name: bone.name,
        ...(bone.parentId ? { parent: bone.parentId } : {}),
        length: bone.length,
        transform: { x: bone.x, y: bone.y, skewX: bone.rotation, skewY: bone.rotation, scaleX: bone.scaleX, scaleY: bone.scaleY }
      })),
      slot: rig.slots.map((slot) => ({ name: slot.name, parent: slot.boneId, z: slot.zIndex, displayIndex: 0 })),
      skin: [{ name: "default", slot: [] }],
      animation: []
    }],
    _exportNotes: ["Basic hierarchy interchange only.", "Validate in DragonBones; skins, display data, meshes and animation timelines are not reconstructed."]
  };
}
