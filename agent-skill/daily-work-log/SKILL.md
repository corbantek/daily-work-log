---
name: daily-work-log
description: Read and update the user's local Daily Work Log app (their record of tasks, meetings and workstreams) through its /agent HTTP API on localhost. Use when the user asks what is on their plate or on today, what they did this week or in a period, to log, find or update a task, to mark a task done, to add notes, a link or a file/attachment to a task or meeting, to read or summarize a file attached to one, to record a meeting or paste meeting notes, to create a task from a meeting, to draft a standup or status update from their work log, to record or look up a coworker (who someone is, their role, team, what their group works on, who they report to — the user's personal org tree), to add notes about a person or log an interaction / peer-feedback observation, to draft peer-review input for someone, to tidy or clean up a task's notes, or mentions a task, meeting or person reference like T42, M17 or P12.
allowed-tools: Bash(curl *)
---

# Daily Work Log

The user's Daily Work Log is a personal app running on this machine. Talk to it only through its
`/agent` endpoints with `curl`. They take and return JSON, accept names instead of ids, and record
every change you make.

## Connect

```bash
API="${WORKLOG_API:-http://localhost:4747}"
curl -sf "$API/health"
```

If the health check fails, stop and tell the user the app isn't running (they start it with
`make dev`, or `make restart-agent` for the background service). Don't retry in a loop.

When you are unsure about an endpoint or its fields, ask the app instead of guessing:

```bash
curl -s "$API/agent/help"
```

## Rules

- **Dates** are local `YYYY-MM-DD` and default to today. Work out "yesterday", "Monday" and
  "last week" from today's date yourself. Times are 24-hour `HH:MM`.
- **Workstreams and labels by name.** A unique partial name works ("devops"). An unknown or
  ambiguous name returns `400` with the valid options: pick the intended one, or ask the user if
  it isn't clear. Never invent a workstream. The names in the examples below are only examples —
  use the user's own, from `/agent/day`, `/agent/open` or that error.
- **Task states:** `todo`, `in_progress`, `complete`, `abandoned` ("done" also works).
- **Follow-up work is written as `TODO:`**, one item per line or bullet (`- TODO: share the numbers
  with Zz`). Never use "Next:", "Next steps" or similar for it: the app highlights `TODO` in red and
  `DONE` in green, so the keywords are what make follow-ups visible. When a follow-up is finished,
  change its `TODO:` to `DONE:` rather than deleting it — except in a task's **What's Next**, which
  holds only open work: there the finished item moves into Progress (see "Task notes" below).
- **`TODO:` is only for the user's own follow-ups.** In meeting notes especially, mark as `TODO:`
  only the action items that are the user's (assigned to them by name, or "I"/"me"/"we'll have
  <user> …"). Write everyone else's as plain statements without the keyword — "Zz will share
  the benchmark" — so the red TODOs stay a list of what the user has to do. If you can't tell
  which name is the user's, or whether an item is theirs, ask.
- **Keep notes clean, not just longer** — see "Writing notes" below. Append when the note only
  needs something new; rewrite the note when appending would leave repeated information or
  finished TODOs behind.
