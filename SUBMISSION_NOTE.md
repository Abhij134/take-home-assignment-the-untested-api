# Submission Note

## What I did

I started by just reading through the code before writing anything. Ran the server, hit a few endpoints with curl, got a feel for how things were structured. The service layer is clean enough — most of the weirdness is in how the routes and validators interact.

Tests are split across four files:
- `taskService.test.js` — unit tests directly on the service functions
- `tasks.routes.test.js` — Supertest integration tests for every route
- `bugs.test.js` — one test per bug I found (more on those below)
- `assign.test.js` — tests for the new assign endpoint

Ended up with 98 tests total. Coverage came out to ~98.7% statements / ~97.8% branches. The only lines not covered are the `app.listen` block in `app.js` (which doesn't run during tests, that's normal).

---

## Bugs

Found 8 bugs, documented them all in `BUG_REPORT.md`. I fixed one — the pagination off-by-one (Bug 2). It was the most clear-cut: six tests all failed the same way, the math was obviously wrong, and the fix was literally one character change (`page * limit` → `(page - 1) * limit`).

For the other 7, I wrote `test.failing` tests. This means they show up in the test output as passing right now (because the bug still exists), but the moment someone fixes the bug, the test flips to red and reminds them to remove the `.failing` marker. I thought this was better than just leaving TODO comments.

---

## The assign endpoint

I added `PATCH /tasks/:id/assign` with a `{ "assignee": "string" }` body.

A few decisions I made:

**Validation** — `assignee` has to be a non-empty string after trimming. Numbers, null, empty string — all get a 400. I also added a 100 character max, mostly because storing unbounded strings in an in-memory array felt wrong. Easy to change.

**Reassignment** — if a task is already assigned to someone, you can reassign it. Returns 200. I thought about returning 409 but there's no "unassign" endpoint, so that would just make things awkward. Reassigning the same person is a no-op effectively.

**Check order** — validation runs before the 404 check, which matches how the existing PUT route works. Seemed consistent to keep it that way.

**Completed tasks** — you can still assign a completed task. The brief doesn't say you can't, so I didn't add that restriction.

I didn't add `assignee: null` to the task shape in `create` because that would change the shape of every existing task response. Adding it as a follow-up would be pretty easy.

---

## What I'd test next if I had more time

- The validators have some edge cases I didn't fully cover — things like `__proto__` as a field name, very long unicode strings, etc. Would be interesting to fuzz them.
- Contract/schema tests on every response. Right now the tests check status codes and specific fields, but nothing validates the full response shape.
- Once there's a real database, concurrency stuff — the in-memory array doesn't have any locking so concurrent writes could cause weirdness.
- The PUT behavior is basically PATCH right now (partial update). Would want to clarify whether it's supposed to replace the whole task or just the provided fields, and test accordingly.

---

## Things that surprised me

The status filter bug (Bug 1) is a good one — `t.status.includes(status)` looks completely fine until you realize it's calling `String.prototype.includes`, not `Array.prototype.includes`. Easy mistake to make.

The error handler ignoring `err.status` was the other one. Express's JSON parser sets `err.status = 400` on malformed input, but the catch-all just always returns 500. So a client typo would page on-call. That felt like something worth flagging.

Also noticed the README uses different status values (`pending`, `in-progress`, `completed`) than what the code actually uses (`todo`, `in_progress`, `done`). I went with what the code says since that's what's actually enforced.

---

## Questions I'd ask before shipping this

- Which status vocabulary is correct — the README's or the code's? Someone should update one of them.
- Is PUT supposed to be a full replace or a partial update? Right now it's partial, but the route name suggests full replace.
- Is there any auth story? Right now anyone can assign, delete, or update any task. `assignee` is free text, not a user ID — is that intentional?
- What should the max page size be? And should `GET /tasks` return a `total` count so the client knows when to stop paginating?
- What replaces the in-memory store? Any production concerns around the data model (soft deletes, audit log, etc.)?
