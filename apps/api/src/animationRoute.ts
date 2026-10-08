import { timingSafeEqual } from "node:crypto";

type AnimeExpression = "neutral" | "happy" | "surprised" | "sad" | "determined";
type Plan = {
  title: string;
  logline: string;
  visualStyle: string;
  fps: number;
  width: number;
  height: number;
  durationSeconds: number;
  scenes: Array<{ id: string; title: string; startSeconds: number; durationSeconds: number; setting: string; action: string; dialogue: string; camera: string; mood: string }>;
  keyframes: Array<{ id: string; timeSeconds: number; x: number; y: number; rotation: number; scale: number; opacity: number; expression: AnimeExpression; label: string }>;
};

const EXPRESSIONS = new Set<AnimeExpression>(["neutral", "happy", "surprised", "sad", "determined"]);
const PLAN_TOOL = {
  type: "function",
  name: "create_anime_plan",
  description: "Create a production-oriented 2D anime shot plan with scenes and timed transform/expression keyframes. Keep the design suitable for a browser-based skeletal/vector editor.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title", "logline", "visualStyle", "fps", "width", "height", "durationSeconds", "scenes", "keyframes"],
    properties: {
      title: { type: "string" },
      logline: { type: "string" },
      visualStyle: { type: "string" },
      fps: { type: "integer", enum: [12, 24, 30] },
      width: { type: "integer", enum: [720, 1080, 1920] },
      height: { type: "integer", enum: [720, 1080, 1920] },
      durationSeconds: { type: "number" },
      scenes: {
        type: "array", minItems: 1, maxItems: 8,
        items: {
          type: "object", additionalProperties: false,
          required: ["title", "startSeconds", "durationSeconds", "setting", "action", "dialogue", "camera", "mood"],
          properties: {
            title: { type: "string" }, startSeconds: { type: "number" }, durationSeconds: { type: "number" },
            setting: { type: "string" }, action: { type: "string" }, dialogue: { type: "string" },
            camera: { type: "string" }, mood: { type: "string" }
          }
        }
      },
      keyframes: {
        type: "array", minItems: 2, maxItems: 60,
        items: {
          type: "object", additionalProperties: false,
          required: ["timeSeconds", "x", "y", "rotation", "scale", "opacity", "expression", "label"],
          properties: {
            timeSeconds: { type: "number" }, x: { type: "number" }, y: { type: "number" },
            rotation: { type: "number" }, scale: { type: "number" }, opacity: { type: "number" },
            expression: { type: "string", enum: ["neutral", "happy", "surprised", "sad", "determined"] },
            label: { type: "string" }
          }
        }
      }
    }
  }
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function localPlan(prompt: string): Plan {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const wantsJump = /قفز|يقفز|ينط|jump|leap/.test(lower);
  const wantsRun = /يجري|يركض|ركض|run|running/.test(lower);
  const movement = wantsRun ? "ينطلق البطل في ركضة قصيرة ثم يتوقف بثقة" : wantsJump ? "يقفز البطل بحيوية ويهبط بتوازن" : "يلتفت البطل، يكتشف شيئاً مضيئاً، ثم يلوّح للمشاهد";
  const title = text.length > 54 ? text.slice(0, 51) + "..." : text || "بداية مغامرة أنمي";
  return {
    title,
    logline: "خطة حركة أولية قابلة للتعديل، بانتظار توصيل مزود الذكاء الاصطناعي.",
    visualStyle: "أنمي ثنائي الأبعاد، خطوط نظيفة، ألوان سينمائية، تعبيرات وجه واضحة",
    fps: 24, width: 1080, height: 1920, durationSeconds: 8,
    scenes: [
      { id: "scene-1", title: "تمهيد", startSeconds: 0, durationSeconds: 2, setting: "شارع ياباني هادئ وقت الغروب", action: "لقطة تأسيسية مع حركة ضوء خفيفة", dialogue: "", camera: "اقتراب سينمائي بطيء", mood: "فضولي" },
      { id: "scene-2", title: "الحركة الرئيسية", startSeconds: 2, durationSeconds: 4, setting: "انعكاس ضوء أزرق وذهبي على الخلفية", action: movement, dialogue: "", camera: "تتبع جانبي ناعم", mood: wantsJump ? "مرح ومفاجئ" : "مغامر" },
      { id: "scene-3", title: "الخاتمة", startSeconds: 6, durationSeconds: 2, setting: "وهج دافئ مع مساحة عنوان فارغة", action: "وقفة ختامية وابتسامة نحو الكاميرا", dialogue: "", camera: "تثبيت مع تقريب بسيط", mood: "متفائل" }
    ],
    keyframes: [
      { id: "kf-0", timeSeconds: 0, x: 50, y: 58, rotation: 0, scale: 1, opacity: 1, expression: "neutral", label: "وقفة البداية" },
      { id: "kf-1", timeSeconds: 1.5, x: 50, y: 56, rotation: -6, scale: 1.02, opacity: 1, expression: "surprised", label: "يلتفت" },
      { id: "kf-2", timeSeconds: 2.4, x: wantsRun ? 65 : 54, y: wantsJump ? 43 : 54, rotation: wantsRun ? 9 : 4, scale: 1.06, opacity: 1, expression: "happy", label: wantsRun ? "انطلاق" : wantsJump ? "قفزة" : "اكتشاف" },
      { id: "kf-3", timeSeconds: 3.2, x: wantsRun ? 73 : 55, y: 58, rotation: 0, scale: 1, opacity: 1, expression: "determined", label: "هبوط/استقرار" },
      { id: "kf-4", timeSeconds: 5.4, x: 64, y: 57, rotation: -4, scale: 1.02, opacity: 1, expression: "happy", label: "التفاعل" },
      { id: "kf-5", timeSeconds: 8, x: 62, y: 58, rotation: 0, scale: 1, opacity: 1, expression: "happy", label: "الخاتمة" }
    ]
  };
}

