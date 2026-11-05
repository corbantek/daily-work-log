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
the start (Context, today's Progress, What's Next) and send it as `notes` in the create call, not as
a separate append afterwards, together with a one-line `status`. The same goes for a task created
from a meeting.

Update a task (send only what changes):

```bash
curl -s -X PATCH "$API/agent/tasks/T42" -H 'Content-Type: application/json' -d '{"state": "complete"}'
```

Fields: `action`, `status` (see "Status and wins"), `state`, `high_impact`, `workstream` (`""` for none), `labels`, `start_date`,
`end_date`, `parent_id`. Completing a task with open sub-tasks is refused; tell the user.

Add to a task's or meeting's notes (markdown). See "Writing notes" for when to rewrite instead:

```bash
curl -s -X POST "$API/agent/tasks/T42/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "- Found the root cause: the retry loop didn't back off.\n- TODO: add a backoff test"}
JSON
```

Use `/agent/meetings/M17/notes` for a meeting, e.g. when the user pastes AI meeting notes. Keep
pasted meeting notes as the user gave them unless they ask you to tidy them.

Add a link to a task or a meeting (the type — pr, issue, radar, doc, slack, quip, grafana, other — is guessed from the URL):

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
- **`agent-context.md` is the one file you may replace**, and only through
  `/agent/tasks/T42/context` (see "Sessions and agent context"); never upload a second copy.

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

## Sessions and agent context

The user works one task or sub-task per session, so a fresh agent should be able to pick a task up
from the app alone. Each task (and meeting) can have a file named **`agent-context.md`** for what
such a session needs and the human notes don't: it is an ordinary attachment (the user can open it
under Files), but you read and replace it through two calls:

```bash
curl -s "$API/agent/tasks/T69/context"        # {exists, content, ...}; exists:false if there is none
curl -s -X POST "$API/agent/tasks/T69/context" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "# Agent context\n\n**Reads first**\n- T32 context; T68 Handoff\n..."}
JSON
```

The POST creates the file or **replaces the whole thing** (send all of it; never append). The
previous version is backed up first (`context_backup`; read earlier versions with
`/agent/notes-backups/T69-context`). `/agent/meetings/M17/context` works the same. Task details
carry `has_context`. Create one only when there is something a fresh session needs; short tasks
and small handoff briefs don't need it.

**Shape** (omit empty sections; keep it current, not a log):

```markdown
# Agent context

**Reads first**
- T32 context; T68 Handoff        <- files/sections a fresh session reads before starting

**Where things live**
- repo, branch, PRs, files, scripts, who to ask

**Binding decisions and constraints**
- the current answer, with the reason; "(from T32)" if copied from the parent

**Gotchas and lessons**
- what bit us; what to check first

**Handoff**
- what the next session on the next task needs to know (written when you finish a session)
```

Rewrite it to the current state each time: drop what stopped being true, merge duplicates, and
keep it short enough that reading it costs little. It is for agents, so skip what's in the repo
or the human notes.

**Session start** (the user opens a fresh session with a task reference, usually from its Start
prompt):

1. Read the task (`GET /agent/tasks/T69`), then its context. Follow "Reads first": the parent's
   context, and the predecessor's **Handoff**. Read the pointers instead of copying their facts.
2. On your first write, **remove the Start prompt section** from the notes (it has done its job),
   set the state to `in_progress`, and tell the user. If you only read, leave the prompt in. If a
   task that is already in progress still has one, remove it and mention it.

