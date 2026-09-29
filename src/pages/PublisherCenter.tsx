import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Instagram,
  Loader2,
  Music2,
  Send,
  Sparkles,
  XCircle,
  Youtube,
} from "lucide-react";

type PublisherStatus = {
  moneyPrinterTurboConfigured: boolean;
  youtubeConfigured: boolean;
  youtubeConnected: boolean;
  channel: { id: string | null; title: string | null } | null;
  redirectUri: string;
};

type SocialStatus = {
  instagram: {
    configured: boolean;
    connected: boolean;
    username: string | null;
    redirectUri: string;
  };
  tiktok: {
    configured: boolean;
    connected: boolean;
    displayName: string | null;
    redirectUri: string;
  };
  veo: {
    configured: boolean;
    model: string;
  };
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
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [subject, setSubject] = useState("");
  const [script, setScript] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [caption, setCaption] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [tiktokPrivacy, setTiktokPrivacy] = useState("SELF_ONLY");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<TaskState | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [veoOperation, setVeoOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [veoBusy, setVeoBusy] = useState(false);
  const [message, setMessage] = useState("");

  const generatedReady = useMemo(() => Boolean(videoUrl), [videoUrl]);

  async function loadStatus() {
    const [p, s] = await Promise.all([
      fetch("/api/publisher/status"),
      fetch("/api/social/status"),
    ]);
    if (!p.ok || !s.ok) throw new Error("تعذر قراءة حالة خدمات النشر");
    setStatus(await p.json());
    setSocial(await s.json());
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
          setMessage("اكتمل إنشاء الفيديو عبر MoneyPrinterTurbo.");
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

  useEffect(() => {
    if (!veoOperation) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/publisher/veo/operation?name=" + encodeURIComponent(veoOperation));
        const data = await response.json();
        if (stopped) return;
        if (data?.done && data.videoUrl) {
          setVideoUrl(String(data.videoUrl));
          setVeoBusy(false);
          setMessage("اكتمل إنشاء الفيديو عبر Veo.");
          return;
        }
        if (data?.error) {
          setVeoBusy(false);
          setMessage(String(data.error?.message || data.error));
          return;
        }
        window.setTimeout(poll, 10000);
      } catch (error) {
        if (!stopped) {
          setVeoBusy(false);
          setMessage(error instanceof Error ? error.message : "تعذر متابعة Veo");
        }
      }
    };
    void poll();
    return () => { stopped = true; };
  }, [veoOperation]);

  async function generateWithMoneyPrinter() {
    if (!subject.trim()) return setMessage("اكتب موضوع الفيديو أولًا.");
    setBusy(true);
    setMessage("");
    setVideoUrl("");
    setPublishedUrl("");
    setTask(null);
    setVeoOperation("");
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
      setMessage("تم إرسال المهمة إلى MoneyPrinterTurbo...");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "فشل إنشاء الفيديو");
    }
  }

  async function generateWithVeo() {
    if (!subject.trim()) return setMessage("اكتب وصف الفيديو أولًا.");
    if (!social?.veo.configured) return setMessage("أضف GEMINI_API_KEY إلى Render أولًا.");
    setVeoBusy(true);
    setBusy(false);
    setMessage("");
    setVideoUrl("");
    setPublishedUrl("");
    setTaskId("");
    try {
      const response = await fetch("/api/publisher/veo/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: subject,
          aspectRatio: "9:16",
          resolution: "720p",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "فشل بدء Veo");
      setVeoOperation(String(data.operationName));
      setMessage("تم بدء Veo 3.1، سيتم تحديث الحالة تلقائيًا.");
    } catch (error) {
      setVeoBusy(false);
      setMessage(error instanceof Error ? error.message : "فشل تشغيل Veo");
    }
  }

  async function uploadYouTube() {
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
      setMessage("تم رفع الفيديو إلى YouTube.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل النشر");
    } finally {
      setBusy(false);
    }
  }

  async function publishInstagram() {
    if (!videoUrl || !social?.instagram.connected) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/instagram/publish-reel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUrl, caption: caption || title || subject, shareToFeed: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "فشل النشر على Instagram");
      setMessage("تم نشر الـReel على Instagram.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل النشر على Instagram");
    } finally {
      setBusy(false);
    }
  }

  async function publishTikTok() {
    if (!videoUrl || !social?.tiktok.connected) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tiktok/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: title || subject,
          caption: caption || title || subject,
          privacyLevel: tiktokPrivacy,
          isAigc: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "فشل النشر على TikTok");
      setMessage(`تم إرسال الفيديو إلى TikTok. حالة النشر: ${data.status || "PROCESSING"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل النشر على TikTok");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 bg-background">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              <h1 className="text-xl font-semibold">مركز التوليد والنشر</h1>
            </div>
            <p className="text-xs text-gray-500 mt-1">MoneyPrinterTurbo + Veo 3.1 + YouTube + Instagram + TikTok</p>
          </div>
          <div className="text-xs text-gray-500 text-right">
            <div>Veo: {social?.veo.model || "غير مضبوط"}</div>
            <div>MoneyPrinterTurbo: {status?.moneyPrinterTurboConfigured ? "جاهز" : "غير مضبوط"}</div>
          </div>
        </header>

        <section className="grid md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border-light bg-panel p-4">
            <div className="flex items-center gap-2 font-semibold"><Youtube className="w-4 h-4" /> YouTube</div>
            <div className="text-xs text-gray-500 mt-2">{status?.youtubeConnected ? (status.channel?.title || "متصل") : "غير متصل"}</div>
            {!status?.youtubeConnected && (
              <button
                onClick={() => { window.location.href = "/api/youtube/oauth/start"; }}
                disabled={!status?.youtubeConfigured || busy}
                className="mt-3 px-3 py-2 rounded-lg border border-border-light bg-btn-bg text-xs font-semibold disabled:opacity-50"
              >
                ربط YouTube
              </button>
            )}
          </div>

          <div className="rounded-xl border border-border-light bg-panel p-4">
            <div className="flex items-center gap-2 font-semibold"><Instagram className="w-4 h-4" /> Instagram</div>
            <div className="text-xs text-gray-500 mt-2">{social?.instagram.connected ? "@" + (social.instagram.username || "متصل") : "غير متصل"}</div>
            {!social?.instagram.connected && (
              <button
                onClick={() => { window.location.href = "/api/instagram/oauth/start"; }}
                disabled={!social?.instagram.configured || busy}
                className="mt-3 px-3 py-2 rounded-lg border border-border-light bg-btn-bg text-xs font-semibold disabled:opacity-50"
              >
                ربط Instagram
              </button>
            )}
          </div>

          <div className="rounded-xl border border-border-light bg-panel p-4">
            <div className="flex items-center gap-2 font-semibold"><Music2 className="w-4 h-4" /> TikTok</div>
            <div className="text-xs text-gray-500 mt-2">{social?.tiktok.connected ? (social.tiktok.displayName || "متصل") : "غير متصل"}</div>
            {!social?.tiktok.connected && (
              <button
                onClick={() => { window.location.href = "/api/tiktok/oauth/start"; }}
                disabled={!social?.tiktok.configured || busy}
                className="mt-3 px-3 py-2 rounded-lg border border-border-light bg-btn-bg text-xs font-semibold disabled:opacity-50"
              >
                ربط TikTok
              </button>
            )}
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-4">
          <section className="lg:col-span-2 rounded-xl border border-border-light bg-panel p-5 space-y-4">
            <div className="flex items-center gap-2 font-semibold"><Sparkles className="w-4 h-4" /> إنشاء فيديو</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثال: فيديو قصير سينمائي عن صنعاء القديمة وقت الغروب" className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm" />
            <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder="السيناريو اختياري لـMoneyPrinterTurbo. وصف Veo يستخدم الحقل السابق." rows={6} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm resize-y" />
            <div className="flex flex-wrap gap-2">
              <button onClick={generateWithMoneyPrinter} disabled={busy || veoBusy || !status?.moneyPrinterTurboConfigured} className="px-4 py-2 rounded-lg bg-text-dark text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                MoneyPrinterTurbo
              </button>
              <button onClick={generateWithVeo} disabled={busy || veoBusy || !social?.veo.configured} className="px-4 py-2 rounded-lg border border-border-light bg-btn-bg text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                {veoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Veo 3.1
              </button>
            </div>

            {task && (
              <div className="text-xs rounded-lg bg-background border border-border-light p-3">
                حالة MoneyPrinterTurbo: <span className="font-semibold">{String(task.state || "processing")}</span>
                {typeof task.progress === "number" && <> • {task.progress}%</>}
              </div>
            )}

            {veoOperation && !videoUrl && (
              <div className="text-xs rounded-lg bg-background border border-border-light p-3">
                حالة Veo: جارٍ إنشاء الفيديو • العملية: {veoOperation.slice(-32)}
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
            <div className="font-semibold">بيانات المنشور</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان" className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف YouTube" rows={5} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm resize-y" />
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption / Hashtags" rows={5} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm resize-y" />

            <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm">
              <option value="private">YouTube: خاص</option>
              <option value="unlisted">YouTube: غير مدرج</option>
              <option value="public">YouTube: عام</option>
            </select>

            <select value={tiktokPrivacy} onChange={(e) => setTiktokPrivacy(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-light bg-background text-sm">
              <option value="SELF_ONLY">TikTok: أنا فقط</option>
              <option value="MUTUAL_FOLLOW_FRIENDS">TikTok: الأصدقاء</option>
              <option value="FOLLOWER_OF_CREATOR">TikTok: المتابعون</option>
              <option value="PUBLIC_TO_EVERYONE">TikTok: الجميع</option>
            </select>

            <div className="grid grid-cols-1 gap-2">
              <button onClick={uploadYouTube} disabled={busy || !generatedReady || !status?.youtubeConnected} className="w-full px-4 py-2 rounded-lg bg-text-dark text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                <Youtube className="w-4 h-4" /> نشر YouTube
              </button>
              <button onClick={publishInstagram} disabled={busy || !generatedReady || !social?.instagram.connected} className="w-full px-4 py-2 rounded-lg border border-border-light bg-btn-bg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                <Instagram className="w-4 h-4" /> نشر Instagram Reel
              </button>
              <button onClick={publishTikTok} disabled={busy || !generatedReady || !social?.tiktok.connected} className="w-full px-4 py-2 rounded-lg border border-border-light bg-btn-bg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                <Music2 className="w-4 h-4" /> نشر TikTok
              </button>
            </div>

            {publishedUrl && (
              <a href={publishedUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-2 underline">
                فتح الفيديو على YouTube <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </aside>
        </div>

        <section className="rounded-xl border border-border-light bg-panel p-5">
          <div className="font-semibold mb-3">حالة التكاملات وروابط OAuth</div>
          <div className="grid md:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-background border border-border-light">
              <div className="font-semibold">Instagram</div>
              <div className="mt-1 text-gray-500">{social?.instagram.configured ? "Client ID/Secret مضبوط" : "ينقص Client ID/Secret"}</div>
              <code className="block mt-2 break-all select-all">{social?.instagram.redirectUri || "..."}</code>
            </div>
            <div className="p-3 rounded-lg bg-background border border-border-light">
              <div className="font-semibold">TikTok</div>
              <div className="mt-1 text-gray-500">{social?.tiktok.configured ? "Client Key/Secret مضبوط" : "ينقص Client Key/Secret"}</div>
              <code className="block mt-2 break-all select-all">{social?.tiktok.redirectUri || "..."}</code>
            </div>
            <div className="p-3 rounded-lg bg-background border border-border-light">
              <div className="font-semibold">Google Veo</div>
              <div className="mt-1 text-gray-500">{social?.veo.configured ? "GEMINI_API_KEY مضبوط" : "ينقص GEMINI_API_KEY"}</div>
              <div className="mt-2">{social?.veo.model || "veo-3.1-fast-generate-preview"}</div>
            </div>
          </div>
        </section>

        {message && (
          <div className="rounded-lg border border-border-light bg-panel p-3 text-sm flex items-center gap-2">
            {message.includes("نجاح") || message.includes("اكتمل") || message.includes("تم ") ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
