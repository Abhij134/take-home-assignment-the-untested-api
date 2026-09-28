# Bug Report — Task API

Each bug below has at least one test in `tests/bugs.test.js`. Bug 2 is fixed — its test is a regular `test()`. Everything else uses `test.failing`, which means it passes while the bug is still there and turns red the moment someone fixes it (that's the signal to flip it back to a normal test).

Line numbers are from the original code. The pagination fix doesn't shift any other lines.

---

| # | Severity | Status | Summary |
|---|----------|--------|---------|
| 1 | High | Open | Status filter is a substring match, not exact |
| 2 | High | **Fixed** | Pagination off-by-one — first page is always skipped |
| 3 | Medium | Open | `completeTask` silently resets priority to medium |
| 4 | Medium | Open | `PUT` lets you overwrite the task's own id, inject random fields |
| 5 | High | Open | Validators skip checks on falsy values like `""` and `null` |
| 6 | Medium | Open | Can't filter by status and paginate at the same time |
| 7 | Medium | Open | Malformed JSON body gives 500 instead of 400 |
| 8 | Low | Open | `getAll` leaks live object references from the store |

---

## 1. Status filter matches substrings

**File:** `src/services/taskService.js:9`

```js
// what's there
tasks.filter((t) => t.status.includes(status))

// what it should be
tasks.filter((t) => t.status === status)
```

The issue is `includes` here is `String.prototype.includes`, not the array version. So `?status=do` matches both `todo` and `done`. `?status=in` matches `in_progress`. `?status=o` returns literally everything.

I caught this while writing unit tests — `getByStatus("do")` returned two tasks when I expected zero.

---

## 2. Pagination off-by-one — FIXED

**File:** `src/services/taskService.js:12`

```js
// original (wrong)
const offset = page * limit;

// fixed
const offset = (page - 1) * limit;
```

The API is 1-based (`page=1` means the first page), but the math was treating it as 0-based. So `page=1&limit=2` would skip the first two items and return items 3 and 4. The first `limit` items were completely unreachable regardless of what page you asked for.

Six tests failed on the original code — three unit tests, three route tests, all showing the same shifted results. The fix is one character. Chose this one to actually fix because it was completely unambiguous.

---

## 3. `completeTask` resets priority as a side effect

**File:** `src/services/taskService.js:69-71`

```js
const updated = {
  ...task,
  priority: 'medium',  // <-- this shouldn't be here
  status: 'done',
  completedAt: new Date().toISOString(),
};
```

Two problems here:

1. Any task you complete gets its priority hard-coded to `medium`, even if it was `high`. The priority field just silently changes.
2. Calling `completeTask` on a task that's already done overwrites `completedAt` with a new timestamp. So you lose track of when the task was actually completed.

The fix is to delete the `priority` line and add a guard at the top: `if (task.status === 'done') return task;`.

---

## 4. `PUT` trusts the entire request body

**File:** `src/services/taskService.js:50`

```js
const updated = { ...tasks[index], ...fields };
```

This spreads the entire request body onto the task, so:
- `PUT { "id": "something-else" }` changes the task's ID — it then can't be found by its original ID
- `PUT { "createdAt": "1970-01-01" }` rewrites the creation timestamp
- `PUT { "isAdmin": true }` gets stored and comes back in responses
- `PUT { "status": "done" }` sets status to done but leaves `completedAt: null`, so you have a "done" task with no completion time

The fix is to whitelist the allowed fields (`title`, `description`, `status`, `priority`, `dueDate`) and derive `completedAt` from status transitions instead of leaving it unmanaged.

---

## 5. Validators use truthiness checks instead of presence checks

**File:** `src/utils/validators.js:8,11,14` (create) and `:24,27,30` (update)

```js
// what's there — skips validation if value is falsy
if (body.status && !VALID_STATUSES.includes(body.status)) { ... }

// what it should be — validate if the field is present at all
if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) { ... }
```

Because `""` and `null` are falsy, validation gets skipped entirely for those values. So `POST { "title": "x", "status": "" }` goes through and creates a task with `status: ""`. 

The nasty consequence: a task with `status: null` stored in the db makes `getByStatus` crash with `Cannot read properties of null (reading 'includes')`. So one bad POST will cause every `GET /tasks?status=...` to return a 500 until the server restarts. I confirmed this by sending the bad request and then hitting the filter endpoint.

---

## 6. Status filter and pagination don't compose

**File:** `src/routes/tasks.js:14-25`

```js
if (status) {
  const tasks = taskService.getByStatus(status);
  return res.json(tasks);  // early return, pagination never runs
}
```

The route bails out before it considers `page`/`limit`, so `?status=done&page=1&limit=2` just returns every done task ignoring the pagination entirely.

There's also no validation on the page/limit values themselves — `page=-1` produces a negative slice index, and `limit=100000` is happily accepted. The `parseInt(x) || default` pattern hides bad inputs instead of rejecting them.

The fix is to filter first, paginate second, and validate that `page >= 1` and `limit` is within some reasonable range.

Side note: the response is a plain array with no `total` count, so clients can't know when they've reached the last page. Not technically a bug, but worth flagging as a design gap.

---

## 7. Malformed JSON body returns 500

**File:** `src/app.js:9-12`

```js
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });  // always 500
});
```

When Express's JSON parser gets a malformed body like `{"title": ` (unterminated), it throws a `SyntaxError` and sets `err.status = 400`. But the catch-all error handler ignores `err.status` and always returns 500.

This means a client typo triggers an "Internal server error" response and logs a full stack trace. That would show up as a real alert in production monitoring.

Fix: `res.status(err.status || 500)`, or check `err.type === 'entity.parse.failed'` specifically.

---

## 8. Store leaks live object references

**File:** `src/services/taskService.js:5,7`

```js
const getAll = () => [...tasks];      // shallow copy of array, not objects
const findById = (id) => tasks.find((t) => t.id === id);  // returns the actual stored object
```

`getAll` copies the array but not the objects inside it. `findById` returns a direct reference to the object in the store. So `getAll()[0].title = 'x'` actually mutates the stored task, completely bypassing any validation.

Right now this doesn't cause any visible bugs because only the routes call these functions and they immediately serialize the result to JSON. But it's a trap — any future caller could mutate state by accident.

Fix: return deep enough copies — `tasks.map(t => ({ ...t }))`.

---

## Not bugs, but worth noting

**README uses different status values** — the README says statuses are `pending | in-progress | completed` and its curl examples use `?status=pending`. The actual code uses `todo | in_progress | done`. I went with the code as the source of truth. Someone should update the README.

**Unknown status filter returns 200 with empty array** — `?status=blah` returns `[]` instead of a 400. This is a defensible design choice, just not an obvious one.