function normalizePlan(raw: any, prompt: string): Plan {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.scenes) || !Array.isArray(raw.keyframes) || raw.keyframes.length < 2) {
    return localPlan(prompt);
  }
  const durationSeconds = bounded(raw.durationSeconds, 8, 2, 30);
  const scenes = raw.scenes.slice(0, 8).map((scene: any, index: number) => ({
    id: "scene-" + (index + 1),
    title: String(scene.title || ("مشهد " + (index + 1))).slice(0, 100),
    startSeconds: bounded(scene.startSeconds, index * durationSeconds / Math.max(1, raw.scenes.length), 0, durationSeconds),
    durationSeconds: bounded(scene.durationSeconds, durationSeconds / Math.max(1, raw.scenes.length), 0.25, durationSeconds),
    setting: String(scene.setting || "خلفية أنمي").slice(0, 500),
    action: String(scene.action || "حركة بسيطة").slice(0, 1000),
    dialogue: String(scene.dialogue || "").slice(0, 500),
    camera: String(scene.camera || "لقطة ثابتة").slice(0, 120),
    mood: String(scene.mood || "متوازن").slice(0, 120)
  })).sort((a: any, b: any) => a.startSeconds - b.startSeconds);
  const keyframes = raw.keyframes.slice(0, 60).map((frame: any, index: number) => ({
    id: "ai-kf-" + (index + 1),
    timeSeconds: bounded(frame.timeSeconds, index * durationSeconds / Math.max(1, raw.keyframes.length - 1), 0, durationSeconds),
    x: bounded(frame.x, 50, 0, 100),
    y: bounded(frame.y, 55, 0, 100),
    rotation: bounded(frame.rotation, 0, -180, 180),
    scale: bounded(frame.scale, 1, 0.2, 4),
    opacity: bounded(frame.opacity, 1, 0, 1),
    expression: EXPRESSIONS.has(frame.expression) ? frame.expression as AnimeExpression : "neutral",
    label: String(frame.label || ("إطار " + (index + 1))).slice(0, 100)
  })).sort((a: any, b: any) => a.timeSeconds - b.timeSeconds);
  return {
    title: String(raw.title || "مشروع أنمي جديد").slice(0, 120),
    logline: String(raw.logline || "").slice(0, 800),
    visualStyle: String(raw.visualStyle || "أنمي ثنائي الأبعاد").slice(0, 500),
    fps: [12, 24, 30].includes(Number(raw.fps)) ? Number(raw.fps) : 24,
    width: [720, 1080, 1920].includes(Number(raw.width)) ? Number(raw.width) : 1080,
    height: [720, 1080, 1920].includes(Number(raw.height)) ? Number(raw.height) : 1920,
    durationSeconds, scenes, keyframes
  };
}

