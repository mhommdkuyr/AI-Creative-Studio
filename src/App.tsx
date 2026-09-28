import React, { useState, useEffect } from "react";
import { PageId, Project, MediaAsset, RenderJob, SystemStats } from "./types";
import { 
  initialProjects, 
  initialMedia, 
  initialRenderQueue, 
  initialWorkflows, 
  initialPlugins, 
  initialNotifications, 
  initialHistory 
} from "./mockData";

// Layout components
import Header from "./components/Layout/Header";
import Sidebar from "./components/Layout/Sidebar";
import RightPanel from "./components/Layout/RightPanel";
import StatusBar from "./components/Layout/StatusBar";

// Core views
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import NewProjectWizard from "./pages/NewProjectWizard";
import Workspace from "./pages/Workspace";
import MediaLibrary from "./pages/MediaLibrary";
import TimelinePage from "./pages/TimelinePage";

// AI and Module views
import AICommandCenter from "./pages/AICommandCenter";
import AIWorkflows from "./pages/AIWorkflows";
import AiFirstCreator from "./pages/AiFirstCreator";
import VideoEditing from "./pages/VideoEditing";
import AudioEditing from "./pages/AudioEditing";
import MotionGraphics from "./pages/MotionGraphics";
import VisualEffects from "./pages/VisualEffects";
import ColorStudio from "./pages/ColorStudio";
import SubtitleStudio from "./pages/SubtitleStudio";
import ImageStudio from "./pages/ImageStudio";
import ThreeDStudio from "./pages/ThreeDStudio";
import AnimationStudio from "./pages/AnimationStudio";
import KeyframeStudio from "./pages/KeyframeStudio";
import RenderCenter from "./pages/RenderCenter";
import RenderCenterNew from "./pages/RenderCenterNew";
import ExportCenter from "./pages/ExportCenter";
import AssetManager from "./pages/AssetManager";
import AssetManagerNew from "./pages/AssetManagerNew";
import TemplateMarketplace from "./pages/TemplateMarketplace";
import PluginCenter from "./pages/PluginCenter";

// Newly created utility views
import Cloud from "./pages/Cloud";
import TeamWorkspace from "./pages/TeamWorkspace";
import HistoryPage from "./pages/HistoryPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import DeveloperMode from "./pages/DeveloperMode";
import PublisherCenter from "./pages/PublisherCenter";

