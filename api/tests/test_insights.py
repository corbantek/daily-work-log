"""Review insights (Meetings / Links views). Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import io
import os
import shutil
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from fastapi import UploadFile
from sqlmodel import Session, SQLModel, create_engine

from api.models import (
    DayStatus, LinkType, Meeting, MeetingLink, MeetingTaskLink, Task, TaskLink, TaskState,
)
from api.routes.attachments import upload_attachment, upload_meeting_attachment
from api.calendar_source import CalendarEvent
from api.models import MeetingUpdate
from api.routes.calendar import apply_events
from api.routes.insights import build_meeting_insights, link_insights, notes_preview
from api.routes.meetings import update_meeting
from api.routes.self_review import self_review
from sqlmodel import select

MON = date(2026, 10, 19)  # a Monday
TUE, WED, THU, FRI, SAT, SUN = (date(2026, 10, d) for d in range(20, 26))


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["WORKLOG_FILES"] = str(self.tmp / "files")
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()
        os.environ.pop("WORKLOG_FILES", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add(self, *objs):
        for o in objs:
            self.s.add(o)
        self.s.commit()
        return objs[0] if len(objs) == 1 else objs

    def meeting(self, title, day, minutes=30, start=None, notes=None):
        return self.add(Meeting(title=title, date=day, duration_minutes=minutes, start_time=start, notes=notes))

    def task(self, action, start=None, end=None, created=None, state=TaskState.TODO):
        t = Task(action=action, start_date=start, end_date=end, state=state)
        if created:
            t.created_at = created
        return self.add(t)


class LinkInsightTests(Base):
    def test_merges_the_same_url_across_tasks_and_meetings(self):
        m = self.meeting("LPS sync", MON)
        t = self.task("Scaling doc", start=WED)
        self.add(MeetingLink(meeting_id=m.id, url="https://quip.com/AbC/", label="Old name", link_type=LinkType.QUIP))
        self.add(TaskLink(task_id=t.id, url="https://quip.com/AbC", label="Design Notes", link_type=LinkType.QUIP))
        [r] = link_insights(MON, SUN, self.s)
        self.assertEqual((r.kind, r.link_type, r.label), ("link", "quip", "Design Notes"))  # newest label wins
        self.assertEqual((r.first_date, r.last_date), (MON, WED))
        self.assertEqual([(x.type, x.title) for x in r.sources], [("meeting", "LPS sync"), ("task", "Scaling doc")])

    def test_task_date_rule_end_then_start_then_created(self):
        a = self.task("ended", start=date(2026, 9, 1), end=TUE)
        b = self.task("started", start=WED)
        c = self.task("undated", created=datetime(2026, 10, 23, 12, 0))  # a Friday
        d = self.task("too old", start=date(2026, 9, 1))
        for t, url in ((a, "https://a.test"), (b, "https://b.test"), (c, "https://c.test"), (d, "https://d.test")):
            self.add(TaskLink(task_id=t.id, url=url))
        got = {r.url: r.last_date for r in link_insights(MON, SUN, self.s)}
        self.assertEqual(got, {"https://a.test": TUE, "https://b.test": WED, "https://c.test": FRI})

    def test_only_sources_inside_the_range_are_listed(self):
        inside = self.meeting("Inside", TUE)
        outside = self.meeting("Outside", date(2026, 10, 1))
        for m in (inside, outside):
            self.add(MeetingLink(meeting_id=m.id, url="https://shared.test"))
        [r] = link_insights(MON, SUN, self.s)
        self.assertEqual([s.title for s in r.sources], ["Inside"])
        self.assertEqual(link_insights(date(2026, 11, 1), date(2026, 11, 30), self.s), [])

    def test_files_are_listed_individually_with_their_source(self):
        m = self.meeting("Quarterly review", TUE)
        t = self.task("Write how-to", start=THU)
        upload_meeting_attachment(m.id, UploadFile(file=io.BytesIO(b"x"), filename="deck.pdf"), self.s)
        upload_attachment(t.id, UploadFile(file=io.BytesIO(b"y"), filename="deck.pdf"), self.s)
        files = [r for r in link_insights(MON, SUN, self.s) if r.kind == "file"]
        self.assertEqual(len(files), 2)  # same filename, still two different files
        self.assertTrue(all(r.link_type == "file" and r.attachment.kind == "pdf" for r in files))
        self.assertEqual(sorted(r.sources[0].title for r in files), ["Quarterly review", "Write how-to"])

    def test_oldest_first_by_the_date_a_link_first_appeared(self):
        early = self.meeting("Early", MON)
        late = self.meeting("Late", FRI)
        self.add(MeetingLink(meeting_id=late.id, url="https://late.test"))
        self.add(MeetingLink(meeting_id=early.id, url="https://early.test"))
        # used on Tue and again on Sat: it sits where it first came up
        for day in (TUE, SAT):
            self.add(MeetingLink(meeting_id=self.meeting(f"m{day}", day).id, url="https://reused.test"))
        self.assertEqual([r.url for r in link_insights(MON, SUN, self.s)],
                         ["https://early.test", "https://reused.test", "https://late.test"])


class NotesPreviewTests(unittest.TestCase):
    def test_uses_a_summary_section_when_present(self):
        notes = "## Executive Summary\nShipped the fix.\nNext: rollout.\n\n## Notes\nlots of detail\n"
        self.assertEqual(notes_preview(notes), ("Shipped the fix.\nNext: rollout.", True))

    def test_summary_section_keeps_its_subheadings(self):
        notes = "# Summary\nTop line\n## Detail\nsub detail\n# Notes\nignored"
        preview, _ = notes_preview(notes)
        self.assertEqual(preview, "Top line\n## Detail\nsub detail")

    def test_falls_back_to_the_first_lines_for_other_formats(self):
        notes = "\n".join(f"line {i}" for i in range(1, 21))
        preview, has_more = notes_preview(notes)
        self.assertEqual(preview.splitlines(), [f"line {i}" for i in range(1, 13)])
        self.assertTrue(has_more)

    def test_short_notes_have_nothing_more(self):
        self.assertEqual(notes_preview("Just one line."), ("Just one line.", False))

    def test_empty_summary_section_falls_back(self):
        notes = "## Summary\n\n## Notes\nreal content"
        self.assertEqual(notes_preview(notes)[0], "## Summary\n\n## Notes\nreal content")


class MeetingStatsTests(Base):
    def test_hours_share_and_busiest_day_for_a_full_week(self):
        self.meeting("a", MON, 60)
        self.meeting("b", TUE, 90)
        self.meeting("c", TUE, 30)
        self.meeting("weekend", SAT, 60)  # counted in hours, but weekends add no capacity
        st = build_meeting_insights(self.s, MON, SUN, today=date(2026, 11, 1)).stats
        self.assertEqual((st.meeting_count, st.total_minutes), (4, 240))
        self.assertEqual(st.capacity_minutes, 5 * 8 * 60)
        self.assertAlmostEqual(st.work_share, 240 / 2400)
        self.assertEqual((st.busiest_day.date, st.busiest_day.minutes), (TUE, 120))
        self.assertEqual([(w.week_start, w.minutes) for w in st.weekly], [(MON, 240)])

    def test_stats_stop_at_today_but_digest_covers_the_range(self):
        self.meeting("done", MON, 60, notes="n1")
        self.meeting("future", THU, 60, notes="n2")
        r = build_meeting_insights(self.s, MON, SUN, today=TUE)
        self.assertEqual((r.stats.stats_through, r.stats.meeting_count, r.stats.total_minutes), (TUE, 1, 60))
        self.assertEqual(r.stats.capacity_minutes, 2 * 8 * 60)  # Mon + Tue only
        self.assertEqual([d.title for d in r.digest], ["done", "future"])

    def test_days_marked_off_are_left_out_of_capacity(self):
        self.add(DayStatus(day=MON, status="🏖️ Vacation"), DayStatus(day=TUE, status="🤒 Sick"),
                 DayStatus(day=WED, status="📅 Out of office"), DayStatus(day=THU, status="🏠 Kid at home"))
        st = build_meeting_insights(self.s, MON, SUN, today=date(2026, 11, 1)).stats
        self.assertEqual((st.capacity_minutes, st.days_off), (2 * 8 * 60, 3))  # Thu + Fri remain

    def test_no_capacity_means_no_share(self):
        self.add(*(DayStatus(day=d, status="Vacation") for d in (MON, TUE, WED, THU, FRI)))
        st = build_meeting_insights(self.s, MON, SUN, today=date(2026, 11, 1)).stats
        self.assertEqual(st.capacity_minutes, 0)
        self.assertIsNone(st.work_share)
        self.assertIsNone(st.busiest_day)

    def test_weekly_buckets_include_empty_weeks(self):
        self.meeting("w1", MON, 60)
        self.meeting("w3", date(2026, 11, 3), 30)
        st = build_meeting_insights(self.s, MON, date(2026, 11, 8), today=date(2026, 12, 1)).stats
        self.assertEqual([w.minutes for w in st.weekly], [60, 0, 30])


class ExcludeFromStatsTests(Base):
    def test_excluded_meetings_are_left_out_of_every_utilization_number(self):
        self.meeting("Standup", MON, 30, notes="n")
        self.meeting("Design review", TUE, 60)
        party = self.meeting("Team party", WED, 240, notes="fun")
        party.exclude_from_stats = True
        conf = self.meeting("Conference", THU, 480)
        conf.exclude_from_stats = True
        self.s.commit()
        st = build_meeting_insights(self.s, MON, SUN, today=SUN).stats
        self.assertEqual((st.meeting_count, st.total_minutes, st.with_notes), (2, 90, 1))
        self.assertAlmostEqual(st.work_share, 90 / (5 * 8 * 60))  # capacity is unaffected
        self.assertEqual((st.busiest_day.date, st.busiest_day.minutes), (TUE, 60))  # not the 8 h conference
        self.assertEqual([w.minutes for w in st.weekly], [90])
        self.assertEqual((st.excluded_count, st.excluded_minutes), (2, 720))

    def test_excluded_meetings_still_appear_in_digest_and_outcomes(self):
        party = self.meeting("Team party", WED, 240, notes="fun")
        party.exclude_from_stats = True
        self.s.commit()
        t = self.task("Book next venue")
        self.add(MeetingTaskLink(meeting_id=party.id, task_id=t.id))
        r = build_meeting_insights(self.s, MON, SUN, today=SUN)
        self.assertEqual([(d.title, d.exclude_from_stats) for d in r.digest], [("Team party", True)])
        self.assertEqual([o.action for o in r.outcomes], ["Book next venue"])

    def test_excluded_in_the_future_is_not_counted_as_excluded_yet(self):
        future = self.meeting("Offsite", FRI, 480)
        future.exclude_from_stats = True
        self.s.commit()
        st = build_meeting_insights(self.s, MON, SUN, today=TUE).stats
        self.assertEqual((st.excluded_count, st.excluded_minutes), (0, 0))  # stats stop at today

    def test_self_review_meeting_count_leaves_them_out(self):
        self.meeting("Standup", MON)
        party = self.meeting("Team party", WED)
        party.exclude_from_stats = True
        self.s.commit()
        self.assertEqual(self_review(MON, SUN, self.s).stats.meetings, 1)

    def test_flag_is_set_and_cleared_through_the_meeting_api(self):
        m = self.meeting("Team party", WED)
        self.assertFalse(update_meeting(m.id, MeetingUpdate(title="Team party"), self.s).exclude_from_stats)  # default
        self.assertTrue(update_meeting(m.id, MeetingUpdate(exclude_from_stats=True), self.s).exclude_from_stats)
        self.assertTrue(update_meeting(m.id, MeetingUpdate(notes="still excluded"), self.s).exclude_from_stats)
        self.assertFalse(update_meeting(m.id, MeetingUpdate(exclude_from_stats=False), self.s).exclude_from_stats)

    def test_calendar_sync_never_changes_the_flag(self):
        ev = CalendarEvent(external_id="p", title="Team party", start=datetime(2026, 10, 21, 17), duration_minutes=120,
                           all_day=False, declined=False, cancelled=False, calendar_id="c")
        apply_events(self.s, WED, [ev])
        m = self.s.exec(select(Meeting).where(Meeting.title == "Team party")).one()
        update_meeting(m.id, MeetingUpdate(exclude_from_stats=True), self.s)
        ev.duration_minutes = 180  # edited on the calendar
        apply_events(self.s, WED, [ev])
        self.s.refresh(m)
        self.assertEqual((m.duration_minutes, m.exclude_from_stats), (180, True))


class DigestAndOutcomeTests(Base):
    def test_digest_has_every_meeting_in_time_order(self):
        self.meeting("Afternoon", MON, start="14:00", notes="## Summary\nok")
        self.meeting("Morning", MON, start="09:00", notes="first")
        self.meeting("Empty", MON, start="10:00")
        with_task = self.meeting("Task only", MON, start="11:00")
        with_link = self.meeting("Link only", TUE, start="09:00")
        with_file = self.meeting("File only", TUE, start="10:00")
        self.add(MeetingTaskLink(meeting_id=with_task.id, task_id=self.task("t").id))
        self.add(MeetingLink(meeting_id=with_link.id, url="https://x.test"))
        upload_meeting_attachment(with_file.id, UploadFile(file=io.BytesIO(b"x"), filename="deck.pdf"), self.s)
        digest = build_meeting_insights(self.s, MON, SUN, today=SUN).digest
        self.assertEqual([d.title for d in digest], ["Morning", "Empty", "Task only", "Afternoon", "Link only", "File only"])
        self.assertEqual(digest[3].preview, "ok")
        empty = digest[1]
        self.assertEqual((empty.notes, empty.preview, empty.has_more, empty.tasks, empty.links, empty.attachments),
                         ("", "", False, [], [], []))
        self.assertEqual(len(digest[2].tasks), 1)  # no notes, but its task is listed

    def test_digest_lists_each_meetings_tasks_links_and_files(self):
        m = self.meeting("LPS sync", TUE, notes="notes")
        done = self.task("Update doc", state=TaskState.COMPLETE)
        doing = self.task("Share numbers", state=TaskState.IN_PROGRESS)
        for t in (done, doing):
            self.add(MeetingTaskLink(meeting_id=m.id, task_id=t.id))
        self.add(MeetingLink(meeting_id=m.id, url="https://quip.com/a", label="Agenda", link_type=LinkType.QUIP))
        self.add(MeetingLink(meeting_id=m.id, url="https://b.test"))
        upload_meeting_attachment(m.id, UploadFile(file=io.BytesIO(b"x"), filename="deck.pdf"), self.s)
        [d] = build_meeting_insights(self.s, MON, SUN, today=SUN).digest
        self.assertEqual([(t.action, t.state.value) for t in d.tasks], [("Share numbers", "in_progress"), ("Update doc", "complete")])
        self.assertEqual([(l.label, l.url) for l in d.links], [("Agenda", "https://quip.com/a"), (None, "https://b.test")])
        self.assertEqual([(a.filename, a.kind) for a in d.attachments], [("deck.pdf", "pdf")])

    def test_outcomes_list_each_task_once_with_all_its_meetings(self):
        mon = self.meeting("Standup", MON, start="09:00")
        tue = self.meeting("LPS sync", TUE, start="10:00")
        shared = self.task("Share numbers", state=TaskState.IN_PROGRESS)
        only_tue = self.task("Update doc", state=TaskState.COMPLETE)
        self.add(MeetingTaskLink(meeting_id=tue.id, task_id=shared.id),
                 MeetingTaskLink(meeting_id=mon.id, task_id=shared.id),
                 MeetingTaskLink(meeting_id=tue.id, task_id=only_tue.id))
        r = build_meeting_insights(self.s, MON, SUN, today=SUN)
        self.assertEqual([t.action for t in r.outcomes], ["Share numbers", "Update doc"])
        self.assertEqual([m.title for m in r.outcomes[0].meetings], ["Standup", "LPS sync"])  # in meeting order
        self.assertEqual((r.open_tasks, r.done_tasks), (1, 1))  # the shared task counts once

    def test_outcomes_are_open_first_then_done_then_abandoned(self):
        early = self.meeting("Early", MON)
        late = self.meeting("Late", WED)
        tasks = {
            "done early": self.task("done early", state=TaskState.COMPLETE),
            "dropped": self.task("dropped", state=TaskState.ABANDONED),
            "open late": self.task("open late", state=TaskState.TODO),
            "open early": self.task("open early", state=TaskState.IN_PROGRESS),
        }
        for name, t in tasks.items():
            self.add(MeetingTaskLink(meeting_id=(early if "early" in name or name == "dropped" else late).id, task_id=t.id))
        r = build_meeting_insights(self.s, MON, SUN, today=SUN)
        self.assertEqual([t.action for t in r.outcomes], ["open early", "open late", "done early", "dropped"])

    def test_meetings_without_tasks_add_no_outcomes(self):
        self.meeting("No tasks", WED)
        r = build_meeting_insights(self.s, MON, SUN, today=SUN)
        self.assertEqual((r.outcomes, r.open_tasks, r.done_tasks), ([], 0, 0))


if __name__ == "__main__":
    unittest.main()
