/**
 * Bug-proving tests. Each asserts the CORRECT behavior, so it fails while the bug exists.
 * See BUG_REPORT.md for where each bug lives and why it happens.
 */
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => taskService._reset());

// Known, still-unfixed bugs. `test.failing` passes while the assertion FAILS (bug present)
// and turns red the moment the bug is fixed -> at that point change `bug` back to `test`.
const bug = test.failing;
bug.each = test.failing.each;

const create = async (body = {}) =>
  (await request(app).post('/tasks').send({ title: 'task', ...body }).expect(201)).body;

describe('BUG-1: status filter uses substring match', () => {
  bug('getByStatus("do") must not match "todo" or "done"', () => {
    taskService.create({ title: 'a', status: 'todo' });
    taskService.create({ title: 'b', status: 'done' });
    expect(taskService.getByStatus('do')).toEqual([]);
  });

  bug('GET /tasks?status=in must not match in_progress', async () => {
    await create({ status: 'in_progress' });
    expect((await request(app).get('/tasks?status=in')).body).toEqual([]);
  });
});

describe('BUG-2: pagination off-by-one', () => {
  test('page=1 returns the first items, not the second page', async () => {
    for (let i = 1; i <= 3; i++) await create({ title: `t${i}` });
    const res = await request(app).get('/tasks?page=1&limit=2');
    expect(res.body.map((t) => t.title)).toEqual(['t1', 't2']);
  });
});

describe('BUG-3: completeTask side effects', () => {
  bug('does not reset priority', () => {
    const t = taskService.create({ title: 'x', priority: 'high' });
    expect(taskService.completeTask(t.id).priority).toBe('high');
  });

  bug('completing an already-completed task keeps the original completedAt', () => {
    const t = taskService.create({ title: 'x' });
    const first = taskService.completeTask(t.id);
    jest.useFakeTimers().setSystemTime(new Date(Date.now() + 60_000));
    try {
      expect(taskService.completeTask(t.id).completedAt).toBe(first.completedAt);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('BUG-4: update allows overwriting protected / unknown fields', () => {
  bug('PUT cannot change id', async () => {
    const t = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ id: 'hijacked' });
    expect(res.body.id).toBe(t.id);
  });

  bug('PUT cannot change createdAt', async () => {
    const t = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ createdAt: '1999-01-01T00:00:00.000Z' });
    expect(res.body.createdAt).toBe(t.createdAt);
  });

  bug('PUT cannot inject arbitrary properties', async () => {
    const t = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ isAdmin: true });
    expect(res.body).not.toHaveProperty('isAdmin');
  });

  bug('PUT status=done sets completedAt', async () => {
    const t = await create();
    const res = await request(app).put(`/tasks/${t.id}`).send({ status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });

  bug('PUT moving a task back out of done clears completedAt', async () => {
    const t = await create();
    await request(app).patch(`/tasks/${t.id}/complete`);
    const res = await request(app).put(`/tasks/${t.id}`).send({ status: 'todo' });
    expect(res.body.completedAt).toBeNull();
  });
});

describe('BUG-5: validators let falsy invalid values through', () => {
  bug.each([
    ['empty-string status', { status: '' }],
    ['null status', { status: null }],
    ['empty-string priority', { priority: '' }],
    ['null priority', { priority: null }],
    ['empty-string dueDate', { dueDate: '' }],
  ])('POST rejects %s', async (_n, body) => {
    const res = await request(app).post('/tasks').send({ title: 'x', ...body });
    expect(res.status).toBe(400);
  });

  bug('POST with status=done sets completedAt', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });
});

describe('BUG-6: GET /tasks query handling', () => {
  bug('status + page/limit are both honored', async () => {
    for (let i = 1; i <= 4; i++) await create({ title: `d${i}`, status: 'done' });
    await create({ title: 'todo1', status: 'todo' });
    const res = await request(app).get('/tasks?status=done&page=1&limit=2');
    expect(res.body.map((t) => t.title)).toEqual(['d1', 'd2']);
  });

  bug.each(['page=-1', 'limit=-5', 'page=abc&limit=2', 'limit=0'])('%s is rejected with 400', async (qs) => {
    await create();
    expect((await request(app).get(`/tasks?${qs}`)).status).toBe(400);
  });

  bug('limit has an upper bound', async () => {
    await create();
    expect((await request(app).get('/tasks?page=1&limit=100000')).status).toBe(400);
  });
});

describe('BUG-7: malformed JSON body', () => {
  bug('returns 400, not 500', async () => {
    const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{"title": ');
    expect(res.status).toBe(400);
  });
});

describe('BUG-8 (low): store leaks live references', () => {
  bug('mutating an object returned by getAll() must not change the store', () => {
    taskService.create({ title: 'orig' });
    taskService.getAll()[0].title = 'tampered';
    expect(taskService.getAll()[0].title).toBe('orig');
  });
});
