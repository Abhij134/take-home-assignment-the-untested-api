const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => taskService._reset());

const create = async (body = {}) =>
  (await request(app).post('/tasks').send({ title: 'task', ...body }).expect(201)).body;

describe('POST /tasks', () => {
  test('creates a task with defaults (201)', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Write tests', status: 'todo', priority: 'medium', dueDate: null, completedAt: null });
    expect(res.body.id).toBeDefined();
  });

  test.each([
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['whitespace title', { title: '   ' }],
    ['non-string title', { title: 42 }],
    ['invalid status', { title: 'x', status: 'pending' }],
    ['invalid priority', { title: 'x', priority: 'urgent' }],
    ['invalid dueDate', { title: 'x', dueDate: 'not-a-date' }],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  test('does not create anything when validation fails', async () => {
    await request(app).post('/tasks').send({});
    expect((await request(app).get('/tasks')).body).toEqual([]);
  });
});

describe('GET /tasks', () => {
  test('returns [] when empty', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all tasks', async () => {
    await create(); await create();
    expect((await request(app).get('/tasks')).body).toHaveLength(2);
  });

  test('filters by exact status', async () => {
    await create({ status: 'todo' });
    await create({ status: 'done' });
    const res = await request(app).get('/tasks?status=done');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('done');
  });

  test('unknown status returns an empty list', async () => {
    await create();
    expect((await request(app).get('/tasks?status=bogus')).body).toEqual([]);
  });

  test('paginates: page 1 then page 2', async () => {
    for (let i = 1; i <= 5; i++) await create({ title: `t${i}` });
    const p1 = await request(app).get('/tasks?page=1&limit=2');
    const p2 = await request(app).get('/tasks?page=2&limit=2');
    expect(p1.body.map((t) => t.title)).toEqual(['t1', 't2']);
    expect(p2.body.map((t) => t.title)).toEqual(['t3', 't4']);
  });

  test('page with no limit uses the default limit of 10', async () => {
    for (let i = 1; i <= 12; i++) await create({ title: `t${i}` });
    const res = await request(app).get('/tasks?page=1');
    expect(res.body).toHaveLength(10);
  });

  test('limit with no page defaults to page 1', async () => {
    for (let i = 1; i <= 5; i++) await create({ title: `t${i}` });
    const res = await request(app).get('/tasks?limit=2');
    expect(res.body.map((t) => t.title)).toEqual(['t1', 't2']);
  });
});

describe('PUT /tasks/:id', () => {
  test('updates fields (200)', async () => {
    const t = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ title: 'renamed', priority: 'high', status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, title: 'renamed', priority: 'high', status: 'in_progress' });
  });

  test('404 for unknown id', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test.each([
    ['empty title', { title: '' }],
    ['invalid status', { status: 'nope' }],
    ['invalid priority', { priority: 'nope' }],
    ['invalid dueDate', { dueDate: 'garbage' }],
  ])('400 for %s and task is unchanged', async (_n, body) => {
    const t = await create({ title: 'orig' });
    const res = await request(app).put(`/tasks/${t.id}`).send(body);
    expect(res.status).toBe(400);
    expect(taskService.findById(t.id).title).toBe('orig');
  });

  test('validation runs before existence check (400 beats 404)', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  test('deletes and returns 204 with empty body', async () => {
    const t = await create();
    const res = await request(app).delete(`/tasks/${t.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(app).get('/tasks')).body).toEqual([]);
  });

  test('404 for unknown id', async () => {
    expect((await request(app).delete('/tasks/nope')).status).toBe(404);
  });

  test('second delete of the same id is 404', async () => {
    const t = await create();
    await request(app).delete(`/tasks/${t.id}`);
    expect((await request(app).delete(`/tasks/${t.id}`)).status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks a task done with completedAt', async () => {
    const t = await create();
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(Number.isNaN(Date.parse(res.body.completedAt))).toBe(false);
  });

  test('404 for unknown id', async () => {
    expect((await request(app).patch('/tasks/nope/complete')).status).toBe(404);
  });
});

describe('GET /tasks/stats', () => {
  test('returns counts by status plus overdue', async () => {
    await create({ status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' });
    await create({ status: 'in_progress' });
    await create({ status: 'done' });
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 1 });
  });

  test('is not swallowed by a /:id route', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toHaveProperty('overdue');
  });
});