export default function App() {
  // Navigation & UI Layout state
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // App Data state
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [currentProject, setCurrentProject] = useState<Project>(initialProjects[0]);
  const [mediaLibrary, setMediaLibrary] = useState<MediaAsset[]>(initialMedia);
  const [renderQueue, setRenderQueue] = useState<RenderJob[]>(initialRenderQueue);
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [pluginsList, setPluginsList] = useState(initialPlugins);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [projectHistory, setProjectHistory] = useState(initialHistory);

  // Real-time fluctuating System Diagnostics
  const [stats, setStats] = useState<SystemStats>({
    gpuUsage: 34,
    gpuTemp: 62,
    gpuName: "NVIDIA RTX 6000 Ada",
    ramUsage: 12.4,
    ramMax: 64,
    cpuUsage: 18,
    cpuTemp: 45,
    cloudSync: "synced",
    aiStatus: "ready"
  });

  // Keyboard shortcut listener for Developer Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl + Shift + D
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setActivePage("developer-mode");
        console.log("[DeveloperMode] Keyboard shortcut triggered console activation.");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Background fluctuation simulation
  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuate CPU/GPU slightly
      setStats(prev => {
        const randGpu = Math.min(98, Math.max(10, prev.gpuUsage + (Math.random() > 0.5 ? 2 : -2)));
        const randCpu = Math.min(95, Math.max(5, prev.cpuUsage + (Math.random() > 0.5 ? 3 : -3)));
        const randGpuTemp = Math.min(85, Math.max(50, prev.gpuTemp + (Math.random() > 0.5 ? 1 : -1)));
        const randCpuTemp = Math.min(80, Math.max(40, prev.cpuTemp + (Math.random() > 0.5 ? 1 : -1)));
        return {
          ...prev,
          gpuUsage: randGpu,
          gpuTemp: randGpuTemp,
          cpuUsage: randCpu,
          cpuTemp: randCpuTemp
        };
      });

      // Advance rendering queue job progression
      setRenderQueue(prevJobs => {
        return prevJobs.map(job => {
          if (job.status === "rendering") {
            const nextProg = job.progress + 1;
            if (nextProg >= 100) {
              // Add a new completed notification
              setNotifications(prevNotifs => [
                {
                  id: "n_" + Date.now(),
                  title: "Render Job Complete!",
                  description: `Replication of ${job.projectName} finished compiling successfully.`,
                  type: "rendering",
                  timestamp: "Just now",
                  read: false
                },
                ...prevNotifs
              ]);
              return {
                ...job,
                progress: 100,
                status: "completed",
                eta: "0s"
              };
            }
            return {
              ...job,
              progress: nextProg,
              eta: `${Math.max(1, 120 - nextProg)}s`
            };
          }
          return job;
        });
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Handler functions
  const handleSelectProject = (proj: Project) => {
    setCurrentProject(proj);
    setActivePage("workspace");
    // Add history log entry
    setProjectHistory(prev => [
      {
        id: "hist_" + Date.now(),
        action: `Switched active workspace to: ${proj.name}`,
        timestamp: "Just now",
        user: "You",
        type: "ui"
      },
      ...prev
    ]);
  };

  const handleCreateProject = (newProj: Project) => {
    setProjects(prev => [newProj, ...prev]);
    setCurrentProject(newProj);
    setActivePage("workspace");
    // Add history entry
    setProjectHistory(prev => [
      {
        id: "hist_" + Date.now(),
        action: `Created new project setup: ${newProj.name}`,
        timestamp: "Just now",
        user: "You",
        type: "ui"
      },
      ...prev
    ]);
  };

  const handleUploadMedia = (asset: MediaAsset) => {
    setMediaLibrary(prev => [asset, ...prev]);
    setProjectHistory(prev => [
      {
        id: "hist_" + Date.now(),
        action: `Uploaded asset: ${asset.name}`,
        timestamp: "Just now",
        user: "You",
        type: "edit"
      },
      ...prev
    ]);
  };

  const handleDeleteMedia = (id: string) => {
    setMediaLibrary(prev => prev.filter(m => m.id !== id));
  };

  const handleAddRenderJob = (job: RenderJob) => {
    setRenderQueue(prev => [job, ...prev]);
  };

  const handleMarkNotificationRead = (id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleClearNotifications = () => {
    setNotifications([]);
  };

  const handleRevertHistory = (actionDesc: string) => {
    // Simulate reverting active page preferences
    setProjectHistory(prev => [
      {
        id: "hist_" + Date.now(),
        action: `Reverted workspace back to checkpoint: ${actionDesc}`,
        timestamp: "Just now",
        user: "You",
        type: "ui"
      },
      ...prev
    ]);
  };

  const handleDuplicateProject = (proj: Project) => {
    const dupProj: Project = {
      ...proj,
      id: "proj_" + Date.now(),
      name: `${proj.name} (Copy)`,
      updatedAt: "Just now"
    };
    setProjects(prev => [...prev, dupProj]);
  };

  const handleTogglePinProject = (id: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, pinned: !p.pinned } : p));
  };

  const handleToggleWorkflowFavorite = (id: string) => {
    setWorkflows(prev => prev.map(w => w.id === id ? { ...w, isFavorite: !w.isFavorite } : w));
  };

  const handleRunWorkflow = (name: string) => {
    setProjectHistory(prev => [
      {
        id: "hist_" + Date.now(),
        action: `Executed AI Workflow: ${name}`,
        timestamp: "Just now",
        user: "You",
        type: "ai"
      },
      ...prev
    ]);
  };

  const handleAddWorkflow = (flow: any) => {
    setWorkflows(prev => [...prev, flow]);
  };

  const handleExportRenderJob = (job: { name: string; format: string; resolution: string }) => {
    const fullJob: RenderJob = {
      id: "render_" + Date.now(),
      projectName: job.name,
      format: job.format,
      resolution: job.resolution,
      fps: 24,
      progress: 0,
      status: "idle",
      priority: "high",
      elapsed: "00m 00s"
    };
    setRenderQueue(prev => [fullJob, ...prev]);
  };

  // Switcher rendering each page component beautifully
  const renderActiveScreen = () => {
    switch (activePage) {
      case "dashboard":
        return (
          <Dashboard 
            projects={projects} 
            onSelectProject={handleSelectProject} 
            onNavigate={setActivePage} 
          />
        );
      case "projects":
        return (
          <Projects 
            projects={projects} 
            onSelectProject={handleSelectProject} 
            onNavigate={setActivePage} 
            onDeleteProject={(id) => setProjects(prev => prev.filter(p => p.id !== id))}
            onDuplicateProject={handleDuplicateProject}
            onTogglePinProject={handleTogglePinProject}
          />
        );
      case "new-project":
        return (
          <NewProjectWizard 
            onCreateProject={handleCreateProject} 
            onNavigate={setActivePage} 
          />
        );
      case "workspace":
        return (
          <Workspace 
            onNavigate={setActivePage} 
            projectName={currentProject.name}
          />
        );
      case "media":
        return (
          <MediaLibrary 
            media={mediaLibrary} 
            onNavigate={setActivePage}
            onAddMedia={handleUploadMedia} 
            onDeleteMedia={handleDeleteMedia} 
          />
        );
      case "timeline":
        return (
          <TimelinePage
            onNavigate={setActivePage}
            projectName={currentProject.name}
          />
        );
      case "ai-command-center":
        return <AICommandCenter onNavigate={setActivePage} />;
      case "ai-workflows":
        return (
          <AIWorkflows 
            workflows={workflows}
            onToggleFavorite={handleToggleWorkflowFavorite}
            onRunWorkflow={handleRunWorkflow}
            onAddWorkflow={handleAddWorkflow}
          />
        );
      case "ai-creation":
        return <AiFirstCreator onNavigate={setActivePage} />;
      case "video-editing":
        return <VideoEditing onNavigate={setActivePage} />;
      case "audio-editing":
        return <AudioEditing onNavigate={setActivePage} />;
      case "motion-graphics":
        return <MotionGraphics onNavigate={setActivePage} />;
      case "vfx":
        return <VisualEffects onNavigate={setActivePage} />;
      case "color-studio":
        return <ColorStudio onNavigate={setActivePage} />;
      case "subtitle-studio":
        return <SubtitleStudio onNavigate={setActivePage} />;
      case "image-studio":
        return <ImageStudio onNavigate={setActivePage} />;
      case "3d-studio":
        return <ThreeDStudio onNavigate={setActivePage} />;
      case "animation-studio":
        return <AnimationStudio onNavigate={setActivePage} />;
      case "keyframe-studio":
        return <KeyframeStudio onNavigate={setActivePage} />;
      case "render-center":
        return (
          <RenderCenterNew
            onNavigate={setActivePage}
            renderQueue={renderQueue}
            setRenderQueue={setRenderQueue}
          />
        );
      case "export-center":
        return (
          <ExportCenter 
            onNavigate={setActivePage} 
            onAddRenderJob={handleExportRenderJob} 
          />
        );
      case "asset-manager":
        return (
          <AssetManagerNew
            mediaLibrary={mediaLibrary}
            onUploadMedia={handleUploadMedia}
            onDeleteMedia={handleDeleteMedia}
            onNavigate={setActivePage}
          />
        );
      case "template-marketplace":
        return <TemplateMarketplace />;
      case "plugin-center":
        return (
          <PluginCenter 
            pluginsList={pluginsList}
            onTogglePlugin={(id) => setPluginsList(prev => prev.map(p => p.id === id ? { ...p, installed: !p.installed, isEnabled: !p.isEnabled } : p))}
          />
        );
      case "cloud":
        return <Cloud />;
      case "team-workspace":
        return <TeamWorkspace />;
      case "history":
        return (
          <HistoryPage 
            projectHistory={projectHistory} 
            onRevertHistory={handleRevertHistory} 
          />
        );
      case "notifications":
        return (
          <NotificationsPage 
            notifications={notifications} 
            onMarkRead={handleMarkNotificationRead} 
            onClearAll={handleClearNotifications} 
          />
        );
      case "settings":
        return <SettingsPage />;
      case "developer-mode":
        return <DeveloperMode />;
      case "publisher-center":
        return <PublisherCenter />;
      default:
        return (
          <div className="p-8 text-center text-gray-500 font-semibold font-mono">
            Module loading under secure development...
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden font-sans select-none">
      {/* Top Header */}
      <Header 
        currentProjectName={currentProject.name} 
        onNavigate={setActivePage} 
        activePage={activePage} 
        stats={stats} 
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)} 
        isRightPanelOpen={isRightPanelOpen} 
      />

      {/* Main split */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar */}
        <Sidebar 
          activePage={activePage} 
          onNavigate={setActivePage} 
          isCollapsed={isSidebarCollapsed} 
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
        />

        {/* Workspace Canvas view */}
        <main className="flex-1 min-w-0 bg-panel border-r border-border-light flex flex-col overflow-y-auto no-scrollbar relative">
          {renderActiveScreen()}
        </main>

        {/* Right contextual inspector */}
        {isRightPanelOpen && (
          <RightPanel 
            activePage={activePage} 
            projectName={currentProject.name} 
          />
        )}
      </div>

      {/* Status Bar */}
      <StatusBar 
        stats={stats} 
        currentProjectName={currentProject.name} 
        onNavigate={setActivePage} 
        renderQueue={renderQueue} 
      />
    </div>
  );
}
