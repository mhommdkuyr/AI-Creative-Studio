export type PageId =
  | "dashboard"
  | "projects"
  | "new-project"
  | "workspace"
  | "media"
  | "timeline"
  | "ai-command-center"
  | "ai-workflows"
  | "ai-creation"
  | "video-editing"
  | "audio-editing"
  | "motion-graphics"
  | "vfx"
  | "color-studio"
  | "subtitle-studio"
  | "image-studio"
  | "3d-studio"
  | "animation-studio"
  | "render-center"
  | "export-center"
  | "asset-manager"
  | "template-marketplace"
  | "plugin-center"
  | "cloud"
  | "team-workspace"
  | "history"
  | "notifications"
  | "settings"
  | "developer-mode"
  | "publisher-center";

export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  thumbnail: string;
  aspectRatio: string;
  resolution: string;
  fps: number;
  tags: string[];
  pinned?: boolean;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: "video" | "audio" | "image" | "3d" | "document";
  url?: string;
  size: string;
  duration?: string;
  resolution?: string;
  addedAt: string;
  thumbnail?: string;
}

export interface RenderJob {
  id: string;
  projectName: string;
  format: string;
  resolution: string;
  fps: number;
  progress: number;
  status: "idle" | "rendering" | "completed" | "failed" | "queued";
  eta?: string;
  priority: "low" | "medium" | "high";
  elapsed: string;
  outputPath?: string;
  settings?: Record<string, any>;
}

export interface SystemStats {
  gpuUsage: number;
  gpuTemp: number;
  gpuName: string;
  ramUsage: number; // in GB
  ramMax: number;
  cpuUsage: number;
  cpuTemp: number;
  cloudSync: "synced" | "syncing" | "error";
  aiStatus: "ready" | "thinking" | "idle";
}

export interface PluginItem {
  id: string;
  name: string;
  description: string;
  version: string;
  developer: string;
  author?: string;
  installed: boolean;
  isEnabled?: boolean;
  category: "AI" | "Audio" | "Visual Effects" | "Utilities" | "3D";
  downloads: string;
  rating?: number;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  description: string;
  nodesCount: number;
  lastUsed: string;
  isFavorite?: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  type: "rendering" | "system" | "message" | "warning";
  timestamp: string;
  read: boolean;
}

export interface HistoryItem {
  id: string;
  action: string;
  timestamp: string;
  user: string;
  type: "ui" | "ai" | "edit";
}
