"""Agent API (/agent). Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date, timedelta

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from api.models import AgentActivity, Label, Meeting, MeetingTaskLink, Task, TaskState, Workstream
from api.routes import agent as A
from api.main import app

TODAY = date.today()


class Base(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)
        for name in ("LPS", "LSP Tools", "DevOps Improvements"):
            self.s.add(Workstream(name=name))
        self.s.add(Workstream(name="Old stuff", archived_at=__import__("datetime").datetime(2026, 1, 1)))
        for name in ("oncall", "blocked"):
            self.s.add(Label(name=name, color="#f00"))
        self.s.commit()

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def new_task(self, **kw):
        return A.agent_create_task(A.NewTask(**kw), self.s)

    def activity(self):
        return [a["action"] for a in A.agent_activity(50, self.s)]

    def assert400(self, fn, contains):
        with self.assertRaises(HTTPException) as cm:
            fn()
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIn(contains, str(cm.exception.detail))
        return cm.exception.detail


class ResolverTests(Base):
    def test_workstream_names(self):
        ws = {w.name: w.id for w in self.s.exec(select(Workstream)).all()}
        self.assertEqual(A.resolve_workstream(self.s, "lps"), ws["LPS"])               # exact, any case
        self.assertEqual(A.resolve_workstream(self.s, "devops"), ws["DevOps Improvements"])  # unique partial
        self.assertIsNone(A.resolve_workstream(self.s, "unassigned"))
        self.assertIsNone(A.resolve_workstream(self.s, ""))
        detail = self.assert400(lambda: A.resolve_workstream(self.s, "nope"), "Unknown workstream")
        self.assertEqual(detail["valid"], ["DevOps Improvements", "LPS", "LSP Tools"])  # archived ones not offered
        detail = self.assert400(lambda: A.resolve_workstream(self.s, "L"), "ambiguous")
        self.assertIn("LPS", detail["matches"])

    def test_state_aliases(self):
        self.assertEqual(A.parse_state("done"), TaskState.COMPLETE)
        self.assertEqual(A.parse_state("In Progress"), TaskState.IN_PROGRESS)
        self.assertEqual(A.parse_state("in_progress"), TaskState.IN_PROGRESS)
        self.assertEqual(A.parse_state("to-do"), TaskState.TODO)
        self.assert400(lambda: A.parse_state("finished-ish"), "Unknown state")

    def test_link_type_detection(self):
        cases = {"https://github.com/o/r/pull/4": "pr", "https://github.com/o/r/issues/9": "issue",
                 "https://acme.slack.com/archives/C1": "slack", "https://quip-apple.com/AbC": "quip",
                 "https://docs.example.com/x": "doc", "https://example.com": "other"}
        self.assertEqual({u: A.detect_link_type(u).value for u in cases}, cases)


class TaskWriteTests(Base):
    def test_create_uses_names_defaults_today_and_records_activity(self):
        t = self.new_task(action="Fix retries", workstream="lps", labels=["blocked"], high_impact=True)
        self.assertEqual((t["workstream"], t["labels"], t["state"], t["start_date"], t["high_impact"]),
                         ("LPS", ["blocked"], "todo", TODAY.isoformat(), True))
        self.assertEqual(self.activity(), ["create_task"])

    def test_create_with_unknown_workstream_creates_nothing(self):
        self.assert400(lambda: self.new_task(action="x", workstream="Nope"), "Unknown workstream")
        self.assertEqual(self.s.exec(select(Task)).all(), [])
        self.assertEqual(self.activity(), [])

    def test_subtask_inherits_parent_workstream(self):
        parent = self.new_task(action="Parent", workstream="LPS")
        child = self.new_task(action="Child", parent_id=parent["id"])
        self.assertEqual((child["workstream"], child["parent_id"]), ("LPS", parent["id"]))
        self.assertEqual([s["action"] for s in A.agent_task(parent["id"], self.s)["subtasks"]], ["Child"])

    def test_update_state_alias_and_activity_diff(self):
        t = self.new_task(action="Fix retries", workstream="LPS")
        out = A.agent_update_task(t["id"], A.TaskChanges(state="done", workstream="DevOps"), self.s)
        self.assertEqual((out["state"], out["workstream"]), ("complete", "DevOps Improvements"))
        summary = A.agent_activity(1, self.s)[0]["summary"]
        self.assertIn("'todo' → 'complete'", summary)
        self.assertIn("'LPS' → 'DevOps Improvements'", summary)

    def test_update_keeps_the_apps_rules(self):
        parent = self.new_task(action="Parent", workstream="LPS")
        self.new_task(action="Child", parent_id=parent["id"])
        self.assert400(lambda: A.agent_update_task(parent["id"], A.TaskChanges(state="complete"), self.s), "sub-tasks")
        self.assertEqual(A.agent_task(parent["id"], self.s)["state"], "todo")

    def test_update_needs_something_and_a_real_task(self):
        t = self.new_task(action="x")
        self.assert400(lambda: A.agent_update_task(t["id"], A.TaskChanges(), self.s), "Nothing to change")
        with self.assertRaises(HTTPException) as cm:
            A.agent_update_task("nope", A.TaskChanges(state="done"), self.s)
        self.assertEqual(cm.exception.status_code, 404)

    def test_notes_append_by_default_replace_on_request(self):
        t = self.new_task(action="x", notes="first")
        out = A.agent_task_notes(t["id"], A.NotesText(text="second"), self.s)
        self.assertEqual(out["notes"], "first\n\nsecond")
        out = A.agent_task_notes(t["id"], A.NotesText(text="only", mode="replace"), self.s)
        self.assertEqual(out["notes"], "only")
        with self.assertRaises(ValueError):
            A.NotesText(text="x", mode="overwrite")
        self.assertEqual(self.activity()[:2], ["replace_task_notes", "append_task_notes"])
        self.assertEqual([a["summary"].split(" notes")[0] for a in A.agent_activity(2, self.s)], ["replaced", "appended"])

    def test_add_link_guesses_type(self):
        t = self.new_task(action="x")
        out = A.agent_task_link(t["id"], A.NewLink(url="https://github.com/o/r/pull/4", label="PR 4"), self.s)
        self.assertEqual(out["links"], [{"url": "https://github.com/o/r/pull/4", "label": "PR 4", "type": "pr"}])
        self.assert400(lambda: A.agent_task_link(t["id"], A.NewLink(url="https://x.test", type="video"), self.s), "Unknown link type")


class SubTaskTests(Base):
    def test_create_edit_and_clear_a_parent(self):
        parent = A.agent_create_task(A.NewTask(action="Parent", workstream="LPS"), self.s)
        child = A.agent_create_task(A.NewTask(action="Child", parent_id=parent["ref"]), self.s)
        self.assertEqual((child["parent_id"], child["workstream"]), (parent["id"], "LPS"))
        loose = A.agent_create_task(A.NewTask(action="Loose", workstream="DevOps Improvements"), self.s)
        moved = A.agent_update_task(loose["ref"], A.TaskChanges(parent_id=parent["ref"]), self.s)
        self.assertEqual((moved["parent_id"], moved["workstream"]), (parent["id"], "LPS"))  # follows its parent
        free = A.agent_update_task(loose["ref"], A.TaskChanges(parent_id=""), self.s)
        self.assertNotIn("parent_id", free)
        self.assertEqual(free["workstream"], "LPS")

    def test_task_from_a_meeting_can_be_a_sub_task(self):
        parent = A.agent_create_task(A.NewTask(action="Parent", workstream="LPS"), self.s)
        m = A.agent_create_meeting(A.NewMeeting(title="Sync"), self.s)
        A.agent_meeting_task(m["ref"], A.MeetingTask(action="Follow-up", parent_id=parent["ref"]), self.s)
        sub = self.s.exec(select(Task).where(Task.action == "Follow-up")).one()
        self.assertEqual(sub.parent_task_id, parent["id"])

    def test_refusals_say_what_to_do_instead(self):
        parent = A.agent_create_task(A.NewTask(action="Parent", workstream="LPS"), self.s)
        child = A.agent_create_task(A.NewTask(action="Child", parent_id=parent["ref"]), self.s)
        with self.assertRaises(HTTPException) as cm:  # a sub-task can't be a parent
            A.agent_create_task(A.NewTask(action="Grandchild", parent_id=child["ref"]), self.s)
        self.assertIn(parent["ref"], cm.exception.detail["error"])
        with self.assertRaises(HTTPException) as cm:  # a workstream other than the parent's
            A.agent_create_task(A.NewTask(action="x", workstream="DevOps Improvements", parent_id=parent["ref"]), self.s)
        self.assertIn("LPS", cm.exception.detail["error"])
        with self.assertRaises(HTTPException) as cm:  # it already has sub-tasks
            A.agent_update_task(parent["ref"], A.TaskChanges(parent_id=child["ref"]), self.s)
        with self.assertRaises(HTTPException) as cm:
            A.agent_update_task(parent["ref"], A.TaskChanges(parent_id=parent["ref"]), self.s)
        self.assertIn("own parent", cm.exception.detail["error"])


class MeetingWriteTests(Base):
    def test_create_defaults_to_today_and_update_exclude(self):
        m = A.agent_create_meeting(A.NewMeeting(title="Team party", start_time="17:00", duration_minutes=120), self.s)
        self.assertEqual((m["date"], m["start_time"], m["excluded_from_stats"]), (TODAY.isoformat(), "17:00", False))
        m = A.agent_update_meeting(m["id"], A.MeetingChanges(exclude_from_stats=True), self.s)
        self.assertTrue(m["excluded_from_stats"])
        with self.assertRaises(ValueError):
            A.NewMeeting(title="x", start_time="5pm")

    def test_passive_on_create_and_update(self):
        m = A.agent_create_meeting(A.NewMeeting(title="All hands"), self.s)
        self.assertFalse(m["passive"])
        self.assertTrue(A.agent_update_meeting(m["ref"], A.MeetingChanges(passive=True), self.s)["passive"])
        self.assertTrue(A.agent_create_meeting(A.NewMeeting(title="Town hall", passive=True), self.s)["passive"])

    def test_add_link_to_a_meeting_by_reference(self):
        A.agent_create_meeting(A.NewMeeting(title="Design review"), self.s)
        out = A.agent_meeting_link("M1", A.NewLink(url="https://quip-apple.com/AbC", label="Agenda"), self.s)
        self.assertEqual(out["links"], [{"url": "https://quip-apple.com/AbC", "label": "Agenda", "type": "quip"}])
        out = A.agent_meeting_link("M1", A.NewLink(url="https://example.com/rec", label="Recording", type="other"), self.s)
        self.assertEqual([l["label"] for l in out["links"]], ["Agenda", "Recording"])
        self.assertEqual(A.agent_activity(1, self.s)[0]["summary"], 'added other link to M1 "Design review": https://example.com/rec')
        self.assert400(lambda: A.agent_meeting_link("M1", A.NewLink(url="  "), self.s), "url is required")
        with self.assertRaises(HTTPException) as cm:
            A.agent_meeting_link("M9", A.NewLink(url="https://x.test"), self.s)
        self.assertEqual(cm.exception.status_code, 404)

    def test_meeting_notes_append(self):
        m = A.agent_create_meeting(A.NewMeeting(title="Sync", notes="## Summary\nok"), self.s)
        out = A.agent_meeting_notes(m["id"], A.NotesText(text="## Action items\n- ship it"), self.s)
        self.assertEqual(out["notes"], "## Summary\nok\n\n## Action items\n- ship it")

    def test_create_or_link_a_task_from_a_meeting(self):
        m = A.agent_create_meeting(A.NewMeeting(title="Sync", date=TODAY - timedelta(days=2)), self.s)
        out = A.agent_meeting_task(m["id"], A.MeetingTask(action="Share numbers", workstream="LPS"), self.s)
        [created] = out["tasks"]
        self.assertEqual(A.agent_task(created["id"], self.s)["start_date"], (TODAY - timedelta(days=2)).isoformat())
        other = self.new_task(action="Existing")
        A.agent_meeting_task(m["id"], A.MeetingTask(task_id=other["id"]), self.s)
        A.agent_meeting_task(m["id"], A.MeetingTask(task_id=other["id"]), self.s)  # linking twice is harmless
        self.assertEqual(len(self.s.exec(select(MeetingTaskLink).where(MeetingTaskLink.meeting_id == m["id"])).all()), 2)
        self.assert400(lambda: A.agent_meeting_task(m["id"], A.MeetingTask(), self.s), "either task_id")
        self.assert400(lambda: A.agent_meeting_task(m["id"], A.MeetingTask(task_id=other["id"], action="x"), self.s), "either task_id")


class ReadTests(Base):
    def test_day_view_is_compact_and_uses_names(self):
        self.new_task(action="Fix retries", workstream="LPS", notes="x" * 1000)
        A.agent_create_meeting(A.NewMeeting(title="Standup", start_time="09:00"), self.s)
        d = A.agent_day(TODAY, self.s)
        self.assertEqual([m["title"] for m in d["meetings"]], ["Standup"])
        [group] = d["workstreams"]
        self.assertEqual(group["workstream"], "LPS")
        self.assertLessEqual(len(group["tasks"][0]["notes_preview"]), A.PREVIEW_CHARS + 1)  # previews, not full notes

    def test_tasks_filters_and_open(self):
        a = self.new_task(action="Fix retries", workstream="LPS")
        self.new_task(action="Write docs", workstream="DevOps")
        A.agent_update_task(a["id"], A.TaskChanges(state="done"), self.s)
        self.assertEqual([t["action"] for t in A.agent_tasks(state="done", session=self.s)["tasks"]], ["Fix retries"])
        self.assertEqual([t["action"] for t in A.agent_tasks(state="todo,in progress", session=self.s)["tasks"]], ["Write docs"])
        self.assertEqual(A.agent_tasks(workstream="lps", session=self.s)["count"], 1)
        self.assertEqual(A.agent_tasks(q="DOCS", session=self.s)["count"], 1)
        self.assertEqual(A.agent_tasks(date_from=TODAY + timedelta(days=1), session=self.s)["count"], 0)
        opened = A.agent_open(self.s)
        self.assertEqual((opened["count"], opened["workstreams"][0]["workstream"]), (1, "DevOps Improvements"))

    def test_meetings_by_day_range_and_text(self):
        A.agent_create_meeting(A.NewMeeting(title="Standup"), self.s)
        A.agent_create_meeting(A.NewMeeting(title="LPS sync", date=TODAY - timedelta(days=3), notes="scaling"), self.s)
        self.assertEqual(A.agent_meetings(session=self.s)["count"], 1)  # default: today
        self.assertEqual(A.agent_meetings(date_from=TODAY - timedelta(days=7), date_to=TODAY, session=self.s)["count"], 2)
        self.assertEqual(A.agent_meetings(date_from=TODAY - timedelta(days=7), date_to=TODAY, q="SCALING", session=self.s)["count"], 1)

    def test_summary_defaults_to_this_week(self):
        t = self.new_task(action="Fix retries", workstream="LPS", high_impact=True)
        A.agent_update_task(t["id"], A.TaskChanges(state="done"), self.s)
        A.agent_create_meeting(A.NewMeeting(title="Standup", duration_minutes=30), self.s)
        s = A.agent_summary(session=self.s)
        self.assertEqual(s["date_from"], (TODAY - timedelta(days=TODAY.weekday())).isoformat())
        self.assertEqual((s["tasks"]["completed"], s["tasks"]["high_impact"]), (1, 1))
        self.assertEqual((s["meetings"]["count"], s["meetings"]["hours"]), (1, 0.5))

    def test_search_and_help(self):
        self.new_task(action="Fix retries")
        self.assertEqual([r["title"] for r in A.agent_search("retries", self.s)], ["Fix retries"])
        h = A.agent_help()
        self.assertTrue(any("append" in n for n in h["notes"]))
        self.assertIn("POST /agent/tasks", h["write"])


class SafetyTests(unittest.TestCase):
    def test_no_delete_endpoints(self):
        agent_methods = {m for r in app.routes if r.path.startswith("/agent") for m in getattr(r, "methods", set())}
        self.assertNotIn("DELETE", agent_methods)
        self.assertEqual(agent_methods - {"GET", "POST", "PATCH"}, set())

    def test_help_lists_every_route(self):
        listed = {k.split("?")[0].split(" |")[0] for section in ("read", "write") for k in A.agent_help()[section]}
        actual = {f"{m} {r.path}".replace("{task_id}", "{id}").replace("{meeting_id}", "{id}")
                  for r in app.routes if r.path.startswith("/agent") and r.path != "/agent/help"
                  for m in r.methods}
        self.assertEqual(actual - listed, set())


if __name__ == "__main__":
    unittest.main()
