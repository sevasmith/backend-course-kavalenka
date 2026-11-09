---
name: practical-assignment
description: Create a short, step-by-step plan for the Practical Assignment of one theory file in docs/theory and save it to docs/plans. Use when Seva says they are working on a theory file's Practical Assignment and asks for a plan, e.g. "/practical-assignment 1.1 RBAC".
argument-hint: <number> <name of the theory file>, e.g. 1.1 RBAC
---

# Practical Assignment plan

Create a general plan for the Practical Assignment of the theory file named in the arguments: `$ARGUMENTS`.

## 1. Find the theory file

- Match the arguments against the files in `docs/theory/` by number first (e.g. `1.1`), then by name. Example: `1.1 RBAC` → `docs/theory/1.1 RBAC.md`.
- If there are no arguments, or no file or several files match, list the theory files and ask which one. Don't guess.

## 2. Gather the context

Read, in this order:

1. **The theory file**, in full: the Theory, the Theory Questions and, most importantly, the **Practical Assignment** (scenarios, contract, errors, audit, non-functional requirements).
2. **`docs/task.md`**: the sections for this part. It is the final source of truth.
3. **Neighbouring theory files**, only where this part depends on them or hands work to them. For example, RBAC passes the `userId` to authentication, and registration assigns the `user` role.
4. **`docs/diagrams/`** (Seva's ER and status diagrams) and **`README.md`** (project structure and conventions).
5. **The code and git history**, to see what is already built. The plan must not repeat finished work, and it should reuse existing modules, config and entities.

## 3. Write the plan

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

  1. <step>
  2. <step>
  ...

  ## Notes

  - <mismatch or open question, only if there are any>
  ```

- If the file already exists, show Seva what would change and ask before overwriting it.

## 5. Report back

In a few lines, give:

- the path of the saved file
- the number of steps
- any mismatches or open questions

Then ask whether to start with step 1. Don't write any code for the steps until Seva asks for it.
