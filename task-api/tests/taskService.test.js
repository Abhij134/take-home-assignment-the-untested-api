const taskService = require('../src/services/taskService');

const mk = (overrides = {}) => taskService.create({ title: 'task', ...overrides });

beforeEach(() => taskService._reset());

describe('taskService.create', () => {
  test('applies defaults for optional fields', () => {
    const t = taskService.create({ title: 'Write tests' });
    expect(t).toMatchObject({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
    });
    expect(typeof t.id).toBe('string');
    expect(Number.isNaN(Date.parse(t.createdAt))).toBe(false);
  });

  test('keeps supplied fields', () => {
    const t = taskService.create({
      title: 'x', description: 'd', status: 'in_progress', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z',
    });
    expect(t).toMatchObject({ description: 'd', status: 'in_progress', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z' });
  });

  test('generates unique ids', () => {
    expect(mk().id).not.toBe(mk().id);
  });
});

describe('taskService.getAll / findById', () => {
  test('getAll returns empty array on a fresh store', () => {
    expect(taskService.getAll()).toEqual([]);
  });

  test('getAll returns every created task', () => {
    mk(); mk();
    expect(taskService.getAll()).toHaveLength(2);
  });

  test('getAll returns a new array (pushing to it does not touch the store)', () => {
    mk();
    taskService.getAll().push({ id: 'fake' });
    expect(taskService.getAll()).toHaveLength(1);
  });

  test('findById returns the task, or undefined when missing', () => {
    const t = mk();
    expect(taskService.findById(t.id)).toEqual(t);
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('taskService.getByStatus', () => {
  beforeEach(() => {
    mk({ status: 'todo' });
    mk({ status: 'in_progress' });
    mk({ status: 'done' });
    mk({ status: 'done' });
  });

  test('returns only tasks with the exact status', () => {
    expect(taskService.getByStatus('done')).toHaveLength(2);
    expect(taskService.getByStatus('todo')).toHaveLength(1);
    expect(taskService.getByStatus('in_progress')).toHaveLength(1);
  });

  test('returns [] for an unknown status', () => {
    expect(taskService.getByStatus('bogus')).toEqual([]);
  });
});

describe('taskService.getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 5; i++) mk({ title: `t${i}` });
  });
  const titles = (arr) => arr.map((t) => t.title);

  test('page 1 is the first page', () => {
    expect(titles(taskService.getPaginated(1, 2))).toEqual(['t1', 't2']);
  });

  test('page 2 is the second page', () => {
    expect(titles(taskService.getPaginated(2, 2))).toEqual(['t3', 't4']);
  });

  test('last page may be partial', () => {
    expect(titles(taskService.getPaginated(3, 2))).toEqual(['t5']);
  });

  test('page past the end is empty', () => {
    expect(taskService.getPaginated(4, 2)).toEqual([]);
  });
});

describe('taskService.getStats', () => {
  test('all zeros on empty store', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status', () => {
    mk({ status: 'todo' }); mk({ status: 'todo' }); mk({ status: 'in_progress' }); mk({ status: 'done' });
    expect(taskService.getStats()).toMatchObject({ todo: 2, in_progress: 1, done: 1 });
  });

  test('counts overdue only for past-due, not-done tasks', () => {
    const past = '2000-01-01T00:00:00.000Z';
    const future = '2999-01-01T00:00:00.000Z';
    mk({ status: 'todo', dueDate: past });        // overdue
    mk({ status: 'in_progress', dueDate: past }); // overdue
    mk({ status: 'done', dueDate: past });        // done -> not overdue
    mk({ status: 'todo', dueDate: future });      // not due yet
    mk({ status: 'todo' });                       // no due date
    expect(taskService.getStats().overdue).toBe(2);
  });
});

describe('taskService.update', () => {
  test('merges fields and persists them', () => {
    const t = mk();
    const updated = taskService.update(t.id, { title: 'new', priority: 'high' });
    expect(updated).toMatchObject({ id: t.id, title: 'new', priority: 'high' });
    expect(taskService.findById(t.id).title).toBe('new');
  });

  test('returns null for a missing id', () => {
    expect(taskService.update('nope', { title: 'x' })).toBeNull();
  });
});

describe('taskService.remove', () => {
  test('removes an existing task and returns true', () => {
    const t = mk();
    expect(taskService.remove(t.id)).toBe(true);
    expect(taskService.getAll()).toEqual([]);
  });

  test('returns false for a missing id and leaves the store alone', () => {
    mk();
    expect(taskService.remove('nope')).toBe(false);
    expect(taskService.getAll()).toHaveLength(1);
  });
});

describe('taskService.completeTask', () => {
  test('marks the task done and stamps completedAt', () => {
    const t = mk();
    const done = taskService.completeTask(t.id);
    expect(done.status).toBe('done');
    expect(Number.isNaN(Date.parse(done.completedAt))).toBe(false);
    expect(taskService.findById(t.id).status).toBe('done');
  });

  test('returns null for a missing id', () => {
    expect(taskService.completeTask('nope')).toBeNull();
  });
});

describe('taskService._reset', () => {
  test('empties the store', () => {
    mk();
    taskService._reset();
    expect(taskService.getAll()).toEqual([]);
  });
});
