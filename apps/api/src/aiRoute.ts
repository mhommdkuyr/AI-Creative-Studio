import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { applyOperations } from './editingEngine.js';
import { planWithOpenAI } from './aiProvider.js';

export function registerAIRoute(app: Express, db: Database.Database) {
  const runPlan = async (projectId: string, text: string) => {
    const p: any = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!p) throw new Error('Project not found');
    const timeline = JSON.parse(p.timeline_json);
    const plan = await planWithOpenAI(text, timeline);
    const next = applyOperations(timeline, plan.operations);
    const changed = JSON.stringify(next) !== JSON.stringify(timeline);
    if (changed) {
      const history = JSON.parse(p.history_json).slice(0, Number(p.history_index) + 1);
      history.push(next);
      const bounded = history.slice(-100);
      db.prepare('UPDATE projects SET timeline_json=?,history_json=?,history_index=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(next), JSON.stringify(bounded), bounded.length - 1, new Date().toISOString(), projectId);
    }
    return { timeline: changed ? next : timeline, plan, changed };
  };

  app.post('/api/projects/:id/ai-command', async (req, res) => {
    const projectId = String(req.params.id);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Command text is required' });
    try {
      const result = await runPlan(projectId, text);
      const first = result.plan.operations.find((operation: any) => operation.op !== 'noop');
      res.json({ provider: process.env.OPENAI_API_KEY ? 'openai' : 'local', command: first ? { type: first.op, message: result.plan.summary, ...first } : { type: 'noop', message: result.plan.summary }, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI command failed';
      res.status(message === 'Project not found' ? 404 : 500).json({ error: message });
    }
  });

  app.post('/api/projects/:id/ai-plan', async (req, res) => {
    const projectId = String(req.params.id);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Command text is required' });
    const p: any = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    try {
      const timeline = JSON.parse(p.timeline_json);
      const plan = await planWithOpenAI(text, timeline);
      res.json({ provider: process.env.OPENAI_API_KEY ? 'openai' : 'local', plan, dryRun: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'AI planning failed' });
    }
  });
}
