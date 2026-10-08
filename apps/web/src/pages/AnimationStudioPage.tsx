import React, { useEffect, useMemo, useRef, useState } from "react";
import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import { Check, Download, Film, Layers, Pause, Play, Plus, Save, Sparkles, Upload, Wand2 } from "lucide-react";
import {
  createDefaultAnimeProject,
  exportRigDocument,
  importRigDocument,
  sampleCharacterKeyframes,
  type AnimeExpression,
  type AnimeKeyframe,
  type AnimeProjectDocument
} from "@ai-creative-studio/animation-engine/studio";

const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const STORAGE_KEY = "ai-creative-studio-anime-project-v1";

type AnimationPlanResponse = {
  ok: boolean;
  provider: "chatgpt" | "openai" | "local";
  note?: string;
  editorUrl?: string;
  plan: {
    title: string;
    logline: string;
    visualStyle: string;
    fps: number;
    width: number;
    height: number;
    durationSeconds: number;
    scenes: AnimeProjectDocument["scenes"];
    keyframes: AnimeKeyframe[];
  };
};

function initialProject(): AnimeProjectDocument {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value) {
      const parsed = JSON.parse(value) as AnimeProjectDocument;
      if (parsed.schemaVersion === 1 && parsed.character?.keyframes?.length) return parsed;
    }
  } catch {}
  return createDefaultAnimeProject();
}

