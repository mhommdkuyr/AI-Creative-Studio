import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Send, Youtube, WandSparkles, XCircle } from "lucide-react";

type PublisherStatus = {
  moneyPrinterTurboConfigured: boolean;
  youtubeConfigured: boolean;
  youtubeConnected: boolean;
  channel: { id: string | null; title: string | null } | null;
  redirectUri: string;
};

type TaskState = {
  task_id?: string;
  state?: string;
  progress?: number;
  videos?: string[];
  combined_videos?: string[];
  error?: string;
};

export default function PublisherCenter() {
  const [status, setStatus] = useState<PublisherStatus | null>(null);
  const [subject, setSubject] = useState("");
  const [script, setScript] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<TaskState | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const generatedReady = useMemo(() => Boolean(videoUrl), [videoUrl]);

  async function loadStatus() {
    const r = await fetch("/api/publisher/status");
    if (!r.ok) throw new Error("تعذر قراءة حالة النشر");
    setStatus(await r.json());
  }

  useEffect(() => {
    void loadStatus().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة الحالة"));
  }, []);

  useEffect(() => {
    if (!taskId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/publisher/moneyprinter/tasks/" + encodeURIComponent(taskId));
        const data = await response.json();
        if (stopped) return;
        setTask(data);
        const videos = data?.videos || data?.combined_videos || [];
        if (Array.isArray(videos) && videos[0]) {
          setVideoUrl(String(videos[0]));
          setBusy(false);
          setMessage("اكتمل إنشاء الفيديو.");
          return;
        }
        const state = String(data?.state || "").toLowerCase();
        if (["failed", "error", "cancelled"].includes(state)) {
          setBusy(false);
          setMessage(String(data?.error || "فشلت مهمة إنشاء الفيديو."));
          return;
        }
        window.setTimeout(poll, 4000);
      } catch (error) {
        if (!stopped) {
          setBusy(false);
          setMessage(error instanceof Error ? error.message : "تعذر متابعة المهمة");
        }
      }
    };
    void poll();
    return () => { stopped = true; };
  }, [taskId]);

  async function generate() {
    if (!subject.trim()) return setMessage("اكتب موضوع الفيديو أولًا.");
    setBusy(true);
    setMessage("");
    setVideoUrl("");
    setPublishedUrl("");
    setTask(null);
    try {
      const response = await fetch("/api/publisher/moneyprinter/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoSubject: subject,
          videoScript: script,
          videoLanguage: "ar",
          videoAspect: "9:16",
          subtitleEnabled: true,
          videoSource: "pexels",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "فشل إرسال مهمة MoneyPrinterTurbo");
      setTaskId(String(data.taskId));
      setTask(data.task || null);
      setMessage("تم إرسال المهمة، جارٍ انتظار الفيديو...");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "فشل إنشاء الفيديو");
    }
  }

  async function upload() {
    if (!videoUrl) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/publisher/youtube/upload-from-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: title || subject,
          description,
          privacyStatus,
          madeForKids: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "فشل رفع الفيديو إلى YouTube");
      setPublishedUrl(String(data.url || ""));
      setMessage("تم رفع الفيديو بنجاح.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل النشر");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 bg-background">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              <h1 className="text-xl font-semibold">مركز التوليد والنشر</h1>
            </div>
            <p className="text-xs text-gray-500 mt-1">MoneyPrinterTurbo ← فيديو ← YouTube OAuth</p>
          </div>
          {status?.youtubeConnected ? (
            <div className="text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {status.channel?.title || "YouTube متصل"}
            </div>
          ) : (
            <button
              onClick={() => { window.location.href = "/api/youtube/oauth/start"; }}
              disabled={!status?.youtubeConfigured || busy}
              className="px-4 py-2 rounded-lg border border-border-light bg-btn-bg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            >
              <Youtube className="w-4 h-4" /> ربط YouTube
            </button>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <section className="lg:col-span-2 rounded-xl border border-border-light bg-panel p-5 space-y-4">
            <div className="flex items-center gap-2 font-semibold"><WandSparkles className="w-4 h-4" /> إنشاء فيديو</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثال: 5 حقائق عن اليمن في 60 ثانية" className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm" />
            <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder="النص/السيناريو اختياري؛ MoneyPrinterTurbo يستطيع توليده عند تركه فارغًا." rows={7} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm resize-y" />
            <button onClick={generate} disabled={busy || !status?.moneyPrinterTurboConfigured} className="px-4 py-2 rounded-lg bg-text-dark text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              {busy && !generatedReady ? <Loader2 className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}
              إنشاء الفيديو
            </button>
            {task && (
              <div className="text-xs rounded-lg bg-background border border-border-light p-3">
                الحالة: <span className="font-semibold">{String(task.state || "processing")}</span>
                {typeof task.progress === "number" && <> • {task.progress}%</>}
              </div>
            )}
            {generatedReady && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="w-4 h-4" /> الفيديو جاهز</div>
                <video src={videoUrl} controls className="w-full max-h-[420px] rounded-lg border border-border-light bg-black" />
              </div>
            )}
          </section>

          <aside className="rounded-xl border border-border-light bg-panel p-5 space-y-4">
            <div className="font-semibold">النشر على YouTube</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان" className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="الوصف" rows={7} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm resize-y" />
            <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm">
              <option value="private">خاص</option>
              <option value="unlisted">غير مدرج</option>
              <option value="public">عام</option>
            </select>
            <button onClick={upload} disabled={busy || !generatedReady || !status?.youtubeConnected} className="w-full px-4 py-2 rounded-lg bg-text-dark text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              <Send className="w-4 h-4" /> نشر الفيديو
            </button>
            {publishedUrl && (
              <a href={publishedUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-2 underline">
                فتح الفيديو على YouTube <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </aside>
        </div>

        <section className="rounded-xl border border-border-light bg-panel p-5">
          <div className="font-semibold mb-2">حالة الربط</div>
          <div className="grid md:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-background border border-border-light">MoneyPrinterTurbo: {status?.moneyPrinterTurboConfigured ? "جاهز" : "غير مضبوط"}</div>
            <div className="p-3 rounded-lg bg-background border border-border-light">YouTube OAuth: {status?.youtubeConfigured ? "جاهز" : "ينقص Client ID/Secret"}</div>
            <div className="p-3 rounded-lg bg-background border border-border-light">YouTube: {status?.youtubeConnected ? "متصل" : "غير متصل"}</div>
          </div>
          {status?.redirectUri && (
            <div className="mt-4">
              <div className="text-xs text-gray-500 mb-1">رابط إعادة التوجيه المطلوب في Google Cloud</div>
              <code className="block p-3 rounded-lg bg-background border border-border-light text-xs break-all select-all">{status.redirectUri}</code>
            </div>
          )}
        </section>

        {message && (
          <div className="rounded-lg border border-border-light bg-panel p-3 text-sm flex items-center gap-2">
            {message.includes("بنجاح") || message.includes("اكتمل") ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
