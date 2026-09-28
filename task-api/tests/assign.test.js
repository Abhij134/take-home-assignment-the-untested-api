const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => taskService._reset());

const create = async (body = {}) =>
  (await request(app).post('/tasks').send({ title: 'task', ...body }).expect(201)).body;
const assign = (id, body) => request(app).patch(`/tasks/${id}/assign`).send(body);

describe('PATCH /tasks/:id/assign', () => {
  test('stores the assignee and returns the updated task (200)', async () => {
    const t = await create();
    const res = await assign(t.id, { assignee: 'Priya' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, assignee: 'Priya' });
  });

  test('persists: a later GET shows the assignee', async () => {
    const t = await create();
    await assign(t.id, { assignee: 'Priya' });
    const list = (await request(app).get('/tasks')).body;
    expect(list[0].assignee).toBe('Priya');
  });

  test('does not change any other field', async () => {
    const t = await create({ title: 'keep me', priority: 'high', status: 'in_progress' });
    const res = await assign(t.id, { assignee: 'Priya' });
    expect(res.body).toEqual({ ...t, assignee: 'Priya' });
  });

  test('trims surrounding whitespace before storing', async () => {
    const t = await create();
    expect((await assign(t.id, { assignee: '  Priya  ' })).body.assignee).toBe('Priya');
  });

  test('404 when the task does not exist', async () => {
    const res = await assign('nope', { assignee: 'Priya' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test.each([
    ['missing body', undefined],
    ['missing assignee', {}],
    ['empty string', { assignee: '' }],
    ['whitespace only', { assignee: '   ' }],
    ['null', { assignee: null }],
    ['number', { assignee: 42 }],
    ['array', { assignee: ['a'] }],
    ['object', { assignee: { name: 'a' } }],
    ['over 100 chars', { assignee: 'x'.repeat(101) }],
  ])('400 for %s, and the task is left unassigned', async (_n, body) => {
    const t = await create();
    const res = await assign(t.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(taskService.findById(t.id).assignee).toBeUndefined();
  });

  test('accepts exactly 100 chars', async () => {
    const t = await create();
    expect((await assign(t.id, { assignee: 'x'.repeat(100) })).status).toBe(200);
  });

  test('re-assigning an already assigned task replaces the assignee (200)', async () => {
    const t = await create();
    await assign(t.id, { assignee: 'Priya' });
    const res = await assign(t.id, { assignee: 'Sam' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Sam');
  });

  test('assigning the same person twice is idempotent', async () => {
    const t = await create();
    await assign(t.id, { assignee: 'Priya' });
    const res = await assign(t.id, { assignee: 'Priya' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Priya');
  });

  test('a completed task can still be assigned', async () => {
    const t = await create();
    await request(app).patch(`/tasks/${t.id}/complete`);
    expect((await assign(t.id, { assignee: 'Priya' })).status).toBe(200);
  });

  test('400 for invalid input takes precedence over 404 (same as PUT)', async () => {
    expect((await assign('nope', { assignee: '' })).status).toBe(400);
  });
});

describe('taskService.assign', () => {
  test('sets the assignee and returns the updated task', () => {
    const t = taskService.create({ title: 'x' });
    expect(taskService.assign(t.id, 'Priya')).toMatchObject({ id: t.id, assignee: 'Priya' });
    expect(taskService.findById(t.id).assignee).toBe('Priya');
  });

  test('returns null for a missing id', () => {
    expect(taskService.assign('nope', 'Priya')).toBeNull();
  });
});