function downloadText(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timeLabel(value: number, fps: number) {
  const seconds = Math.floor(value);
  const frames = Math.floor((value - seconds) * fps);
  return String(seconds).padStart(2, "0") + ":" + String(frames).padStart(2, "0");
}

export function AnimationStudioPage() {
  const [project, setProject] = useState<AnimeProjectDocument>(initialProject);
  const [prompt, setPrompt] = useState("أنشئ مشهداً قصيراً لبطل أنمي يكتشف ضوءاً غامضاً، يقفز بخفة ثم يبتسم للكاميرا، بأسلوب سينمائي مناسب لفيديو عمودي.");
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState("جاهز للتحريك");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState("kf-0");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [stageReady, setStageReady] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const projectRef = useRef(project);
  const timeRef = useRef(currentTime);
  const renderRef = useRef<() => void>(() => {});
  const backgroundRef = useRef<Graphics | null>(null);
  const characterGraphicRef = useRef<Graphics | null>(null);
  const characterContainerRef = useRef<Container | null>(null);
  const imageSpriteRef = useRef<Sprite | null>(null);
  const exportingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rigInputRef = useRef<HTMLInputElement | null>(null);
  projectRef.current = project;
  timeRef.current = currentTime;

  const keyframes = project.character.keyframes;
  const selectedKeyframe = keyframes.find((frame) => frame.id === selectedKeyframeId) || keyframes[0];
  const activeScene = useMemo(() => {
    return [...project.scenes].reverse().find((scene) => currentTime >= scene.startSeconds) || project.scenes[0];
  }, [project.scenes, currentTime]);
  const currentPose = useMemo(() => sampleCharacterKeyframes(keyframes, currentTime), [keyframes, currentTime]);

  useEffect(() => {
    try { sessionStorage.setItem("anime-animation-api-token", apiToken); } catch {}
  }, [apiToken]);

  useEffect(() => {
    try {
      const token = sessionStorage.getItem("anime-animation-api-token");
      if (token) setApiToken(token);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch {}
  }, [project]);

  useEffect(() => {
    const marker = "#ai-anime-plan=";
    const hash = window.location.hash;
    const markerIndex = hash.indexOf(marker);
    if (markerIndex < 0) return;
    try {
      const encoded = hash.slice(markerIndex + marker.length);
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const plan = JSON.parse(new TextDecoder().decode(bytes)) as AnimationPlanResponse["plan"];
      if (!plan || !Array.isArray(plan.scenes) || !Array.isArray(plan.keyframes) || plan.keyframes.length < 2) {
        throw new Error("خطة الأنمي في الرابط غير مكتملة.");
      }
      setProject((current) => ({
        ...current,
        name: plan.title || current.name,
        fps: plan.fps || 24,
        width: plan.width || 1080,
        height: plan.height || 1920,
        durationSeconds: plan.durationSeconds || 8,
        visualStyle: plan.visualStyle || current.visualStyle,
        scenes: plan.scenes,
        character: { ...current.character, keyframes: plan.keyframes }
      }));
      setCurrentTime(0);
      setSelectedKeyframeId(plan.keyframes[0]?.id || "");
      setStatus("تم تحميل خطة ChatGPT في المحرر؛ يمكنك تعديل الإطارات وتشغيل المعاينة.");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "تعذر تحميل خطة الأنمي من الرابط.");
    }
  }, []);

  renderRef.current = () => {
    const app = appRef.current;
    const background = backgroundRef.current;
    const graphic = characterGraphicRef.current;
    const characterContainer = characterContainerRef.current;
    if (!app || !background || !graphic || !characterContainer) return;
    const width = app.screen.width;
    const height = app.screen.height;
    const frameWidth = Math.min(width * 0.48, height * 0.86 * 9 / 16);
    const frameHeight = frameWidth * 16 / 9;
    const frameX = (width - frameWidth) / 2;
    const frameY = (height - frameHeight) / 2;
    const backdrop = Number.parseInt(projectRef.current.background.replace("#", ""), 16);
    const frameColor = Number.isFinite(backdrop) ? backdrop : 0x111827;
    const time = timeRef.current;
    const pose = sampleCharacterKeyframes(projectRef.current.character.keyframes, time);
    const wave = Math.sin(time * 5) * 0.5;

    background.clear();
    background.rect(0, 0, width, height).fill({ color: 0x0b1020 });
    background.rect(frameX - 4, frameY - 4, frameWidth + 8, frameHeight + 8).fill({ color: 0x29364f });
    background.rect(frameX, frameY, frameWidth, frameHeight).fill({ color: frameColor });
    for (let x = 0; x <= frameWidth; x += Math.max(16, frameWidth / 8)) {
      background.moveTo(frameX + x, frameY).lineTo(frameX + x, frameY + frameHeight).stroke({ color: 0x65718a, alpha: 0.19, width: 1 });
    }
    for (let y = 0; y <= frameHeight; y += Math.max(16, frameHeight / 12)) {
      background.moveTo(frameX, frameY + y).lineTo(frameX + frameWidth, frameY + y).stroke({ color: 0x65718a, alpha: 0.19, width: 1 });
    }
    for (let star = 0; star < 18; star++) {
      const sx = frameX + ((star * 47 + 23) % Math.max(1, Math.floor(frameWidth)));
      const sy = frameY + ((star * 67 + 31) % Math.max(1, Math.floor(frameHeight * 0.72)));
      background.circle(sx, sy, star % 4 === 0 ? 1.7 : 1).fill({ color: 0xd7e8ff, alpha: 0.45 });
    }
    background.ellipse(frameX + frameWidth * 0.5, frameY + frameHeight * 0.84, frameWidth * 0.2, frameWidth * 0.035).fill({ color: 0x070b16, alpha: 0.35 });
    characterContainer.position.set(frameX + frameWidth * pose.x / 100, frameY + frameHeight * pose.y / 100);
    characterContainer.rotation = pose.rotation * Math.PI / 180;
    characterContainer.scale.set((frameWidth / 280) * pose.scale);
    graphic.visible = !imageSpriteRef.current;
    graphic.clear();

    const skin = 0xffd7c2;
    const outline = 0x22223a;
    const hair = 0x273d77;
    const coat = 0xf3f5fb;
    const accent = 0xf06595;
    graphic.ellipse(0, 138, 40, 8).fill({ color: 0x111827, alpha: 0.12 });
    graphic.moveTo(-17, 37).lineTo(-24 + wave * 7, 84).lineTo(-17 + wave * 8, 108).stroke({ color: 0x202d50, width: 19, cap: "round" });
    graphic.moveTo(17, 37).lineTo(24 - wave * 8, 84).lineTo(17 - wave * 7, 108).stroke({ color: 0x202d50, width: 19, cap: "round" });
    graphic.moveTo(-28, -19).lineTo(-57, 11 + wave * 13).stroke({ color: skin, width: 15, cap: "round" });
    graphic.moveTo(28, -19).lineTo(54, -14 - wave * 18).stroke({ color: skin, width: 15, cap: "round" });
    graphic.moveTo(-28, -19).lineTo(-57, 11 + wave * 13).stroke({ color: outline, width: 19, alpha: 0.95, cap: "round" });
    graphic.moveTo(-28, -19).lineTo(-57, 11 + wave * 13).stroke({ color: skin, width: 13, cap: "round" });
    graphic.moveTo(28, -19).lineTo(54, -14 - wave * 18).stroke({ color: outline, width: 19, alpha: 0.95, cap: "round" });
    graphic.moveTo(28, -19).lineTo(54, -14 - wave * 18).stroke({ color: skin, width: 13, cap: "round" });
    graphic.roundRect(-31, -40, 62, 91, 18).fill({ color: coat }).stroke({ color: outline, width: 4 });
    graphic.moveTo(0, -36).lineTo(0, 48).stroke({ color: 0xd9e1ef, width: 3 });
    graphic.moveTo(-17, -34).lineTo(-5, -18).lineTo(0, -29).lineTo(6, -18).lineTo(18, -34).stroke({ color: accent, width: 5, cap: "round" });
    graphic.circle(0, -92, 47).fill({ color: skin }).stroke({ color: outline, width: 4 });
    graphic.moveTo(-46, -97).lineTo(-43, -127).lineTo(-25, -144).lineTo(-9, -128).lineTo(5, -151).lineTo(23, -128).lineTo(42, -119).lineTo(44, -91).lineTo(25, -111).lineTo(9, -101).lineTo(-10, -117).lineTo(-27, -99).closePath().fill({ color: hair }).stroke({ color: outline, width: 3 });
    graphic.ellipse(-16, -91, 5, pose.expression === "surprised" ? 9 : 6).fill({ color: 0x28314b });
    graphic.ellipse(16, -91, 5, pose.expression === "surprised" ? 9 : 6).fill({ color: 0x28314b });
    graphic.circle(-14, -93, 1.6).fill({ color: 0xffffff });
    graphic.circle(18, -93, 1.6).fill({ color: 0xffffff });
    if (pose.expression === "surprised") {
      graphic.circle(0, -75, 5).stroke({ color: 0x8f3856, width: 3 });
    } else if (pose.expression === "sad") {
      graphic.moveTo(-7, -75).lineTo(0, -79).lineTo(7, -75).stroke({ color: 0x8f3856, width: 3 });
    } else if (pose.expression === "happy") {
      graphic.moveTo(-8, -79).lineTo(0, -73).lineTo(8, -79).stroke({ color: 0x8f3856, width: 3, cap: "round" });
    } else {
      graphic.moveTo(-7, -76).lineTo(7, -76).stroke({ color: 0x8f3856, width: 3, cap: "round" });
    }
    graphic.circle(-33, -79, 4).fill({ color: 0xf59ab1, alpha: 0.55 });
    graphic.circle(33, -79, 4).fill({ color: 0xf59ab1, alpha: 0.55 });
    graphic.moveTo(-8, 7).lineTo(-1, 20).lineTo(7, 7).stroke({ color: accent, width: 4, cap: "round" });
  };

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let cancelled = false;
    const app = new Application();
    (async () => {
      try {
        await app.init({
          background: 0x0b1020,
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2)
        });
        if (cancelled) {
          (app as any).destroy(true);
          return;
        }
        host.appendChild(app.canvas);
        const background = new Graphics();
        const characterContainer = new Container();
        const characterGraphic = new Graphics();
        characterContainer.addChild(characterGraphic);
        app.stage.addChild(background, characterContainer);
        appRef.current = app;
        backgroundRef.current = background;
        characterContainerRef.current = characterContainer;
        characterGraphicRef.current = characterGraphic;
        app.ticker.add(() => renderRef.current());
        setStageReady(true);
        renderRef.current();
      } catch (error) {
        setStatus("تعذر بدء PixiJS: " + (error instanceof Error ? error.message : "خطأ غير معروف"));
      }
    })();
    return () => {
      cancelled = true;
      setStageReady(false);
      appRef.current = null;
      backgroundRef.current = null;
      characterGraphicRef.current = null;
      characterContainerRef.current = null;
      try { (app as any).destroy(true); } catch {}
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadImage() {
      if (!imageUrl || !stageReady || !characterContainerRef.current) return;
      try {
        const texture = await Assets.load(imageUrl);
        if (cancelled || !characterContainerRef.current) return;
        if (imageSpriteRef.current) {
          characterContainerRef.current.removeChild(imageSpriteRef.current);
          imageSpriteRef.current.destroy({ texture: false });
        }
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = 175;
        sprite.height = 260;
        imageSpriteRef.current = sprite;
        characterContainerRef.current.addChildAt(sprite, 0);
        renderRef.current();
      } catch {
        setStatus("لم أستطع قراءة الصورة؛ جرّب PNG أو SVG.");
      }
    }
    loadImage();
    return () => { cancelled = true; };
  }, [imageUrl, stageReady]);

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setCurrentTime((previous) => {
        const next = previous + 1 / Math.max(12, project.fps);
        if (next >= project.durationSeconds) {
          if (!exportingRef.current) {
            setPlaying(false);
            return 0;
          }
          return project.durationSeconds;
        }
        return next;
      });
    }, 1000 / Math.max(12, project.fps));
    return () => window.clearInterval(interval);
  }, [playing, project.durationSeconds, project.fps]);

  const updateProject = (updater: (current: AnimeProjectDocument) => AnimeProjectDocument) => {
    setProject((current) => updater(current));
  };

  function addKeyframe() {
    const sampled = sampleCharacterKeyframes(project.character.keyframes, currentTime);
    const id = "kf-" + Date.now().toString(36);
    const frame: AnimeKeyframe = {
      id,
      timeSeconds: Number(currentTime.toFixed(3)),
      x: sampled.x,
      y: sampled.y,
      rotation: sampled.rotation,
      scale: sampled.scale,
      opacity: sampled.opacity,
      expression: sampled.expression,
      label: "إطار جديد"
    };
    updateProject((current) => ({
      ...current,
      character: { ...current.character, keyframes: [...current.character.keyframes.filter((item) => Math.abs(item.timeSeconds - frame.timeSeconds) > 0.001), frame].sort((a, b) => a.timeSeconds - b.timeSeconds) }
    }));
    setSelectedKeyframeId(id);
    setStatus("أُضيف إطار مفتاحي عند " + timeLabel(currentTime, project.fps));
  }

  function updateSelectedKeyframe<K extends "x" | "y" | "rotation" | "scale" | "opacity" | "expression">(key: K, value: AnimeKeyframe[K]) {
    if (!selectedKeyframe) return;
    updateProject((current) => ({
      ...current,
      character: {
        ...current.character,
        keyframes: current.character.keyframes.map((frame) => frame.id === selectedKeyframe.id ? ({ ...frame, [key]: value } as AnimeKeyframe) : frame)
      }
    }));
  }

  async function generatePlan() {
    if (!prompt.trim()) {
      setStatus("اكتب وصف الحركة أولاً.");
      return;
    }
    setGenerating(true);
    setStatus("جاري تحويل الوصف إلى مشاهد وإطارات مفتاحية…");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiToken.trim()) headers.authorization = "Bearer " + apiToken.trim();
      const response = await fetch(API + "/api/animation/plan", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: prompt.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "تعذر توليد الخطة");
      const result = data as AnimationPlanResponse;
      updateProject((current) => ({
        ...current,
        name: result.plan.title || current.name,
        fps: result.plan.fps || 24,
        width: result.plan.width || 1080,
        height: result.plan.height || 1920,
        durationSeconds: result.plan.durationSeconds || 8,
        visualStyle: result.plan.visualStyle || current.visualStyle,
        scenes: result.plan.scenes || current.scenes,
        character: { ...current.character, keyframes: result.plan.keyframes || current.character.keyframes }
      }));
      setCurrentTime(0);
      setSelectedKeyframeId(result.plan.keyframes?.[0]?.id || "kf-0");
      setStatus(result.provider === "openai" ? "اكتملت خطة الذكاء الاصطناعي وأصبحت قابلة للتعديل." : "أُنشئت خطة أولية محلياً؛ أضف مفاتيح الخادم لتفعيل التوليد الكامل.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "فشل توليد الخطة.");
    } finally {
      setGenerating(false);
    }
  }

  function handleImportImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setImageName(file.name);
    event.target.value = "";
    setStatus("تم تحميل " + file.name + " للمعاينة؛ صدّر ملف المشروع للاحتفاظ ببنية التحريك.");
  }

  async function handleImportRig(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = importRigDocument(await file.text());
      updateProject((current) => ({
        ...current,
        character: { ...current.character, name: imported.rig.name, rig: imported.rig }
      }));
      setStatus("استوردت هيكل " + imported.format + " الأساسي. " + imported.warnings[0]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "تعذر استيراد الملف.");
    }
    event.target.value = "";
  }

  function exportProject() {
    downloadText("anime-animation-project.json", JSON.stringify(project, null, 2));
    setStatus("تم تصدير بنية المشروع JSON. ملفات الصور الخارجية لا تُضمّن داخل الملف.");
  }

  function exportRig(format: "spine" | "dragonbones") {
    try {
      const result = exportRigDocument(project.character.rig, format);
      downloadText(format === "spine" ? "anime-rig-spine.json" : "anime-rig-dragonbones.json", JSON.stringify(result, null, 2));
      setStatus("تم تصدير الهيكل الأساسي بصيغة " + (format === "spine" ? "Spine JSON" : "DragonBones JSON") + "؛ راجع ملاحظات التوافق داخل الملف.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "فشل تصدير الهيكل.");
    }
  }

  function exportWebM() {
    const canvas = appRef.current?.canvas as HTMLCanvasElement | undefined;
    if (!canvas || typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      setStatus("تسجيل WebM غير مدعوم في هذا المتصفح. جرّب متصفح Chrome حديثاً.");
      return;
    }
    if (project.durationSeconds > 30) {
      setStatus("مدة التصدير في هذا المحرر محدودة بـ30 ثانية.");
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const stream = canvas.captureStream(Math.max(24, project.fps));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      setStatus("تعذر إنشاء مسجل WebM في هذا المتصفح.");
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const chunks: BlobPart[] = [];
    exportingRef.current = true;
    setCurrentTime(0);
    setPlaying(true);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      exportingRef.current = false;
      setPlaying(false);
      setCurrentTime(0);
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "anime-animation-preview.webm";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("اكتمل تصدير WebM من معاينة PixiJS.");
    };
    recorder.start();
    setStatus("يجري تسجيل المعاينة إلى WebM؛ سيستغرق التسجيل مدة المشهد نفسها.");
    window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, project.durationSeconds * 1000 + 150);
  }

  const expressionLabel: Record<AnimeExpression, string> = {
    neutral: "طبيعي",
    happy: "سعيد",
    surprised: "مندهش",
    sad: "حزين",
    determined: "مصمم"
  };

  return (
    <div className="flex h-screen min-h-[620px] flex-col overflow-y-auto bg-[#080d18] text-slate-100">
      <header className="flex min-h-[62px] flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0c1321] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-300"><Film size={21} /></div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Anime Animation Studio</div>
            <div className="text-[11px] text-slate-400">محرك أنيميشن ثنائي الأبعاد • {project.fps} FPS</div>
          </div>
          <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-200">BETA</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"><Upload size={14} /> استيراد صورة</button>
          <button onClick={() => rigInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"><Layers size={14} /> هيكل JSON</button>
          <button onClick={exportProject} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"><Save size={14} /> حفظ JSON</button>
          <button onClick={exportWebM} className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-500 px-3 py-2 text-xs font-semibold text-white hover:bg-fuchsia-400"><Download size={14} /> تصدير WebM</button>
          <input ref={fileInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleImportImage} />
          <input ref={rigInputRef} className="hidden" type="file" accept=".json,application/json" onChange={handleImportRig} />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[218px_minmax(0,1fr)_292px]">
        <aside className="border-b border-white/10 bg-[#0b1220] p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">لوحة المشاهد</span><span className="text-[10px] text-slate-500">{project.scenes.length} مشاهد</span></div>
          <div className="space-y-2">
            {project.scenes.map((scene, index) => (
              <button key={scene.id} onClick={() => setCurrentTime(scene.startSeconds)} className={"w-full rounded-xl border p-3 text-right transition " + (activeScene?.id === scene.id ? "border-fuchsia-400/60 bg-fuchsia-500/10" : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05]")}>
                <div className="mb-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">SHOT {String(index + 1).padStart(2, "0")}</span><span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{scene.durationSeconds.toFixed(1)}ث</span></div>
                <div className="text-xs font-semibold text-slate-100">{scene.title}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400">{scene.action}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">المسارات</div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2"><span className="h-2 w-2 rounded-sm bg-fuchsia-400" /> الشخصية / العظام</div>
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2"><span className="h-2 w-2 rounded-sm bg-cyan-400" /> الكاميرا</div>
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2"><span className="h-2 w-2 rounded-sm bg-amber-300" /> الحوار والصوت</div>
            </div>
            <div className="mt-4 text-[10px] leading-5 text-slate-500">يمكن تعديل الإطارات المفتاحية الآن. العظام المستوردة تُستخدم كبنية أساسية، وتحتاج تفاصيل الأوزان والقيود إلى مراجعة في البرنامج الأصلي.</div>
          </div>
        </aside>

        <section className="flex min-h-[440px] min-w-0 flex-col bg-[#0a1020]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{project.name}</div>
              <div className="mt-1 truncate text-[11px] text-slate-400">{activeScene?.title || "المشهد"} • {activeScene?.camera || "لقطة"} • {imageName || project.character.name}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setCurrentTime(0); setPlaying(false); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5">إعادة</button>
              <button onClick={() => setPlaying((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-white">{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "إيقاف" : "تشغيل"}</button>
              <button onClick={addKeyframe} className="inline-flex items-center gap-2 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-100 hover:bg-fuchsia-500/20"><Plus size={14} /> إطار مفتاحي</button>
            </div>
          </div>
          <div className="relative min-h-[320px] flex-1 p-3 md:p-5">
            <div ref={canvasHostRef} className="h-full min-h-[320px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020]" />
            <div className="pointer-events-none absolute left-7 top-7 rounded-lg border border-white/10 bg-black/35 px-3 py-2 backdrop-blur">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Preview</div>
              <div className="mt-1 text-xs font-medium">{activeScene?.title || "المشهد الحالي"}</div>
            </div>
            <div className="pointer-events-none absolute bottom-7 left-7 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-[11px] text-slate-300 backdrop-blur">
              {timeLabel(currentTime, project.fps)} / {timeLabel(project.durationSeconds, project.fps)}
            </div>
          </div>
          <div className="border-t border-white/10 bg-[#0d1525] px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold"><Layers size={14} className="text-fuchsia-300" /> الخط الزمني</div>
              <div className="text-[11px] tabular-nums text-slate-400">{timeLabel(currentTime, project.fps)}</div>
            </div>
            <input aria-label="موضع التشغيل" type="range" min={0} max={project.durationSeconds} step={1 / project.fps} value={currentTime} onChange={(event) => { setPlaying(false); setCurrentTime(Number(event.target.value)); }} className="mb-3 w-full accent-fuchsia-400" />
            <div className="relative h-[86px] overflow-hidden rounded-lg border border-white/10 bg-[#080d17]">
              <div className="absolute inset-x-0 top-0 flex h-6 border-b border-white/10 text-[9px] text-slate-500">
                {Array.from({ length: Math.min(9, Math.floor(project.durationSeconds) + 1) }, (_, index) => (
                  <div key={index} className="flex-1 border-r border-white/5 pl-1 pt-1">{index}s</div>
                ))}
              </div>
              <div className="absolute inset-x-1 top-7 h-6 rounded bg-cyan-400/10">
                {project.scenes.map((scene) => (
                  <button key={scene.id} title={scene.title} onClick={() => setCurrentTime(scene.startSeconds)} style={{ left: (scene.startSeconds / project.durationSeconds * 100) + "%", width: Math.max(2, scene.durationSeconds / project.durationSeconds * 100) + "%" }} className="absolute top-0 h-full overflow-hidden rounded border border-cyan-300/20 bg-cyan-400/20 px-1 text-left text-[9px] text-cyan-100">{scene.title}</button>
                ))}
              </div>
              <div className="absolute inset-x-1 top-[58px] h-5 rounded bg-fuchsia-400/10">
                {keyframes.map((frame) => (
                  <button key={frame.id} title={frame.label} onClick={() => { setSelectedKeyframeId(frame.id); setCurrentTime(frame.timeSeconds); }} style={{ left: (frame.timeSeconds / project.durationSeconds * 100) + "%" }} className={"absolute top-1 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] border " + (selectedKeyframe?.id === frame.id ? "border-white bg-fuchsia-300" : "border-fuchsia-200/70 bg-fuchsia-500")} />
                ))}
              </div>
              <div style={{ left: (currentTime / project.durationSeconds * 100) + "%" }} className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-amber-300 shadow-[0_0_10px_rgba(253,224,71,.65)]" />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
              <span>{keyframes.length} إطاراً مفتاحياً</span><span>{project.width}×{project.height} • {project.durationSeconds} ثانية • {project.fps}fps</span>
            </div>
          </div>
        </section>

        <aside className="border-t border-white/10 bg-[#0b1220] p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center gap-2"><Sparkles size={17} className="text-fuchsia-300" /><h2 className="text-sm font-semibold">مخرج الأنمي بالذكاء الاصطناعي</h2></div>
          <label className="mb-2 block text-[11px] text-slate-400">صف المشهد والحركة والصوت والجو العام</label>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} maxLength={4000} className="w-full resize-y rounded-xl border border-white/10 bg-[#080d17] p-3 text-xs leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-fuchsia-400/60" placeholder="اكتب وصف الأنمي باللغة العربية..." />
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>{prompt.length}/4000</span><span>حتى 30 ثانية لكل خطة</span></div>
          <label className="mb-2 mt-4 block text-[11px] text-slate-400">رمز الربط (اختياري)</label>
          <input type="password" autoComplete="off" value={apiToken} onChange={(event) => setApiToken(event.target.value)} className="w-full rounded-lg border border-white/10 bg-[#080d17] px-3 py-2.5 text-xs outline-none focus:border-cyan-400/50" placeholder="ANIMATION_API_TOKEN" />
          <div className="mt-2 text-[10px] leading-5 text-slate-500">يُحفظ الرمز في جلسة المتصفح فقط. لا تضع مفتاح OpenAI هنا؛ مكانه متغير بيئة على الخادم.</div>
          <button disabled={generating || !prompt.trim()} onClick={generatePlan} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-3 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
            <Wand2 size={15} /> {generating ? "جاري بناء المشاهد…" : "أنشئ خطة الأنمي"}
          </button>
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-300">حالة المحرك</div>
            <div className="flex items-start gap-2 text-[11px] leading-5 text-slate-400"><Check size={14} className="mt-0.5 shrink-0 text-emerald-300" /><span>{status}</span></div>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">خصائص الإطار</div>
            {selectedKeyframe ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-white/[0.04] px-3 py-2"><div className="text-xs font-semibold">{selectedKeyframe.label}</div><div className="mt-1 text-[10px] text-slate-500">{timeLabel(selectedKeyframe.timeSeconds, project.fps)} • {selectedKeyframe.timeSeconds.toFixed(2)} ثانية</div></div>
                {([
                  ["x", "الموضع X", 0, 100, 1],
                  ["y", "الموضع Y", 0, 100, 1],
                  ["rotation", "الدوران", -180, 180, 1],
                  ["scale", "الحجم", 0.4, 1.6, 0.05],
                  ["opacity", "الشفافية", 0, 1, 0.05]
                ] as const).map(([key, label, min, max, step]) => (
                  <label key={key} className="block">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400"><span>{label}</span><span className="tabular-nums text-slate-200">{Number(selectedKeyframe[key]).toFixed(key === "scale" || key === "opacity" ? 2 : 0)}</span></div>
                    <input type="range" min={min} max={max} step={step} value={selectedKeyframe[key]} onChange={(event) => updateSelectedKeyframe(key, Number(event.target.value))} className="w-full accent-fuchsia-400" />
                  </label>
                ))}
                <label className="block"><span className="mb-1 block text-[11px] text-slate-400">تعبير الوجه</span><select value={selectedKeyframe.expression} onChange={(event) => updateSelectedKeyframe("expression", event.target.value as AnimeExpression)} className="w-full rounded-lg border border-white/10 bg-[#080d17] px-3 py-2 text-xs">{Object.entries({ neutral: "طبيعي", happy: "سعيد", surprised: "مندهش", sad: "حزين", determined: "مصمم" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <button onClick={() => { if (!selectedKeyframe) return; updateProject((current) => ({ ...current, character: { ...current.character, keyframes: current.character.keyframes.filter((frame) => frame.id !== selectedKeyframe.id) } })); setSelectedKeyframeId(""); setStatus("تم حذف الإطار المحدد."); }} disabled={keyframes.length < 3} className="w-full rounded-lg border border-red-400/20 px-3 py-2 text-[11px] text-red-200 hover:bg-red-500/10 disabled:opacity-40">حذف الإطار</button>
              </div>
            ) : <div className="text-xs text-slate-500">اختر إطاراً من الخط الزمني لتعديل الحركة.</div>}
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">تصدير هيكل الشخصية</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => exportRig("spine")} className="rounded-lg border border-white/10 px-2 py-2 text-[10px] hover:bg-white/5">Spine JSON</button>
              <button onClick={() => exportRig("dragonbones")} className="rounded-lg border border-white/10 px-2 py-2 text-[10px] hover:bg-white/5">DragonBones JSON</button>
            </div>
            <div className="mt-2 text-[10px] leading-5 text-slate-500">التبادل الحالي يغطّي الهيكل والعظام والطبقات الأساسية؛ ليس بديلاً عن الـRuntime المرخّص ولا يستعيد جميع خصائص البرامج الأصلية.</div>
          </div>
          <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-[10px] leading-5 text-slate-500"><Film size={13} className="shrink-0" /> لتصدير WebM، يسجّل المتصفح المعاينة في الزمن الحقيقي طوال مدة المشهد.</div>
        </aside>
      </main>
      <footer className="flex min-h-[28px] items-center justify-between gap-3 border-t border-white/10 bg-[#080d17] px-4 py-2 text-[10px] text-slate-500"><span>AI Creative Studio / Anime Animation</span><span>{project.visualStyle}</span></footer>
    </div>
  );
}
