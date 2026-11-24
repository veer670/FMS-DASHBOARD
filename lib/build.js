'use strict';
/**
 * Builds the Work Execution dataset from the FMS PostgREST API.
 *
 * `get(path)` must resolve to parsed JSON for a PostgREST path such as
 * "Task?select=taskId". No Node-only APIs, so it can also be tested in a browser.
 *
 * Hierarchy (ASAP names): Project → Tower → Area → Sub Area → Task
 * Remarks = the latest step-chat message on any of the task's steps (what the
 * site team types in ASAP). Tasks without chat fall back to the latest ASAP
 * activity-log entry; automatic "cron@system" overdue reminders are skipped.
 */

// Timestamps are `timestamp without time zone` stored in UTC.
function utc(v) {
  if (!v) return null;
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(v) ? v : v + 'Z';
}

async function buildData(get) {
  const [projects, towers, areas, subAreas, tasks, departments, updates, chats] = await Promise.all([
    get('Project?select=projectId,projectName,projectStatus,projectNumber&order=projectNumber'),
    get('Tower?select=towerId,towerName,projectId,towerStatus,order&order=order'),
    get('Area?select=areaId,areaName,towerId,areaStatus,order&order=order'),
    get('SubArea?select=subAreaId,subAreaName,areaId,subAreaStatus,order&order=order'),
    get('Task?select=taskId,taskName,completed,completedAt,startDate,endDate,taskStatus,subAreaId,departmentId,order&order=order'),
    get('Department?select=Id,name'),
    get('Update?select=taskId,content,createdAt&senderEmail=neq.cron@system&order=createdAt.desc'),
    get('Chatmessage?select=message,senderName,createdAt,Chatroom(Step(taskId,stepName))&order=createdAt.desc'),
  ]);
  const deptName = new Map(departments.map(d => [d.Id, d.name]));

  // latest remark per task (both lists arrive newest first); chat beats the activity log
  const remark = new Map();
  for (const c of chats) {
    const step = c.Chatroom && c.Chatroom.Step;
    const text = (c.message || '').trim();
    if (step && step.taskId && text && !remark.has(step.taskId)) {
      remark.set(step.taskId, { text, at: utc(c.createdAt), by: (c.senderName || '').trim(), step: (step.stepName || '').trim(), kind: 'chat' });
    }
  }
  for (const u of updates) {
    if (u.taskId && !remark.has(u.taskId)) remark.set(u.taskId, { text: u.content, at: utc(u.createdAt), kind: 'log' });
  }

  return {
    generatedAt: new Date().toISOString(),
    projects: projects.map(p => ({ id: p.projectId, name: p.projectName, active: p.projectStatus === 'active' })),
    towers: towers.map(t => ({ id: t.towerId, name: t.towerName, parent: t.projectId, active: t.towerStatus === 'active' })),
    areas: areas.map(a => ({ id: a.areaId, name: a.areaName, parent: a.towerId, active: a.areaStatus === 'active' })),
    subAreas: subAreas.map(s => ({ id: s.subAreaId, name: s.subAreaName, parent: s.areaId, active: s.subAreaStatus === 'active' })),
    tasks: tasks.map(t => {
      const r = remark.get(t.taskId);
      return {
        id: t.taskId,
        name: t.taskName,
        dept: deptName.get(t.departmentId) || '',
        start: utc(t.startDate),
        done: !!t.completed,
        doneAt: utc(t.completedAt),
        end: utc(t.endDate),
        active: t.taskStatus === 'active',
        subAreaId: t.subAreaId,
        remark: r ? r.text : '',
        remarkAt: r ? r.at : null,
        remarkBy: r && r.by ? r.by : '',
        remarkStep: r && r.step ? r.step : '',
        remarkKind: r ? r.kind : '',
      };
    }),
  };
}

if (typeof module !== 'undefined') module.exports = { buildData };
