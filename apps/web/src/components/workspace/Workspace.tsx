import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { TopToolbar } from './TopToolbar';
import { LeftSidebar } from './LeftSidebar';
import { RightInspector } from './RightInspector';
import { CommandPalette } from './CommandPalette';
import { AIPanel } from '../panels/AIPanel';
import { AssetBrowser } from '../panels/AssetBrowser';
import { BackgroundTasks } from './BackgroundTasks';
import { NotificationCenter } from './NotificationCenter';
import { MvpEditor } from '../mvp/MvpEditor';

export type WorkspaceType = 'video'|'design'|'motion'|'audio'|'presentation'|'image'|'brand'|'ai'|'storyboard';
export type PanelType = 'assets'|'layers'|'properties'|'effects'|'animation'|'audio'|'ai'|'history'|'export'|'templates';
export interface PanelState { id:string; type:PanelType; visible:boolean; width:number; collapsed:boolean; }

export function Workspace() {
  const { projectId = 'new' } = useParams<{ projectId:string }>();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceType>('video');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [assetBrowserOpen, setAssetBrowserOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(300);
  const [leftPanels, setLeftPanels] = useState<PanelState[]>([
    { id:'assets', type:'assets', visible:true, width:280, collapsed:false },
    { id:'layers', type:'layers', visible:true, width:280, collapsed:false },
  ]);
  const [rightPanels, setRightPanels] = useState<PanelState[]>([
    { id:'properties', type:'properties', visible:true, width:300, collapsed:false },
    { id:'effects', type:'effects', visible:true, width:300, collapsed:false },
  ]);

  const handleKeyDown = useCallback((e:KeyboardEvent) => {
    if ((e.metaKey||e.ctrlKey)&&e.key==='k') { e.preventDefault(); setCommandPaletteOpen(prev=>!prev); }
  }, []);
  React.useEffect(()=>{ window.addEventListener('keydown',handleKeyDown); return()=>window.removeEventListener('keydown',handleKeyDown); },[handleKeyDown]);

  return <div className="h-screen w-screen bg-[#0a0a0f] flex flex-col overflow-hidden">
    <TopToolbar activeWorkspace={activeWorkspace} onWorkspaceChange={setActiveWorkspace} onOpenCommandPalette={()=>setCommandPaletteOpen(true)} onOpenAssetBrowser={()=>setAssetBrowserOpen(true)} onToggleAIPanel={()=>setAiPanelOpen(prev=>!prev)} />
    <div className="flex-1 flex overflow-hidden relative">
      <LeftSidebar activeWorkspace={activeWorkspace} panels={leftPanels} onPanelToggle={panelId=>setLeftPanels(prev=>prev.map(p=>p.id===panelId?{...p,visible:!p.visible}:p))} width={sidebarWidth} onResize={setSidebarWidth} />
      <div className="flex-1 min-w-0 overflow-hidden bg-canvas"><MvpEditor projectId={projectId} /></div>
      <RightInspector activeWorkspace={activeWorkspace} panels={rightPanels} onPanelToggle={panelId=>setRightPanels(prev=>prev.map(p=>p.id===panelId?{...p,visible:!p.visible}:p))} width={inspectorWidth} onResize={setInspectorWidth} />
      {aiPanelOpen && <AIPanel onClose={()=>setAiPanelOpen(false)} />}
    </div>
    <BackgroundTasks /><NotificationCenter />
    {commandPaletteOpen && <CommandPalette onClose={()=>setCommandPaletteOpen(false)} />}
    {assetBrowserOpen && <AssetBrowser onClose={()=>setAssetBrowserOpen(false)} />}
  </div>;
}