function authorized(req: any, res: any): boolean {
  const required = process.env.ANIMATION_API_TOKEN;
  if (required) {
    const header = String(req.headers.authorization || "");
    const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
    const a = Buffer.from(supplied);
    const b = Buffer.from(required);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Unauthorized", code: "ANIMATION_TOKEN_INVALID" });
      return false;
    }
  } else if (process.env.NODE_ENV === "production" && process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "Configure ANIMATION_API_TOKEN before enabling paid animation generation.", code: "ANIMATION_TOKEN_NOT_CONFIGURED" });
    return false;
  }
  return true;
}

async function generateWithOpenAI(prompt: string): Promise<Plan | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.ANIMATION_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-sol";
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: "أنت مخرج أنمي ومشرف تحريك ثنائي الأبعاد. حوّل وصف المستخدم إلى خطة تنفيذ واضحة: مشاهد زمنية، حركة كاميرا، فعل الشخصية، حوار اختياري، وإطارات مفتاحية. استخدم إحداثيات x وy من 0 إلى 100، واجعل الوقت بالثواني. لا تنشئ أسماء شخصيات مشهورة أو تنسخ مشهداً محمياً حرفياً. اجعل المدة بين ثانيتين و30 ثانية، واحتفظ بتعبيرات الوجه ضمن القيم المحددة." }] },
          { role: "user", content: [{ type: "input_text", text: "وصف الأنمي: " + prompt }] }
        ],
        tools: [PLAN_TOOL],
        tool_choice: { type: "function", name: "create_anime_plan" }
      })
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const call = (data.output || []).find((item: any) => item.type === "function_call" && item.name === "create_anime_plan");
    if (!call) return null;
    return normalizePlan(JSON.parse(call.arguments || "{}"), prompt);
  } catch {
    return null;
  }
}

export function registerAnimationRoute(app: any): void {
  app.get("/api/animation/health", (_req: any, res: any) => {
    res.json({
      ok: true,
      engine: "PixiJS + Anime Animation Studio",
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      tokenRequired: Boolean(process.env.ANIMATION_API_TOKEN),
      localPlannerAvailable: true,
      features: ["storyboard", "keyframes", "spine-json-basic", "dragonbones-json-basic", "webm-browser-export"]
    });
  });

  app.post("/api/animation/plan", async (req: any, res: any) => {
    if (!authorized(req, res)) return;
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "اكتب وصفاً للأنمي أولاً.", code: "PROMPT_REQUIRED" });
    if (prompt.length > 4000) return res.status(413).json({ error: "الوصف طويل جداً؛ الحد الأقصى 4000 حرف.", code: "PROMPT_TOO_LONG" });
    let plan: Plan;
    let provider: "chatgpt" | "openai" | "local";
    let note: string;
    if (req.body?.plan && typeof req.body.plan === "object") {
      plan = normalizePlan(req.body.plan, prompt);
      provider = "chatgpt";
      note = "تم التحقق من الخطة التي أرسلها عميل ChatGPT وتحويلها إلى صيغة المحرك.";
    } else {
      const aiPlan = await generateWithOpenAI(prompt);
      plan = aiPlan || localPlan(prompt);
      provider = aiPlan ? "openai" : "local";
      note = aiPlan
        ? "تم إنشاء خطة التحريك بواسطة مزود الذكاء الاصطناعي على الخادم."
        : "خطة بداية محلية؛ يمكنك إرسال plan منظّم من ChatGPT أو ضبط OPENAI_API_KEY على الخادم.";
    }
    const editorOrigin = (process.env.ANIMATION_EDITOR_URL || "https://anime-animation-studio-web.onrender.com").replace(/\/+$/, "");
    const encodedPlan = Buffer.from(JSON.stringify(plan), "utf8").toString("base64url");
    const editorUrl = editorOrigin + "/animation#ai-anime-plan=" + encodedPlan;
    res.json({ ok: true, provider, note, plan, editorUrl });
  });
}
