'use strict';
/**
 * Builds the Work Execution dataset from the FMS PostgREST API.
 *
 * `get(path)` must resolve to parsed JSON for a PostgREST path such as
 * "Task?select=taskId". No Node-only APIs, so it can also be tested in a browser.
 *
 * Hierarchy: Project (shown as "Location") → Tower → Area → SubArea → Task
 */

// Timestamps are `timestamp without time zone` stored in UTC.
function utc(v) {
  if (!v) return null;
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(v) ? v : v + 'Z';
}

async function buildData(get) {
  const [projects, towers, areas, subAreas, tasks, departments] = await Promise.all([
    get('Project?select=projectId,projectName,projectStatus,projectNumber&order=projectNumber'),
    get('Tower?select=towerId,towerName,projectId,towerStatus,order&order=order'),
    get('Area?select=areaId,areaName,towerId,areaStatus,order&order=order'),
    get('SubArea?select=subAreaId,subAreaName,areaId,subAreaStatus,order&order=order'),
    get('Task?select=taskId,taskName,completed,completedAt,startDate,endDate,taskStatus,subAreaId,departmentId,order&order=order'),
    get('Department?select=Id,name'),
  ]);
  const deptName = new Map(departments.map(d => [d.Id, d.name]));

  return {
    generatedAt: new Date().toISOString(),
    locations: projects.map(p => ({ id: p.projectId, name: p.projectName, active: p.projectStatus === 'active' })),
    towers: towers.map(t => ({ id: t.towerId, name: t.towerName, parent: t.projectId, active: t.towerStatus === 'active' })),
    areas: areas.map(a => ({ id: a.areaId, name: a.areaName, parent: a.towerId, active: a.areaStatus === 'active' })),
    subAreas: subAreas.map(s => ({ id: s.subAreaId, name: s.subAreaName, parent: s.areaId, active: s.subAreaStatus === 'active' })),
    tasks: tasks.map(t => ({
      id: t.taskId,
      name: t.taskName,
      dept: deptName.get(t.departmentId) || '',
      start: utc(t.startDate),
      done: !!t.completed,
      doneAt: utc(t.completedAt),
      end: utc(t.endDate),
      active: t.taskStatus === 'active',
      subAreaId: t.subAreaId,
    })),
  };
}

if (typeof module !== 'undefined') module.exports = { buildData };
