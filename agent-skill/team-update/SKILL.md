---
name: team-update
description: Draft a Slack post for the user's team summarizing their week or month from their local Daily Work Log — wins, completed work, what's still in progress and what's up next. Use when the user asks for a weekly / monthly update, a team update, a Slack post or a "what I did this week" post for their team or manager. Not for standups or private summaries (that's the daily-work-log skill).
allowed-tools: Bash(curl *)
---

# Team update (Slack post)

Turn the user's Daily Work Log into a short Slack post for their team: **wins, what got done,
what's in progress, and what's next.** Read-only: this skill never changes the log and never
posts to Slack. You write the draft, the user posts it.

## Preferences

The user adjusts these over time. When they ask for more or less detail, a different tone, or
to always leave something out, **offer to update this section** so the next post comes out
right the first time.

- **Detail level:** `standard` (see "Detail levels"). The user can ask for `brief` or `detailed`
  for one post.
- **Title:** `*Kyle's week of Nov 2*` (the Monday), or `*Kyle's November*` for a month.
- **Opening:** a short paragraph under the title (2–4 sentences): the week's theme, the top
  results in plain words, and what's next. Relaxed and conversational ("Pretty LPS-heavy
  week."), but no exclamation marks or "Happy Friday!". A number or two is fine; no links.
- **Leave out:** onboarding and admin chores (access requests, scheduling 1:1s, setup),
  prep for my own meetings (decks, one-pagers), things that are still only an idea or TBD,
  abandoned tasks, optional/backlog tasks nobody has started, and anything personal found in
  the log (the personal section only uses what the user tells you; see "Ask first").
- **Wins:** lead with them; high-impact (⚡) wins first. Keep the numbers ("23 → 18 requests"),
  because numbers are what the team remembers.
- **Many PRs on one item:** when a bullet would link more than 3 PRs, ask (see "Ask first")
  whether to link them all or only the main one plus "+N more" (`[#4878](url) +5 more`). The
  main one is the PR the result is best known by, e.g. the dashboard PR for a dashboard.
- **Link what the log has:** every PR the post mentions is written `[#4919](url)`, and an item
  while Slack links are on, an item with a Slack thread where the work is discussed gets
  `[thread](url)` (see "Links"). Drop the
  log's own `T42` / `M17` references, which mean nothing to anyone else.
- **Say what's actually on.** Merged isn't the same as live: work behind a setting or flag
  that's merged but not turned on is "merged, off for now", never "landed" or "halved X".
  Check the status line and notes for "off by default", "setting", "flag", "not deployed".
- **People:** credit teammates by first name when they shared the work ("with Adam"). Never
  write about anyone in a way that reads as blame.
- **Never "waiting on".** The post wraps up my work; it doesn't point at anyone else's. Say
  where my part stands and what comes next ("findings posted; a radar for … is next"), not
  "waiting on Adam / the team / the thread", and don't make Next items conditional on others
  ("once the thread settles"). "In review" for my own PR is fine.
- **No quoted praise.** Don't name who praised the work or quote them ("Ajay called it very
  useful"); say what landed: "well received", "the team is using it".
- **Modest about my role.** Say what I did plainly ("working with Adam on", "reviewing"), never
  "advising", "leading", "driving" or "owning". For someone else's work I'm not actively on,
  just "I'm here to help".
- **Next is self-explanatory.** Each Next bullet says what and why in a few words, so a teammate
  who hasn't read my notes follows it ("file a radar for the late-delivered Registration
  Requests", not "file the late-delivery radar"). A series of similar tasks (PR 3 of 7) is one
  bullet that names the next one and shows more follow ("lpsamfworker next, then RAN, AF/NEF, …").
- **Slack links: off.** Don't link Slack threads or channels for now (the user will revisit
  this; the Slack rules under "Links" apply once it's back on). PR links stay on.
- **Slack channels the team can see** (only threads in these get linked; see "Links"):
  - (none confirmed yet)
