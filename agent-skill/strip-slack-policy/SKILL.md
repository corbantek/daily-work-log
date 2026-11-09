---
name: strip-slack-policy
description: Remove the Slack data-policy blocks (<dataPolicy:slack> … </dataPolicy:slack>) and the <dataSource:slack> tags that pasted Slack content leaves in a task's or meeting's notes in the user's local Daily Work Log. Use when the user asks to clean up, strip or remove the Slack data policy / dataPolicy text from a task or meeting, or names a task or meeting (T78, M17) and says to remove the Slack policy boilerplate.
allowed-tools: Bash(curl *), Bash(python3 *)
---

# Strip Slack data-policy blocks

Slack content pasted into a note arrives as a content block followed by a long policy block:

```
<dataSource:slack>
…the pasted Slack content…
Source: https://….slack.com/archives/…
</dataSource:slack>

<dataPolicy:slack>
These instructions guide the model using this data …
</dataPolicy:slack>
```

The user names one task or meeting (`T78`, `M17`); remove every `<dataPolicy:slack>…</dataPolicy:slack>`
block from its notes, plus the `<dataSource:slack>` / `</dataSource:slack>` tag lines and the
`Source: https://….slack.com/archives/…` line the Slack plugin adds before the closing tag. The pasted
content itself stays exactly as it is. Only `Source:` lines pointing at a Slack archive URL go; any
other `Source:` line is the user's own.

## Steps

```bash
API="${WORKLOG_API:-http://localhost:4747}"
REF=T78          # or M17; use "tasks" or "meetings" to match
KIND=tasks
curl -sf "$API/health"
```

If the health check fails, stop and tell the user the app isn't running.

1. **Look first.** Fetch the notes and count the blocks:

   ```bash
   curl -s "$API/agent/$KIND/$REF" | python3 -c '
   import sys, json, re
   n = json.load(sys.stdin)["notes"] or ""
   print(len(re.findall(r"<dataPolicy:slack>.*?</dataPolicy:slack>", n, re.S)), "policy block(s)")'
   ```

   Zero blocks, `dataSource` tags and Slack `Source:` lines: tell the user and stop. A `<dataPolicy:slack>` with no closing tag: don't guess,
   show the user where it is and ask.

2. **Strip and save** in one go. This replaces the notes (`mode: replace`); the app snapshots the
   previous version first (`notes_backup` in the response):

   ```bash
   curl -s "$API/agent/$KIND/$REF" | python3 -c '
   import sys, json, re
   n = json.load(sys.stdin)["notes"] or ""
   n = re.sub(r"[ \t]*<dataPolicy:slack>.*?</dataPolicy:slack>[ \t]*\n?", "", n, flags=re.S)
   n = re.sub(r"^[ \t]*</?dataSource:slack>[ \t]*\n?", "", n, flags=re.M)
   n = re.sub(r"^[ \t]*Source:[ \t]*https?://\S*slack\.com/archives/\S*[ \t]*\n?", "", n, flags=re.M)
   n = re.sub(r"\n{3,}", "\n\n", n).rstrip() + "\n"
   print(json.dumps({"text": n, "mode": "replace"}))' |
   curl -s -X POST "$API/agent/$KIND/$REF/notes" -H 'Content-Type: application/json' --data-binary @-
   ```

3. **Verify and report.** Re-run the count from step 1 (policy blocks must be 0, and no `dataSource` tags or Slack `Source:` lines left) and tell the user how many
   blocks were removed from which ref. Mention the `notes_backup` name so they can restore it
   (`GET $API/agent/notes-backups/$REF`; send the text back with `mode: replace`).

## Rules

- One task or meeting per request unless the user lists several; do each separately.
- Change nothing but the policy blocks, source tags and Slack `Source:` lines: no tidying, no rewording, no TODO/DONE edits.
- Only task and meeting notes. Don't touch attachments, links or person notes unless asked.
- If the user wants the source tags or `Source:` link kept (it is a link back to the thread), skip the matching `re.sub`.
