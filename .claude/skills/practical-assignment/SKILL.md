---
name: practical-assignment
description: Create a short, step-by-step plan for the Practical Assignment of one theory file in docs/theory and save it to docs/plans. Use when Seva says they are working on a theory file's Practical Assignment and asks for a plan, e.g. "/practical-assignment 1.1" or "/practical-assignment 1.1 RBAC".
argument-hint: <number> [name of the theory file], e.g. 1.1 or 1.1 RBAC
---

# Practical Assignment plan

Create a general plan for the Practical Assignment of the theory file named in the arguments: `$ARGUMENTS`.

## 1. Find the theory file

- The number alone is enough: find the file in `docs/theory/` whose name starts with that number followed by a space. Example: `1.1` → `docs/theory/1.1 RBAC.md`.
- If a name is given too (`1.1 RBAC`), match by number first. If there's no number, match by name.
- If there are no arguments, or no file or several files match, list the theory files and ask which one. Don't guess.

## 2. Gather the context

Read, in this order:

1. **The theory file**, in full: the Theory, the Theory Questions and, most importantly, the **Practical Assignment** (scenarios, contract, errors, audit, non-functional requirements).
2. **`docs/task.md`**: the sections for this part. It is the final source of truth.
3. **Neighbouring theory files**, only where this part depends on them or hands work to them. For example, RBAC passes the `userId` to authentication, and registration assigns the `user` role.
4. **`docs/diagrams/`** (Seva's ER and status diagrams) and **`README.md`** (project structure and conventions).
5. **The code and git history**, to see what is already built. The plan must not repeat finished work, and it should reuse existing modules, config and entities.

## 3. Write the plan

### Overview

Before the task list, write a short **Overview**: the general path through this assignment, so Seva can see quickly what needs to be done.

- A numbered list of about 5 to 8 stages. Group the tasks into stages; don't explain every task.
- Each stage starts with a bold **title that is a simple action**, followed by its task numbers: `**Make tables to store who can do what** (tasks 1–3)`. Titles say what to do, not just a noun, and avoid technical terms.
- Under the title, write 1 or 2 short sentences: what this stage does and why it comes at this point (what it unlocks or what depends on it).
- After the list, add one line, `**In the end:** …`, saying what works once all tasks are done.
- Use very simple, clear language, as if explaining to a child: short sentences, everyday words. Use a technical term only if Seva already knows it from earlier parts. No metaphors or analogies (restaurants, bouncers, etc.) and no code.

Example stage:

```markdown
1. **Make tables to store who can do what** (tasks 1–3)
   We need a place to keep roles, permissions and the links between them. Everything else uses these tables, so we make them first.
```

### Tasks

- A numbered list of steps in build order. Each step builds on the previous ones and fits in roughly one sitting.
- **Keep each step short**: one or two lines saying *what* to build. Leave out the *how*, code, and long explanations; those come later, one step at a time.
- Cover the whole Practical Assignment, typically in this order:
  1. data model and migration
  2. config
  3. core logic
  4. guards and decorators
  5. endpoints
  6. integration with other parts
  7. error mapping
  8. audit logging
  9. OpenAPI docs
  10. tests (coverage ≥ 80%)
  11. final step: run `npm run lint`, `npm run test` and `npm run build`, then check the scenarios manually with an HTTP client
- Use the names from the course docs: table, endpoint, env variable, permission and status-code names.
- Where `task.md` and the theory file disagree, follow `task.md`. Add a short **Notes** section after the steps listing each mismatch and each open question for the course mentor. Never invent requirements.

## 4. Save the plan

- Path: `docs/plans/<number>_<name>.md`.
  - `<number>` is the theory file's number.
  - `<name>` is the rest of the theory file's name in lowercase, with spaces replaced by `_`.
  - Examples: `1.1 RBAC.md` → `docs/plans/1.1_rbac.md`; `1.4 Viewing User Data.md` → `docs/plans/1.4_viewing_user_data.md`.
- File format:

  ```markdown
  # <number> <Name> — Plan

  ## Overview

  1. **<Simple action title>** (tasks 1–3)
     <1–2 short sentences: what this stage does and why it comes here>
  2. **<Simple action title>** (task 4)
     <...>
  ...

  **In the end:** <what works once all tasks are done>

  ## Tasks

  - [ ] 1. <step>
  - [ ] 2. <step>
  ...

  ## Notes

  - <mismatch or open question, only if there are any>
  ```

- Every step is an unticked checkbox with its number. The step is ticked (`- [x]`) once it is done and reviewed (see the `review-task` skill). Keep the numbers stable: other skills refer to tasks by number.
- If the file already exists, show Seva what would change and ask before overwriting it. Keep the ticks of steps that are already done. If it has no Overview yet, add one.

## 5. Report back

In a few lines, give:

- the path of the saved file
- the number of steps
- any mismatches or open questions

Then ask whether to start with step 1. Don't write any code for the steps until Seva asks for it.
