import type { MentorMode, MentorNextAction, MentorPlanItem } from './contract';
import type { ToolResult } from './seam';

const EXAMS = new Set(['kenntnispruefung','kmp_innsbruck','pharma']);
/**
 * Only typed code-owned routes; no model-authored URLs. `lang` is the UI
 * language: the exam calendar renders German or English only, so every non-de
 * learner gets ?lang=en up front (otherwise its language sync replaces the URL
 * and drops from=mentor).
 */
export function actionHref(a: MentorNextAction, lang?: string): string {
  const params = new URLSearchParams({ from: 'mentor' });
  if (a.topic) params.set('topic',a.topic);
  if (a.exam_source && EXAMS.has(a.exam_source)) params.set('examSource',a.exam_source);
  const route = {
    practice_topic:'/quiz', open_question:'/quiz', save_note:'/library', open_flashcards:'/flashcards',
    open_mistakes:'/mistakes', open_exam_dates:'/pruefungskalender', open_study_plan:'/study-plan', set_exam_date:'/study-plan', deadline_reminder:'/mentor',
  }[a.kind];
  if (a.kind === 'open_question' && a.question_id) params.set('questionId',String(a.question_id));
  if (a.kind === 'open_exam_dates' && lang && lang !== 'de') params.set('lang','en');
  return `${route}?${params}`;
}
export function planItemsFromTool(result: ToolResult): MentorPlanItem[] {
  if (result.isError) return [];
  try {
    const data = JSON.parse(result.content);
    if (!Array.isArray(data.weak_topics)) return [];
    return data.weak_topics.filter((r: Record<string,unknown>) => typeof r?.topic === 'string' && r.topic.length <= 120 && typeof r.accuracy === 'number' && Number.isFinite(r.accuracy) && typeof r.answered === 'number' && Number.isSafeInteger(r.answered) && r.answered > 0)
      .slice(0,6).map((r: {topic:string;accuracy:number;answered:number;exam_source?:string}) => ({ topic:r.topic,accuracy:Math.max(0,Math.min(100,r.accuracy)),answered:r.answered,action:'practice' as const,...(r.exam_source && EXAMS.has(r.exam_source) ? {exam_source:r.exam_source}: {}) }));
  } catch { return []; }
}
export function nextActions(mode: MentorMode, results: Array<{name:string;result:ToolResult}>, questionId?: number): MentorNextAction[] {
  if (mode === 'explain') {
    const q = results.find(r => r.name === 'get_question' && !r.result.isError);
    if (!q) return [];
    try {
      const row = JSON.parse(q.result.content).question;
      if (!row || row.id !== questionId || typeof row.topic !== 'string') return [];
      return [{ kind:'practice_topic',topic:row.topic,exam_source:row.exam_type }, { kind:'open_question',question_id:row.id,exam_source:row.exam_type }];
    } catch { return []; }
  }
  if (mode === 'study') {
    const progress = results.find(r => r.name === 'get_my_progress' && !r.result.isError);
    const top = progress && planItemsFromTool(progress.result)[0];
    return top ? [{kind:'practice_topic',topic:top.topic,exam_source:top.exam_source},{kind:'open_study_plan'}] : [{kind:'set_exam_date'}];
  }
  const dates = results.find(r => r.name === 'get_dates' && !r.result.isError);
  if (!dates) return [];
  try {
    const rows: unknown = JSON.parse(dates.result.content).sittings;
    if (!Array.isArray(rows)) return [{kind:'open_exam_dates'}];
    const unique = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      if (row && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date)) && new Date(row.date).toISOString().slice(0,10) === row.date) unique.set(row.date,row);
    }
    if (unique.size !== 1) return [{kind:'open_exam_dates'}];
    const [date,row] = [...unique][0];
    const detail = {exam_date:date, sitting_label:typeof row.label_en === 'string' ? row.label_en.slice(0,120) : undefined};
    const actions: MentorNextAction[] = [{kind:'set_exam_date',...detail},{kind:'open_exam_dates'}];
    if (typeof row.registration_closes === 'string' && row.registration_status !== 'closed') actions.push({kind:'deadline_reminder',...detail});
    return actions;
  } catch { return [{kind:'open_exam_dates'}]; }
}