- **References.** Every task and meeting has a short reference, `T42` or `M17` (people: `P12`; the `ref` field;
  the app shows it next to each title). When the user gives one ("mark T42 done", "add this to
  M17"; "T42" works too), use it directly wherever an id goes: `/agent/tasks/T42`, `"task_id": "T42"`,
  `"parent_id": "T42"`. Mention the reference when you report what you changed.
- **Find before you change.** Without a reference, look the task or meeting up (day view, search or
  list) to get its `ref`; if several match, ask which one. Confirm with the user before making more than three changes
  at once.
- **There are no deletes.** If the user wants something removed, tell them to do it in the app.
- **Don't conclude something is impossible from one failure.** Before telling the user the app
  can't do something, check `GET /agent/help`, which lists every endpoint. A failure on one kind
  of item (say, a meeting link) says nothing about other operations (say, a meeting file); try
  the right endpoint. If something really isn't supported, say exactly what, and why.
- **After a change,** tell the user briefly what changed, in their words, not ids.
  `GET /agent/activity` lists everything changed through this API.
- Send JSON bodies with a quoted heredoc so apostrophes and newlines in notes survive:
  `curl -s -X POST "$API/…" -H 'Content-Type: application/json' --data-binary @- <<'JSON'` … `JSON`.

## Look things up

```bash
curl -s "$API/agent/day"                          # today: status, on-call, meetings, tasks by workstream
curl -s "$API/agent/day?date=2026-10-21"          # another day
curl -s "$API/agent/open"                         # everything still todo / in progress
curl -s "$API/agent/tasks?state=in_progress&workstream=devops"
curl -s "$API/agent/tasks?q=retries&date_from=2026-10-01&date_to=2026-10-31"
curl -s "$API/agent/tasks/T42"                   # full task: notes, links, files, meetings, sub-tasks
curl -s "$API/agent/meetings"                     # today's meetings
curl -s "$API/agent/meetings?date_from=2026-10-19&date_to=2026-10-25&q=sync"
curl -s "$API/agent/meetings/M17"                # full meeting: notes, tasks, links, files
curl -s "$API/agent/search?q=dynamodb"            # tasks, meetings, people, interactions (also finds T42 / M17)
curl -s "$API/agent/summary"                      # this week so far; or ?date_from=&date_to=
```

Lists show a short `notes_preview`; fetch the single task or meeting when you need the full notes.

## Change things

Create a task (only `action`, the title, is required; `start_date` defaults to today):

```bash
curl -s -X POST "$API/agent/tasks" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"action": "Review the team's CI changes", "workstream": "DevOps", "state": "in_progress", "labels": [], "high_impact": false}
JSON
```

Add `"parent_id": "T42"` to make it a sub-task (leave `workstream` out: it takes the parent's). That
also works when creating a task from a meeting. Sub-tasks go one level deep only: if T42 is itself a
sub-task, use its parent. To move an existing task under another, or back to top level, PATCH it
with `"parent_id": "T42"` (or `""`).

If you have anything to note about a new task, write it in the **Task notes** shape (below) from
the start (Context, today's Progress, What's Next, and a status line) and send it as `notes` in the
create call, not as a separate append afterwards. The same goes for a task created from a meeting.

Update a task (send only what changes):

```bash
curl -s -X PATCH "$API/agent/tasks/T42" -H 'Content-Type: application/json' -d '{"state": "complete"}'
```

Fields: `action`, `state`, `high_impact`, `workstream` (`""` for none), `labels`, `start_date`,
`end_date`, `parent_id`. Completing a task with open sub-tasks is refused; tell the user.

Add to a task's or meeting's notes (markdown). See "Writing notes" for when to rewrite instead:

```bash
curl -s -X POST "$API/agent/tasks/T42/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "- Found the root cause: the retry loop didn't back off.\n- TODO: add a backoff test"}
JSON
```

Use `/agent/meetings/M17/notes` for a meeting, e.g. when the user pastes AI meeting notes. Keep
pasted meeting notes as the user gave them unless they ask you to tidy them.

Add a link to a task or a meeting (the type — pr, issue, doc, slack, quip, other — is guessed from the URL):

```bash
curl -s -X POST "$API/agent/tasks/T42/links" -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com/org/repo/pull/123", "label": "Retry fix PR"}'
curl -s -X POST "$API/agent/meetings/M17/links" -H 'Content-Type: application/json' \
  -d '{"url": "https://docs.example.com/agenda", "label": "Agenda"}'
```

Record a meeting, or change one (`exclude_from_stats: true` keeps parties and conferences out of
the meeting-time stats; `passive: true` marks one the user attended without participating, working
through it; it still counts as meeting time but not as engaged time. Set `passive` only when the user
says so, never by guessing from the notes):

```bash
curl -s -X POST "$API/agent/meetings" -H 'Content-Type: application/json' \
  -d '{"title": "Platform sync", "start_time": "14:00", "duration_minutes": 30}'
curl -s -X PATCH "$API/agent/meetings/M17" -H 'Content-Type: application/json' -d '{"exclude_from_stats": true}'
```

Create a task that came out of a meeting, or link an existing one:

```bash
curl -s -X POST "$API/agent/meetings/M17/tasks" -H 'Content-Type: application/json' \
  -d '{"action": "Share bottleneck numbers", "workstream": "DevOps"}'
curl -s -X POST "$API/agent/meetings/M17/tasks" -H 'Content-Type: application/json' -d '{"task_id": "T42"}'
```

## Files

Tasks and meetings can have files attached (documents, decks, screenshots, exports).

```bash
curl -s "$API/agent/tasks/T42/files"                          # or /agent/meetings/M17/files
curl -s "$API/agent/files/FILE_ID"                            # one file's details and, for text, its contents
curl -s -X POST "$API/agent/tasks/T42/files" -F "file=@/Users/me/Downloads/runbook.md"
curl -s -X POST "$API/agent/meetings/M17/files" -F "file=@/Users/me/Desktop/q3-deck.pdf"
```

- **Attach only what the user asked for.** If the path is unclear ("that PDF I downloaded"), find
  candidates and confirm the exact file with the user before uploading. 25 MB at most per file.
- **Files shared in Slack are attached, not linked.** When Slack content you are logging (a
  message or thread) has files attached, download each one to a temporary local path with the
  Slack tools and attach it to the task or meeting here; don't add a Slack file link instead.
  If no available tool can download it (some Slack integrations can't), say so, name the file,
  and ask the user to save it locally so you can attach it; don't silently fall back to a link.
- **Reading files for context:** markdown, text, CSV, JSON and HTML come back in `content`
  (`truncated` is true for very long files). For PDFs, images and other files `content` is null —
  open the returned `path` with your file-reading tool instead.
- Single tasks and meetings (`GET /agent/tasks/T42`) also list their `files` with their ids.

## People and the org tree

The user's company doesn't publish titles, teams or reporting lines, so the user builds their own
org tree here as they learn things. Each person has a `role` (their own job), a `team`, a `focus`
(what the group works on), a `manager`, a free-form `relationship` (Report, Peer, Manager,
Cross-functional, Other) and markdown `notes`.

**Inheritance:** a person whose `team` or `focus` is blank inherits it from the nearest manager who
has one (responses say `team_inherited_from`). So set team/focus on the **highest person it applies
to** — usually the manager — not on each report; set it on a report only when theirs differs.
`role` is never inherited. `own` in a person's details shows what's set on them directly.

```bash
curl -s "$API/agent/people?q=dana"                 # find someone (name, role, notes, team, focus)
curl -s "$API/agent/people?team=maps"              # everyone whose team/focus (inherited too) matches
curl -s "$API/agent/people/tree"                   # the whole tree; each node shows only its own values
curl -s "$API/agent/people/P12"                    # one person: team/focus, manager chain, reports, notes, recent interactions
```

Add a person, or record what the user learned about one (send only what changes; `manager` takes a
reference or a unique name; `"team": ""` makes it inherited again, `"manager": ""` removes the manager):

```bash
curl -s -X POST "$API/agent/people" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"name": "Dana Ruiz", "role": "Director", "manager": "P3", "team": "Maps Data", "relationship": "Cross-functional"}
JSON
curl -s -X PATCH "$API/agent/people/P12" -H 'Content-Type: application/json' -d '{"manager": "Dana Ruiz", "focus": "Offline map tiles"}'
```

- **Look before you add.** Search for the person first so you don't create a duplicate; if a name
  matches several people (400 with `matches`), use the reference or ask.
- **Record only what the user (or their notes) actually says.** Don't infer a title, team or
  reporting line from an email address, a meeting invite or a guess. If something is uncertain
  ("I think she's on the routing team"), say so in the person's notes rather than setting the field.
- **Unknown manager:** when the user knows two people share a manager but not who, create a
  placeholder (`"name": "? (Omar's manager)", "placeholder": true`), put both under it, and give it
  the team/focus you know. When the manager is identified, rename the placeholder and set
  `"placeholder": false` instead of creating a second person.
- **Person notes** follow the same rules as other notes (append; rewrite with `"mode": "replace"`
  when that would avoid repetition), backed up before every change:

```bash
curl -s -X POST "$API/agent/people/P12/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "- Owns the tile-cache rollout; good contact for offline questions."}
JSON
```

### Interactions (peer feedback)

An interaction is a dated observation about one person (it feeds the user's peer reviews):
`summary` (one line), `sentiment` — `strength`, `growth` or `neutral` (the default) — competency
`tags`, optional `notes`, `workstream` and `high_impact`. Tags are `"Dimension"` or
`"Dimension: attribute"`; a unique part of either is enough. Get the valid ones from
`GET /agent/framework`.

```bash
curl -s "$API/agent/framework"
curl -s -X POST "$API/agent/people/P12/interactions" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"summary": "Walked the team through the sync design", "sentiment": "strength", "tags": ["Teamwork: shares context"], "notes": "Clear doc, answered every question."}
JSON
curl -s -X PATCH "$API/agent/interactions/INTERACTION_ID" -H 'Content-Type: application/json' -d '{"tags": ["Teamwork", "Impact"]}'
curl -s "$API/agent/people/P12/interactions?date_from=2026-01-01"
curl -s "$API/agent/people/P12/review-draft?date_from=2026-01-01"   # evidence arranged for a peer review
```

- **Log interactions only when the user asks** (or clearly says it's feedback about that person).
  Facts about someone's job go in their fields or notes, not in an interaction.
- Pick the sentiment and tags from what the user said; if it isn't clear whether something is a
  strength or a growth area, ask. On PATCH, `tags` and `notes` replace what was there.
- For "help me write feedback for Dana", start from `review-draft` and base the draft only on the
  logged evidence; say where the evidence is thin.

## Writing notes

Before changing a note, read the whole thing (`GET /agent/tasks/T42` or `/agent/meetings/M17`).

- **Only something new?** Append it (the default).
- **Would appending repeat what's already there, or leave TODOs that are now done?** Rewrite the
  note instead and send it whole with `"mode": "replace"`:
  - merge repeated or overlapping points into one,
  - turn finished `TODO:` items into `DONE:`, and keep open ones as `TODO:` (in a task's What's
    Next, move finished items into Progress instead — see "Task notes"),
  - keep every fact, link and decision, and keep the user's own wording and headings —
    tidy, don't summarise away detail or drop anything you weren't asked to remove.
- Tell the user when you rewrote a note and what you merged or marked done.

### Tidy as you go

Whenever you write a task's notes anyway (you're already sending the whole note), tidy it in the
same change. Only then — never on a read-only request, and only the note you're changing:

- **What's Next:** take out finished items (after checking they're in Progress) and items that no
  longer apply; keep the order current.
- **Status line:** rewrite it.
- **Context:** when a decision or number is superseded, update it in place but keep the history
  ("revised Oct 30: …", "was 28, now about 23 on develop"). Merge points that say the same thing.
- **Progress:** merge only facts recorded twice. Never cut or condense past days in a routine
  update.
- **Something looks wrong or contradicts something else?** Point it out to the user and ask —
  never correct it silently.
- Say what you tidied ("moved 3 finished items out of What's Next, merged a repeated decision in
  Context").

**Deep tidy, only when the user asks** ("tidy T32", "clean up T32's notes"): you may also condense
older Progress days, reorganize Context and remove what has stopped being useful. Before saving,
show the user the main cuts and condensations and wait for their OK; the automatic backup covers
the rest.

### Task notes

Use this shape whenever you write a task's notes: when you create the task as well as when you
update it.

A task's notes have four jobs. Keep them doing all four as the task evolves:

1. **Context** — what the task is, why it matters, the intended approach, key decisions and open
   questions, and the background or links needed to pick it up. Written when the task starts;
   updated when the goal, approach or a decision changes.
2. **Progress — what was done and where the time went.** Grouped by day, oldest first: a date
   line (`**Oct 22**`; add the year only if it isn't the current one) with that day's work as
   bullets underneath. If the day already has a heading, add to it instead of starting a second
   one. Write work at a meaningful level — the outcome and anything worth knowing later ("Step 0,
   draft PR #4725: added a DB-request counter and a report-only budget test"), not every small
   step ("ran lint", "fixed a typo"). Add rough effort when you know it or the user mentions it —
   on the date line for the day (`**Oct 22** (~3h)`) or on a single item; never guess.
3. **Wins — for review season.** Anything with impact: shipped work, problems solved, numbers
   moved, people unblocked, recognition received. Concrete ("cut p99 latency from 900 ms to
   520 ms", not "improved performance"), with the PR, doc or thread as evidence, and estimates
   labelled as estimates. When a win is significant, suggest marking the task ⚡ high-impact —
   ask; don't set it yourself.
4. **What's Next — only what's still to do.** The user's open follow-ups as `TODO:` items, in the
   order they'll be done (next action first, `Later:` items last), plus plain lines for what the
   user is waiting on from others ("Waiting on Joshua about …"). Never `DONE:` items: when one is
   finished, make sure Progress records it under the day it was done (add it if missing), put any
   decision it settled in Context, and then remove it from What's Next. Update the list on every
   change: add new items, take out finished ones, drop what's no longer relevant, and ask about
   items whose deadline has passed.

End with a **status line** that starts with a bold `**Status:**`: a sentence or two on where the
task stands right now. It's the last line of the note, and you rewrite it on every update.

**Keep it readable, without losing work.** Short bullets, links instead of pasted text, and a level
of detail like a good standup update; long notes are fine when the work was substantial. Don't
drop or summarize away past work — Progress is the record of what the user did. You may merge
entries that repeat each other (the same fact recorded twice), and keep wins and decisions in
their own sections.

**Dates:** use a date the note or the user gives. Infer one only from clear evidence (a linked
meeting that day, an activity timestamp) and say so when you report the change; otherwise ask, or
put the item under `**Earlier**`.

**Updating:** new work belongs inside its section (today's Progress, What's Next) and the status line is
last, so updating a structured task note normally means sending the whole revised note with
`"mode": "replace"` rather than appending to the end. The previous version is backed up first.

**Existing notes in another shape:** the first time you update such a task, reorganize its notes
into this shape, keeping every fact, link, decision and the user's wording (a backup is saved
automatically). That includes moving any `DONE:` items out of What's Next into Progress. Tell the user you reorganized them, and which dates you inferred.

Shape (omit empty sections):

```markdown
**Context**
Retries on the LPS registration path pile up under load. Goal: add exponential backoff so a slow
DB doesn't cascade. Background: incident review (link).

**Progress**
- **Oct 20** (~2h)
  - Traced the retries to a missing backoff.
- **Oct 22**
  - Merged the backoff fix (PR #123) (~1.5h).
  - Measured p99 on staging before and after, and shared the numbers with Zz.

**Wins**
- Cut p99 latency from 900 ms to 520 ms (PR #123).

**What's Next**
- TODO: add a backoff regression test
- Waiting on Zz to confirm the staging numbers match production

**Status:** fix shipped and measured; only the regression test is left.
```

### Splitting out a sub-task

When you add a TODO or tidy What's Next, check whether an item is really its own piece of work:
it will take more than one sitting or its own working session; it gets its own PR, investigation or
design with findings worth recording; it involves other people or waiting on them; or tracking it
in the parent would add several Progress bullets or Context points that aren't about the parent's
goal. One-step items (merge a PR, retarget a branch, reply to a comment) stay as TODOs.

**Ask; don't create it yourself.** Name the item and why it qualifies ("Step 3 looks like its own
sub-task: research O1, then an implementation PR. Open one under T32?"). At most one question per
update, with all candidates in it. If the user says no, don't ask about that item again this
session.

**If the user says yes:**

- **Create it** with `"parent_id"` (it takes the parent's workstream), state `todo`, and notes in
  the task shape above. Its notes are the **handoff**: a fresh agent in a new session should be
  able to start from them alone, without the parent's history.
  - **Context:** the goal and what "done" looks like; why it was split out and how it serves the
    parent; the parent's decisions, constraints and open questions that apply, copied in with
    "(from T32)" rather than "see T32"; where the work lives (repos, branches, PRs, files, paths)
    and who to talk to; gotchas and earlier findings.
  - **What's Next:** the first concrete steps.
  - **Status:** "Not started; split out from T32 on Oct 30."
- **Update the parent** in the same pass: the What's Next item becomes a one-line pointer
  (`- TODO: Step 3: single commit at Registration Accept (T51)`); detail that moved into the
  sub-task comes out of the parent, keeping anything still about the parent's own goal; add a
  Progress line ("Split out T51 for …"); rewrite the status line.
- **Give the user a starting prompt** for a fresh session, since you can't start one yourself:
  > Work on T51 (Step 3: single commit at Registration Accept). Read its notes with the
  > daily-work-log skill first, then start on the first TODO. Record progress in T51's notes as you go.
- Sub-tasks go one level deep. If the parent is itself a sub-task, offer a sibling under its
  parent instead.

**Keep parent and sub-tasks linked.** A parent TODO that has a sub-task names its reference
(`(T44)`), never just "(sub-task)". The sub-task's day-by-day work lives in its own notes; the
parent's Progress doesn't repeat it. When a sub-task is completed, take its pointer out of the
parent's What's Next, add a one-line Progress entry to the parent ("T50 done: …"), and suggest
copying a significant win up to the parent.

Meeting notes keep the general rules above (and `TODO:` only for the user's own action items).

The app saves the previous version automatically before every notes change, for 30 days. The
response's `notes_backup` field names it. If a change went wrong, or the user wants the old text
back:

```bash
curl -s "$API/agent/notes-backups/T42"                        # earlier versions, newest first
curl -s "$API/agent/notes-backups/T42/BACKUP_NAME"            # one version's text
```

Restore it by sending that text back with `"mode": "replace"` (which is itself backed up first).

## Writing summaries

For "what did I do this week" or a standup, start from `/agent/summary` (add `date_from` /
`date_to` for other periods) and `/agent/day` for single days. Group by workstream, lead with
completed and high-impact work, and mention meeting load only if it is notable. Base everything on
what the log says; if something is missing, say so instead of filling it in.