**Session end** (when the user wraps up, or you finish the task's current stretch):

1. Update the notes (today's Progress, What's Next), `status`, and wins, as usual.
2. Rewrite the task's context file, including a **Handoff** section for whoever works next.
3. If the next task is clear (the parent's What's Next order, or a dependent sub-task), make sure
   its context lists this task under "Reads first", and write or refresh the **Start prompt** at
   the top of its notes. If you can't tell what comes next, ask.
4. Tell the user what you wrote where.

**Start prompt** = a small fenced block at the very top of a TODO task's notes, written by the
agent that knows the most about what's coming, so the new session starts well:

````markdown
**Start prompt**
```
Work on T69 (keep the held Registration Response in memory). Read its notes and agent context with
the daily-work-log skill first. Start with the first TODO: check the T68 drain is merged, then ...
Watch out for ...
```
````

It names the task, tells the session to read the notes and context (only mention the context if
the task has one), gives the specific first move and any trap, and stops there; everything else
belongs in the notes or the context file. Write it only for tasks that are TODO and will be
started in a new session. It is removed at session start, as above, never left behind.

## Writing notes

Before changing a note, read the whole thing (`GET /agent/tasks/T42` or `/agent/meetings/M17`).

- **Only something new?** Append it (the default).
- **Would appending repeat what's already there, or leave TODOs that are now done?** Rewrite the
  note instead and send it whole with `"mode": "replace"`:
  - merge repeated or overlapping points into one,
  - turn finished `TODO:` items into `DONE:`, and keep open ones as `TODO:` (in a task's What's
    Next, move finished items into Progress instead — see "Task notes"),
  - keep what passes the review-time test below, and keep the user's own wording and headings.
- **Nothing older than today is deleted or condensed without the user seeing it first.** Merging
  repeated facts and ticking off TODOs is fine; anything beyond that is shown as "removing: …" and
  needs their OK (see "Deep tidy").
- Tell the user when you rewrote a note and what you merged or marked done.

**The review-time test: what belongs in the human notes.** The notes serve two readers: the user
at review time ("what meaningful work did I do this year?") and the user tomorrow ("where was I,
what's next?"). Keep what answers either: outcomes, shipped work, decisions and their reasons,
numbers that moved, who was unblocked, open questions, what's next. Detail only a future agent
session needs (where things live, branch names, lessons, review-round findings) goes in the
task's agent context (see "Sessions and agent context"). Detail nobody will need again (review
rounds, superseded estimates, play-by-play of intermediate commits, text already in the repo or a
PR) is simply left out or deleted. Nothing is saved off "just in case": the user won't read an
archive.

### Tidy as you go

Whenever you write a task's notes anyway (you're already sending the whole note), tidy it in the
same change. Only then — never on a read-only request, and only the note you're changing:

- **What's Next:** take out finished items (after checking they're in Progress) and items that no
  longer apply; keep the order current.
- **Status:** set the task's `status` field to match (see "Status and wins"); notes no longer carry
  a status line.
- **Wins:** if the note or today's work contains a win that isn't recorded yet, add it as a win
  (see "Status and wins"). Don't leave a Wins section in the notes.
- **Context:** when a decision or number is superseded, update it in place; keep a short "was X"
  only if the change itself matters at review time. Merge points that say the same thing.
- **Progress:** add today, and merge only facts recorded twice. Never cut or condense past days in
  a routine update. If past days have grown into detail that fails the review-time test, say so
  and offer a deep tidy; don't do it unasked.
- **Agent context:** when today's work produced something a fresh session needs (a new path,
  decision, gotcha), put it in the context file rather than the notes, and rewrite that file.
- **Something looks wrong or contradicts something else?** Point it out to the user and ask —
  never correct it silently.
- Say what you tidied ("moved 3 finished items out of What's Next, merged a repeated decision in
  Context").

**Deep tidy, only when the user asks** ("tidy T32", "clean up T32's notes"): you may also condense
older Progress days, reorganize Context and delete what has stopped being useful. Judge by the
review-time test. Before saving, show the user the proposed note, the context file if there is one,
and a list of every deletion and condensation (the original line next to its replacement), and
wait for their OK. Deleted text is not archived anywhere; the automatic note backup (30 days) is
only a safety net for mistakes. When detail moves to the agent context, say so.

### Task notes

Use this shape whenever you write a task's notes: when you create the task as well as when you
update it.

A task's notes have three jobs. Keep them doing all three as the task evolves (the one-line
status and the wins are separate fields, not part of the note; see "Status and wins"):

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
3. **What's Next — only what's still to do.** The user's open follow-ups as `TODO:` items, in the
   order they'll be done (next action first, `Later:` items last), plus plain lines for what the
   user is waiting on from others ("Waiting on Joshua about …"). Never `DONE:` items: when one is
   finished, make sure Progress records it under the day it was done (add it if missing), put any
   decision it settled in Context, and then remove it from What's Next. Update the list on every
   change: add new items, take out finished ones, drop what's no longer relevant, and ask about
   items whose deadline has passed.

**Keep it readable.** Short bullets, links instead of pasted text, and a level of detail like a
good standup update. There is no length limit, and don't shorten a note just to make it shorter:
Progress is the record of meaningful work the user did, so what passes the review-time test stays.
Write each entry at outcome level in the first place ("Merged #4801 (step 2): 23 → 18 requests"),
not as a changelog ("five review rounds fixed a crash, a leak, …"). You may merge entries that
repeat each other (the same fact recorded twice).

