---
description: Append what we just did to docs/SETUP_JOURNAL.md (terse)
argument-hint: [optional focus, e.g. "MP-02" or "just the alias bug"]
allowed-tools: Read, Edit, Bash(git -C /Users/malvibhatt/Projects/meal-planner *)
---

Append this session's work to `docs/SETUP_JOURNAL.md`.

Focus: $ARGUMENTS
(If empty, cover everything meaningful from this session.)

## Steps

1. Read `docs/SETUP_JOURNAL.md` to see the existing sections and match their style.
2. Run `git -C /Users/malvibhatt/Projects/meal-planner status --short` and `git -C ... diff --stat` to ground the entry in what actually changed. Do not invent changes.
3. Add entries under the THREE existing headings — never create new top-level sections:
   - **Setup steps** — commands run, config edits, file moves. Reproducible recipe.
   - **Concepts** — React/tooling ideas learned. Add the Angular parallel when there is one.
   - **Errors** — what broke, the cause, the fix.
4. Skip any section with nothing new. Do not write "N/A" or "nothing this session".

## Style rules — these are strict

- **Two lines of prose maximum per entry.** Not two sentences that run three lines. Two lines.
- Short code example only when it genuinely clarifies. Under 6 lines. Often no code at all is right.
- No preamble, no "In this session we...", no recap of what the user already knows.
- Commands go in `bash` fences exactly as run.
- Write for the user re-reading this in 3 months, already knowing React basics.
- Append to the end of the relevant section. Never rewrite or reword existing entries.
- Date-stamp each entry as `**YYYY-MM-DD** — <short title>` so the log stays chronological.

## Rules

- If nothing meaningful happened (just Q&A, no code or config changed), say so and write nothing.
- Do not commit. The user commits.
- After editing, print only the lines you added — no summary paragraph.
