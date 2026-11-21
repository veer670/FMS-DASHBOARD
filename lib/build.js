'use strict';
/**
 * Builds the dashboard dataset from the FMS PostgREST API.
 *
 * `get(path)` must resolve to parsed JSON for a PostgREST path such as
 * "Task?select=taskId". Kept free of Node-only APIs so the same function can be
 * exercised from a browser when testing.
 *
 * Note: the User table is read with an explicit column list. Never select `*`
 * or `password` from it.
 */

// Timestamps are `timestamp without time zone` stored in UTC. Mark them as UTC
// so browsers convert to local (IST) time correctly.
function utc(v) {
  if (!v) return null;
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(v) ? v : v + 'Z';
}

async function buildData(get) {
  const [
    projects, towers, areas, subAreas, departments, contractors,
    areaContractor, users, tasks, steps, updates, deadlines,
  ] = await Promise.all([
    get('Project?select=projectId,projectName,projectStatus,projectNumber&order=projectNumber'),
    get('Tower?select=towerId,towerName,projectId,towerStatus,order&order=order'),
    get('Area?select=areaId,areaName,towerId,areaStatus,order&order=order'),
    get('SubArea?select=subAreaId,subAreaName,areaId,subAreaStatus,order&order=order'),
    get('Department?select=Id,name&order=name'),
    get('Contractor?select=contractorId,contractorName,departmentId&order=contractorName'),
    get('_AreaToContractor?select=A,B'),
    get('User?select=userId,firstName,lastName,username,email'),
    get('Task?select=taskId,taskName,completed,completedAt,startDate,endDate,taskStatus,departmentId,taskManager,subAreaId,order'),
    get('Step?select=taskId,completed'),
    get('Update?select=id,content,senderEmail,type,createdAt,taskId&senderEmail=neq.cron@system&order=createdAt.desc&limit=200'),
    get('ContractorAreaDeadline?select=id,contractorId,areaId,startDate,deadlineDate,completedDate,previousDeadlines,status,updatedAt'),
  ]);

  // Step progress per task
  const stepAgg = new Map();
  for (const s of steps) {
    const a = stepAgg.get(s.taskId) || [0, 0];
    a[0] += 1;
    if (s.completed) a[1] += 1;
    stepAgg.set(s.taskId, a);
  }

  // Prisma implicit many-to-many: A/B order is alphabetical by model name
  // (Area < Contractor), but detect it from the data rather than assume.
  const areaIds = new Set(areas.map(a => a.areaId));
  const aIsArea = areaContractor.length === 0 || areaContractor.filter(r => areaIds.has(r.A)).length >= areaContractor.length / 2;
  const links = areaContractor.map(r => (aIsArea ? { areaId: r.A, contractorId: r.B } : { areaId: r.B, contractorId: r.A }));

  const name = u => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || u.email || 'Unknown';

  return {
    generatedAt: new Date().toISOString(),
    projects: projects.map(p => ({ id: p.projectId, name: p.projectName, active: p.projectStatus === 'active', no: p.projectNumber })),
    towers: towers.map(t => ({ id: t.towerId, name: t.towerName, projectId: t.projectId, active: t.towerStatus === 'active', order: t.order })),
    areas: areas.map(a => ({ id: a.areaId, name: a.areaName, towerId: a.towerId, active: a.areaStatus === 'active', order: a.order })),
    subAreas: subAreas.map(s => ({ id: s.subAreaId, name: s.subAreaName, areaId: s.areaId, active: s.subAreaStatus === 'active' })),
    departments: departments.map(d => ({ id: d.Id, name: d.name })),
    contractors: contractors.map(c => ({ id: c.contractorId, name: c.contractorName, departmentId: c.departmentId })),
    areaContractor: links,
    users: users.map(u => ({ id: u.userId, name: name(u), email: (u.email || '').toLowerCase() })),
    tasks: tasks.map(t => {
      const s = stepAgg.get(t.taskId) || [0, 0];
      return {
        id: t.taskId,
        name: t.taskName,
        done: !!t.completed,
        doneAt: utc(t.completedAt),
        start: utc(t.startDate),
        end: utc(t.endDate),
        active: t.taskStatus === 'active',
        deptId: t.departmentId,
        managerId: t.taskManager,
        subAreaId: t.subAreaId,
        stepsTotal: s[0],
        stepsDone: s[1],
      };
    }),
    updates: updates.map(u => ({ id: u.id, text: u.content, by: (u.senderEmail || '').toLowerCase(), type: u.type, at: utc(u.createdAt), taskId: u.taskId })),
    deadlines: deadlines.map(d => ({
      id: d.id, contractorId: d.contractorId, areaId: d.areaId,
      start: utc(d.startDate), deadline: utc(d.deadlineDate), completed: utc(d.completedDate),
      revisions: (d.previousDeadlines || []).length, status: d.status, updatedAt: utc(d.updatedAt),
    })),
  };
}

if (typeof module !== 'undefined') module.exports = { buildData };