**Parent tasks** get one Progress line per sub-task event ("T52 done: failed Registration Response
now recovers on the Auth Response retry"), and keep only the decisions that are current for the
parent's own goal. A sub-task's day-by-day work and its decision history live in the sub-task.

**Dates:** use a date the note or the user gives. Infer one only from clear evidence (a linked
meeting that day, an activity timestamp) and say so when you report the change; otherwise ask, or
put the item under `**Earlier**`.

**Updating:** new work belongs inside its section (today's Progress, What's Next), so updating a
structured task note normally means sending the whole revised note with `"mode": "replace"` rather
than appending to the end. The previous version is backed up first.

**Existing notes in another shape:** the first time you update such a task, reorganize its notes
into this shape, keeping what passes the review-time test, every link, and the user's wording
(a backup is saved automatically; show the user anything you would remove, as in a deep tidy). That includes moving any `DONE:` items out of What's Next into Progress, moving a trailing
`**Status:**` line into the `status` field, and turning a **Wins** section into wins (when it isn't
clear which day a win happened, use the day of the Progress entry it relates to, else ask). Tell the
user you reorganized them, and which dates you inferred.

Shape (omit empty sections). A TODO task that is waiting for a session may also start with a
**Start prompt** (see "Sessions and agent context"):

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

**What's Next**
- TODO: add a backoff regression test
- Waiting on Zz to confirm the staging numbers match production
```

with, set on the task itself, `status`: "Fix shipped and measured; only the regression test is left."
and a win: "Cut p99 latency from 900 ms to 520 ms (PR #123)".

### Status and wins

Two fields on the task, outside the notes. The app shows the status under the task's title (also
when it's collapsed), and wins feed the review rollups.

**Status** is one line, usually one sentence, on where the task stands *right now*: "PR #4918 approved
and green, ready to merge." or "Not started; waiting on the design." It is replaced, not appended;
no markdown or line breaks. Set it on every task write: the same PATCH that changes state works, or
send it with the notes change:

```bash
curl -s -X PATCH "$API/agent/tasks/T42" -H 'Content-Type: application/json' -d '{"status": "Fix shipped; only the regression test is left."}'
```

`""` clears it. The previous status is kept in the activity log (`GET /agent/activity`).

**Wins** are a list on the task, for review season. A win is anything with impact: shipped work,
a problem solved, a number moved, people unblocked, recognition received. One line each: concrete
("Cut p99 latency from 900 ms to 520 ms (PR #123)", not "improved performance"), with the PR, doc
or thread as evidence, and estimates labelled as estimates. Each win has a date (default today;
pass `date` for an earlier one) and an optional `high_impact` flag.

```bash
curl -s -X POST "$API/agent/tasks/T42/wins" -H 'Content-Type: application/json' -d '{"text": "Cut p99 latency from 900 ms to 520 ms (PR #123)"}'
# fix wording, date or flag (the win ids are in GET /agent/tasks/T42):
curl -s -X PATCH "$API/agent/tasks/T42/wins/WIN_ID" -H 'Content-Type: application/json' -d '{"high_impact": true}'
```

Add a win when work you are recording lands one; read the task's existing wins first so you don't
add the same one twice. Don't invent wins; if the notes only hint at an outcome, ask. Suggest
`high_impact` for a win, or the task's ⚡, when something is significant — ask; don't set it
yourself. Wins can't be deleted through the API (the user does that in the app).

**Backfill** ("backfill wins for T32"): read the task's notes, propose the wins you found with their
dates, and add them once the user agrees.

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

- **Create it** with `"parent_id"` (it takes the parent's workstream), state `todo`, and short
  human notes in the task shape above: Context (the goal and what "done" looks like, why it was
  split out and how it serves the parent), What's Next (the first concrete steps), and a **Start
  prompt**. Its `status` field: "Not started; split out from T32 on Oct 30."
- **Write its agent context** (`POST /agent/tasks/T51/context`): this is the **handoff**, so a
  fresh agent in a new session can start from it. "Reads first" points at the parent's context
  (`T32`); copy a parent decision in only when it is stable and binds this task (mark it
  "(from T32)"); add where the work lives and who to talk to, gotchas and earlier findings.
- **Update the parent** in the same pass: the What's Next item becomes a one-line pointer
  (`- TODO: Step 3: single commit at Registration Accept (T51)`); detail that moved into the
  sub-task comes out of the parent, keeping anything still about the parent's own goal; add a
  Progress line ("Split out T51 for …"); update the parent's `status`.
- **Put the Start prompt in T51's notes** and show it to the user, since you can't start a session
  yourself.
- Sub-tasks go one level deep. If the parent is itself a sub-task, offer a sibling under its
  parent instead.

**Keep parent and sub-tasks linked.** A parent TODO that has a sub-task names its reference
(`(T44)`), never just "(sub-task)". The sub-task's day-by-day work lives in its own notes; the
parent's Progress doesn't repeat it (one line per sub-task event, as above). When a sub-task is completed, take its pointer out of the
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
completed and high-impact work and the `wins` it lists, and mention meeting load only if it is notable. Base everything on
what the log says; if something is missing, say so instead of filling it in.