- **Names the team uses** (use these instead of the log's task titles):
  - Deferred commit / the DynamoDB-request work = *hybrid persistence* (DynamoDB + in-memory)
- **Tone:** plain, first person ("I"), past tense for done work, no hype words ("huge",
  "amazing"), no filler intro.

## Detail levels

| | brief | standard | detailed |
|---|---|---|---|
| Wins | top 3 | top 5 (week) / 6–8 (month) | all, with one line of context |
| Done | count per area, no list | one line per piece of work, related tasks merged | one line each, with PRs |
| In progress | one line per area | one line per piece of work, with its status | plus what's left on my side |
| Next | 2–3 bullets | 3–5 bullets | 5–8 bullets |
| Length | ~5 lines | ~15–25 lines | as needed |

A **month** at any level is grouped by theme or project, not listed task by task: tell the
story of each project (where it started, what landed, where it is now) in one or two bullets.

## Period

- "This week" = Monday through today. On a Monday (or if the user says "last week"), use
  last Monday through Friday. "This month" = the 1st through today; "last month" = the whole
  calendar month. Work these out from today's date yourself.
- Longer than a month: say it's too much for one post and offer a month or a quarter by theme.
- State the dates you used in your reply (not in the post, unless the user wants them).

## Gather

```bash
API="${WORKLOG_API:-http://localhost:4747}"
curl -sf "$API/health" || echo "app not running"
FROM=2026-11-02; TO=2026-11-06    # the period

curl -s "$API/agent/summary?date_from=$FROM&date_to=$TO"                          # wins (by date), task counts, meeting outcomes
curl -s "$API/agent/tasks?state=complete&date_from=$FROM&date_to=$TO&limit=200"   # done in the period, with status lines
curl -s "$API/agent/open"                                                         # everything open, with status lines
```

If the health check fails, tell the user the app isn't running and stop.

- **Wins** come from `summary.wins` (dated within the period). They are the best material:
  already outcome-phrased and usually measured.
- **Done** = the complete tasks above. Their `status` line says what landed; prefer it to the
  task title.
- **In progress** = `/agent/open` tasks in state `in_progress`, **whatever their start date**:
  long-running work started before the period still belongs in the post. `summary.tasks`
  only covers tasks dated inside the period, so don't use it for this.
- **Next** comes from the `status` lines of in-progress tasks ("next: …") and
  from `todo` tasks those statuses name as next. A `todo` task that merely exists isn't "next".
- Sub-tasks have `parent_id`. Report a parent and its sub-tasks as **one piece of work**
  ("Log cleanup: secrets removed, lpsue done (#4928); 5 more areas to go"), not one line each.
- **Links:** for every task the post mentions, read it (`GET /agent/tasks/T42`) and take its
  `links`: type `pr` for PRs, type `slack` for the discussion thread. A PR cited in a win or
  status may sit on the parent or a sub-task instead, so look there too; match by the number in
  the URL (`/pull/4919`). A PR with no URL anywhere in the log stays a plain `#4919`; mention it
  in your reply. Link Slack threads about the work itself, not DMs, review requests or posts
  praising the user.
- **Only link Slack the team can open.** A thread is linked only if its channel id (the
  `C…` / `G…` / `D…` part after `/archives/`) is in "Slack channels the team can see". Never
  link `G…` (private group) or `D…` (DM) channels. For any other channel, ask the user in
  "Ask first" whether the team can see it (name the item it's for); add the ones they confirm to
  Preferences and don't ask about those again. Unconfirmed → no link. Ask by channel **name**
  and the item it's for, never by bare id: the user doesn't recognize ids.
- **Slack URLs:** rewrite every Slack link to the enterprise domain before using it:
  `https://<anything>.slack.com/archives/<channel>/p<ts>…` →
  `https://apple.enterprise.slack.com/archives/<channel>/p<ts>` (keep the channel and `p…` id,
  drop the query string). Links saved in the log often carry a workspace id like
  `a1391194.slack.com` that doesn't open for the team.
- Read a full task only when the status line is missing or unclear for
  something important; the "What's Next" section of its notes helps for the Next section.
  Don't read every task.

## Ask first

After gathering, and before writing, ask the user in **one** short message:

1. **Personal section (optional):** "Anything exciting from your week, or plans for the
   weekend, to add at the bottom?" (for a month: "from your month, or coming up"). If they
   answer, add a `🎉 *Personal*` section at the end: a short casual paragraph (prose, not
   bullets; three to five sentences). Make it fun to read: tell it as a small story in order,
   with a light touch of dry humor ("possibly a bit more than one vehicle's worth"), not a
   list of facts in sentence form. Keep their facts and don't add any; the humor comes from
   how you say it, never from details they didn't give, and don't make anything sound bigger
   than they said. Offer one or two alternatives if they want to pick. If they say no or skip it, leave the section out. Never fill
   it from the log.
2. **Slack channels** not yet in Preferences, only while Slack links are on: can the team
   see them? (see "Links")
3. **Long PR lists**, only if some bullet would link more than 3 PRs: all of them, or the main
   one plus "+N more"?

If the user already said in their request (or in Preferences), don't ask again.

## Write

Slack formatting: `*bold*` with single asterisks, `_italic_`, `-` bullets, `[label](url)` links,
Unicode emoji for the section markers, no `#` headings, no tables. Keep each bullet to one line
where possible.

**Never put a link inside parentheses.** Slack reads `([#4919](url))` with the first `)` as part
of the URL and drops the closing one. Put a bullet's PR links at the end after ` · `
(`… stays stuck · [#4918](url)`), or mid-sentence without brackets ("Land [#4982](url), then …").

```
*Kyle's week of Nov 2*

Pretty LPS-heavy week. … Next up is the handoff drain, which has to land before …

🏆 *Wins*
- ⚡ Hybrid persistence: deferred-commit framework merged, 16 → 8 DynamoDB requests per registration once the setting is on (off everywhere for now) · [#4919](https://…/pull/4919), [#4943](https://…/pull/4943)
- …

✅ *Done*
- …

🚧 *In progress*
- *Handoff drain:* coordinator PR out for review; LPS side next · [#4982](https://…/pull/4982)
- *Chaos registration loss:* … findings posted

▶️ *Next week*
- …

🎉 *Personal*
A few casual sentences, no bullets (only if the user gave you something).
```

- The opening paragraph is written last, from the bullets, so it never says more than they do.
- **Don't repeat yourself.** A done task whose win is already under Wins doesn't get its own
  Done line; fold any extra detail into the win. Several tasks that are steps of one project
  merge into one line.
- Explain team-internal shorthand only if a teammate wouldn't know it; they know the project
  names (see "Names the team uses"), so don't define those.
- Base everything on the log. If a section would be empty, or something obviously important
  seems missing (no wins logged all week), say so in your reply rather than filling it in.
- Use "Next month" instead of "Next week" for a monthly post.

## Hand over

1. Put the post in one fenced code block so it copies cleanly, with nothing else inside it.
2. Under it, in a few short lines: the period used, what you left out and why (e.g. "skipped 3
   onboarding tasks and 2 abandoned ones"), and anything you weren't sure about.
3. Ask whether it should be shorter or longer, and offer to save any feedback in Preferences.

If the user asks, copy it to the clipboard with `pbcopy` (heredoc, quoted `'EOF'`). Never post
it anywhere yourself.

## Ideas for later (not active)

Noted 2026-11-06; don't do these until the user turns them on.

- **Team and teammates' wins.** As the user works more with the team in their new role, the post
  may also celebrate team wins as a whole and credit individuals for their work, giving praise
  outward. This is the opposite of the "No quoted praise" rule, which is about praise *for the
  user*. A likely source: the People tab's interactions (`GET /agent/people/{person}/interactions`
  with `sentiment=strength`, high-impact ones first) dated in the period. Open questions: a
  separate section ("🙌 *Team*") or mixed into Wins, and whether to ask before naming someone.
