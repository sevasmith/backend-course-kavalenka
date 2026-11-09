---
name: plan-practical-assignment
description: Explain in chat what to do for a range of tasks from a saved plan in docs/plans, about 3-5 sentences per task. Without task numbers, explains the next unfinished tasks. Use when Seva writes something like "/plan-practical-assignment 1.1, tasks 1-3" or "/plan-practical-assignment 1.1".
argument-hint: <plan number>[, tasks <from>-<to>], e.g. 1.1, tasks 1-3
---

# Explain tasks from a plan

Arguments: `$ARGUMENTS`. They name a plan number (e.g. `1.1`) and, optionally, the tasks: a range (`1-3`), a list (`2, 4`) or a single number (`5`).

## 1. Find the plan and the tasks

- Find the file in `docs/plans/` whose name starts with the plan number followed by `_` (e.g. `1.1` → `docs/plans/1.1_rbac.md`).
- Steps in the plan are checkboxes: `- [x]` is done, `- [ ]` is not.
- **No task numbers given:** take the next 3 unticked tasks in order. Say which ones you picked. If every task is ticked, say the plan is finished and stop.
- **A requested task is already ticked:** still explain it, but mark it as done in the heading.
- If the arguments are unclear, no file matches, or a task number doesn't exist in the plan, say so and ask. Don't guess.

## 2. Analyse

- Read the **whole** plan file, including its Notes, so you know what comes before and after the requested tasks and which decisions were already made.
- To make the explanation accurate, skim what the tasks rely on:
  - the matching theory file in `docs/theory/` (its Practical Assignment)
  - the relevant sections of `docs/task.md`
  - the existing code it builds on
- Keep this reading light: it backs up the explanation, it doesn't replace it.

## 3. Answer in chat

- Write nothing to files, and write no project code.
- For each requested task, in order:
  - a heading with the task number and a short title;
  - **3-5 sentences** on what to build, the main decisions, and how it connects to the previous and next tasks;
  - one line on **how to check it works** (a command, an HTTP request, a DB query or a test).
- Use names from the course docs and the code: tables, files, endpoints, env variables.
- Mention a Note from the plan, or a mismatch with `task.md`, only when it affects these tasks.
- No long theory and no code snippets. The details come later, when Seva asks to implement each task.
- Finish with one line asking whether to start implementing the first unfinished task.
