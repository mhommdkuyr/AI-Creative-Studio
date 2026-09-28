import React, { useState } from "react";
import { 
  LayoutDashboard, 
  FolderKanban, 
  Milestone, 
  FolderOpen, 
  SlidersHorizontal, 
  Sparkles, 
  Workflow, 
  Scissors, 
  Music, 
  Video, 
  Zap, 
  Palette, 
  Languages, 
  Image, 
  Box, 
  Activity, 
  Cpu, 
  Download, 
  Files, 
  ShoppingBag, 
  Grid, 
  Cloud, 
  Users, 
  Clock, 
  Bell, 
  Settings,
  Send,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { PageId } from "../../types";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface SidebarItem {
  id: PageId;
  label: string;
  icon: React.ComponentType<any>;
}

interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

export default function Sidebar({
  activePage,
  onNavigate,
  isCollapsed,
  onToggleCollapse
}: SidebarProps) {
  // Categorize our 27 pages into clean, professional groups
  const sections: SidebarSection[] = [
    {
      title: "Workspace Core",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "projects", label: "Projects Control", icon: FolderKanban },
        { id: "new-project", label: "New Project Setup", icon: Milestone },
        { id: "workspace", label: "Studio Editor", icon: Grid },
        { id: "media", label: "Media Library", icon: FolderOpen },
        { id: "timeline", label: "Multi-Track Timeline", icon: SlidersHorizontal },
      ]
    },
    {
      title: "AI Co-Creation",
      items: [
        { id: "ai-creation", label: "AI Creative Studio", icon: Sparkles },
        { id: "ai-command-center", label: "AI Command Center", icon: Sparkles },
        { id: "ai-workflows", label: "AI Workflows", icon: Workflow },
      ]
    },
    {
      title: "Studio Modules",
      items: [
        { id: "video-editing", label: "Video Editing", icon: Scissors },
        { id: "audio-editing", label: "Audio Mastering", icon: Music },
        { id: "motion-graphics", label: "Motion Graphics", icon: Video },
        { id: "vfx", label: "Visual Effects VFX", icon: Zap },
        { id: "color-studio", label: "Color Grading Wheels", icon: Palette },
        { id: "subtitle-studio", label: "Subtitle Studio", icon: Languages },
        { id: "image-studio", label: "Image Studio AI", icon: Image },
        { id: "3d-studio", label: "3D Space Studio", icon: Box },
        { id: "animation-studio", label: "Rigging & Physics", icon: Activity },
      ]
    },
    {
      title: "Assets & Outputs",
      items: [
        { id: "render-center", label: "Render Queue", icon: Cpu },
        { id: "export-center", label: "Export Presets", icon: Download },
        { id: "publisher-center", label: "Publish Center", icon: Send },
        { id: "asset-manager", label: "Asset Manager", icon: Files },
        { id: "template-marketplace", label: "Templates Store", icon: ShoppingBag },
        { id: "plugin-center", label: "Plugins Store", icon: Settings },
      ]
    },
    {
      title: "System Control",
      items: [
        { id: "cloud", label: "Cloud Workspace", icon: Cloud },
        { id: "team-workspace", label: "Team Spaces", icon: Users },
        { id: "history", label: "Project History", icon: Clock },
        { id: "notifications", label: "Studio Alerts", icon: Bell },
        { id: "settings", label: "Studio Preferences", icon: Settings },
      ]
    }
  ];

  return (
    <aside 
      className={`bg-panel border-r border-border-light flex flex-col justify-between select-none shrink-0 transition-all duration-300 ${
        isCollapsed ? "w-14" : "w-[240px]"
      }`}
    >
      {/* Scrollable menu contents */}
      <div className="flex-1 overflow-y-auto no-scrollbar py-2">
        {sections.map((section, secIdx) => (
          <div key={secIdx} className="mb-4">
            {/* Section Header */}
            {!isCollapsed && (
              <span className="text-[10px] font-bold text-gray-500 font-sans tracking-wider uppercase px-4 block mb-1">
                {section.title}
              </span>
            )}

            {/* Section Items */}
            <div className="space-y-[2px] px-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    title={isCollapsed ? item.label : ""}
                    className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium tracking-tight text-left transition-all group cursor-pointer ${
                      isActive 
                        ? "bg-btn-bg text-text-dark font-semibold border border-border-light shadow-xs" 
                        : "text-gray-600 hover:text-text-dark hover:bg-btn-bg/50"
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                      isActive ? "text-text-dark" : "text-gray-500 group-hover:text-text-dark"
                    }`} />
                    {!isCollapsed && (
                      <span className="truncate flex-1">{item.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {secIdx < sections.length - 1 && (
              <div className="mx-4 my-2 border-b border-border-light/40" />
            )}
          </div>
        ))}
      </div>

      {/* Collapse Trigger Footer */}
      <div className="h-12 border-t border-border-light px-3 flex items-center justify-between shrink-0 bg-panel/70">
        {!isCollapsed && (
          <span 
            onDoubleClick={() => onNavigate("developer-mode")}
            id="span_sidebar_version"
            title="Double-click to open Developer Console"
            className="text-[10px] font-mono text-gray-400 cursor-pointer hover:text-gray-600 transition-colors select-none"
          >
            v1.0.0 Stable
          </span>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 hover:bg-btn-bg rounded-md border border-transparent hover:border-border-light transition-all cursor-pointer text-gray-600"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          ) : (
            <div className="flex items-center space-x-1">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
              <span className="text-[10px] font-sans text-gray-500 font-medium">Collapse</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
