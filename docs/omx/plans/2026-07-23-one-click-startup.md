# One-Click Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Windows batch file that prepares and starts the complete local development environment with one double-click.

**Architecture:** A single root-level `启动.bat` owns orchestration and stops immediately after any failed prerequisite or setup command. A non-mutating `--check` path exercises prerequisite detection and validates the local project state without starting Docker, running migrations, or occupying the development port.

**Tech Stack:** Windows Batch, Node.js, pnpm, Docker Compose, Prisma, Next.js

---

### Task 1: Create the startup script

**Files:**
- Create: `启动.bat`

- [x] **Step 1: Establish a failing verification**

Run:

```powershell
cmd /d /c "call 启动.bat --check"
```

Expected: FAIL because `启动.bat` does not exist.

- [x] **Step 2: Implement the complete batch workflow**

Create `启动.bat` with:

- UTF-8 console setup and project-directory switching.
- `node`, `pnpm`, and `docker` command checks.
- `.env` creation from `.env.example` only when needed.
- Conditional `pnpm install`.
- `docker compose up -d`.
- `pnpm prisma migrate dev`.
- Delayed browser opening.
- Foreground `pnpm dev`.
- Stage-specific failure messages and retained console output.
- A `--check` path that stops before mutating system or project state.

- [x] **Step 3: Run the non-mutating check**

Run:

```powershell
cmd /d /c "call 启动.bat --check"
```

Expected: PASS with a message that environment checks passed.

- [x] **Step 4: Check Git whitespace and inspect the diff**

Run:

```powershell
git diff --check
git diff -- 启动.bat
```

Expected: no whitespace errors; diff contains only the intended startup workflow.

- [x] **Step 5: Commit**

```powershell
git add -- 启动.bat docs/omx/plans/2026-07-23-one-click-startup.md
git commit -m "feat: add one-click Windows startup"
```
