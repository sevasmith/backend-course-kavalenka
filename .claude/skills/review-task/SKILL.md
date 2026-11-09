---
name: review-task
description: Review Seva's implementation of tasks from a saved plan in docs/plans against the plan, the theory file's Practical Assignment and task.md, run lint, tests and build, and tick the tasks in the plan when they pass. Use when Seva writes something like "/review-task 1.1, task 2".
argument-hint: <plan number>, task <n> (or tasks <from>-<to>), e.g. 1.1, task 2
---

# Review tasks from a plan

Arguments: `$ARGUMENTS`. They name a plan number (e.g. `1.1`) and the tasks: a single number (`2`), a range (`1-3`) or a list (`2, 4`).

## 1. Find the plan and the tasks

- Find the file in `docs/plans/` whose name starts with the plan number followed by `_` (e.g. `1.1` → `docs/plans/1.1_rbac.md`), and read it in full, including its Notes.
- If the arguments are unclear, no file matches, or a task number doesn't exist, say so and ask. Don't guess.

## 2. Gather what to review

- **The code:** the uncommitted changes and the commits on this branch that aren't on `main` (`git status`, `git diff`, `git log main..HEAD`). Read in full the files that belong to the requested tasks.
- **What it must meet:**
  - the task text in the plan, and the plan's Notes
  - the matching theory file in `docs/theory/` (its Practical Assignment)
  - the relevant sections of `docs/task.md`, the final source of truth
  - the project conventions in `README.md`
- Review only the requested tasks. Don't flag work that belongs to later tasks as missing, but do flag code that already does a later task's job in a way that will get in the way.

## 3. Run the checks

Run `npm run lint`, `npm run test` and `npm run build`. Report each result briefly, quoting the errors that matter. If a check can't run (for example, the DB is down), say so and don't count it as a pass.

When it helps, also check the result directly: run the migration, query the DB, or call the endpoint with an HTTP client.

## 4. Report in chat

Follow "Checking Seva's work" in `CLAUDE.md`:

1. **What works well:** a few specific points.
2. **Issues, most important first:**
   - correctness and security
   - compliance with `task.md` and the Practical Assignment: status and error codes, validation rules, edge cases
   - design and code quality
   - style

   For each issue, say what is wrong, why it matters, and where to read more. Give the direction of the fix, but write the fix only if Seva asks.
3. **Questions a course mentor might ask:** 1–3, preferably from the theory file's Theory Questions.

Keep it concise. Don't edit project code during the review.

## 5. Update the plan

- **No correctness, security or spec issues, and lint, tests and build pass:** tick the task in the plan (`- [ ]` → `- [x]`) and say so.
- **Otherwise:** leave the task unticked and list what is blocking it.
- Change nothing else in the plan file.
