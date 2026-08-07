#!/usr/bin/env python3
"""Generate a sample worklog database with realistic-looking data for screenshots."""

import os
import sys
from pathlib import Path
from datetime import date, datetime, timedelta

# Point at the sample DB before importing anything
os.environ["WORKLOG_DB"] = "worklog-sample.db"

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import SQLModel, Session
from api.database import engine, DB_PATH
from api.models import (
    Workstream, Task, TaskState, Meeting,
    Label, TaskLabelLink, TaskLink, LinkType,
    MeetingTaskLink, DayStatus, Setting,
)


def main():
    if DB_PATH.exists():
        DB_PATH.unlink()
    SQLModel.metadata.create_all(engine)

    today = date.today()
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)

    with Session(engine) as s:
        # ── Labels ──
        labels = {}
        label_data = [
            ("bug", "#ef4444"),
            ("feature", "#3b82f6"),
            ("infra", "#8b5cf6"),
            ("docs", "#06b6d4"),
            ("tech-debt", "#f97316"),
            ("security", "#f43f5e"),
            ("performance", "#22c55e"),
        ]
        for name, color in label_data:
            l = Label(name=name, color=color)
            s.add(l)
            s.flush()
            labels[name] = l.id

        # ── Workstreams ──
        ws = {}
        ws_data = [
            ("API Redesign", "Migrating public API to v3 with OpenAPI spec"),
            ("Auth Platform", "SSO and OAuth2 infrastructure"),
            ("Mobile App", "React Native iOS/Android app"),
            ("Observability", "Metrics, logging, and tracing improvements"),
        ]
        for name, desc in ws_data:
            w = Workstream(name=name, description=desc)
            s.add(w)
            s.flush()
            ws[name] = w.id

        # ── Tasks ──

        # API Redesign tasks
        t1 = Task(
            action="Design pagination strategy for list endpoints",
            state=TaskState.COMPLETE,
            workstream_id=ws["API Redesign"],
            high_impact=True,
            start_date=two_days_ago,
            end_date=yesterday,
            notes="Decided on cursor-based pagination over offset.\n\n**Key decisions:**\n- Use opaque cursors (base64-encoded)\n- Default page size: 25, max: 100\n- Include `has_more` boolean in response",
        )
        s.add(t1)
        s.flush()
        s.add(TaskLabelLink(task_id=t1.id, label_id=labels["feature"]))
        s.add(TaskLink(task_id=t1.id, url="https://github.com/acme/api/pull/1247", label="Pagination RFC", link_type=LinkType.PR))

        t2 = Task(
            action="Implement rate limiting middleware",
            state=TaskState.IN_PROGRESS,
            workstream_id=ws["API Redesign"],
            start_date=yesterday,
            notes="Using token bucket algorithm.\n\n- Per-user: 1000 req/min\n- Per-org: 5000 req/min\n- Need to add Redis backend for distributed counting",
        )
        s.add(t2)
        s.flush()
        s.add(TaskLabelLink(task_id=t2.id, label_id=labels["feature"]))
        s.add(TaskLabelLink(task_id=t2.id, label_id=labels["performance"]))
        s.add(TaskLink(task_id=t2.id, url="https://github.com/acme/api/issues/1190", label="Rate limit design", link_type=LinkType.ISSUE))

        t3 = Task(
            action="Write OpenAPI spec for /users endpoints",
            state=TaskState.TODO,
            workstream_id=ws["API Redesign"],
            notes="Start with GET/POST/PATCH/DELETE for users.\nReuse shared error schema from `components/schemas/Error`.",
        )
        s.add(t3)
        s.flush()
        s.add(TaskLabelLink(task_id=t3.id, label_id=labels["docs"]))

        # Auth Platform tasks
        t4 = Task(
            action="Fix SAML assertion validation bug",
            state=TaskState.COMPLETE,
            workstream_id=ws["Auth Platform"],
            high_impact=True,
            start_date=two_days_ago,
            end_date=two_days_ago,
            notes="Clock skew tolerance was too strict (5s). Bumped to 60s.\nAffected ~3% of SSO logins for customers with NTP drift.",
        )
        s.add(t4)
        s.flush()
        s.add(TaskLabelLink(task_id=t4.id, label_id=labels["bug"]))
        s.add(TaskLabelLink(task_id=t4.id, label_id=labels["security"]))
        s.add(TaskLink(task_id=t4.id, url="https://github.com/acme/auth/pull/892", label="Fix SAML clock skew", link_type=LinkType.PR))

        t5 = Task(
            action="Add OAuth2 PKCE support",
            state=TaskState.IN_PROGRESS,
            workstream_id=ws["Auth Platform"],
            start_date=today,
            high_impact=True,
            notes="Implementing RFC 7636 for public clients.\n\n**Status:**\n- [x] Authorization endpoint changes\n- [x] Code verifier validation\n- [ ] Update SDK documentation\n- [ ] Migration guide for existing integrations",
        )
        s.add(t5)
        s.flush()
        s.add(TaskLabelLink(task_id=t5.id, label_id=labels["feature"]))
        s.add(TaskLabelLink(task_id=t5.id, label_id=labels["security"]))

        t6 = Task(
            action="Rotate signing keys for JWT tokens",
            state=TaskState.TODO,
            workstream_id=ws["Auth Platform"],
            notes="Quarterly key rotation. Need to update key discovery endpoint first.",
        )
        s.add(t6)
        s.flush()
        s.add(TaskLabelLink(task_id=t6.id, label_id=labels["security"]))
        s.add(TaskLabelLink(task_id=t6.id, label_id=labels["infra"]))

        # Mobile App tasks
        t7 = Task(
            action="Fix push notification delivery on Android 14",
            state=TaskState.COMPLETE,
            workstream_id=ws["Mobile App"],
            start_date=yesterday,
            end_date=today,
            notes="Android 14 changed foreground service requirements.\nAdded `FOREGROUND_SERVICE_DATA_SYNC` permission.",
        )
        s.add(t7)
        s.flush()
        s.add(TaskLabelLink(task_id=t7.id, label_id=labels["bug"]))
        s.add(TaskLink(task_id=t7.id, url="https://github.com/acme/mobile/pull/456", label="Fix Android 14 push", link_type=LinkType.PR))

        t8 = Task(
            action="Implement offline sync queue",
            state=TaskState.IN_PROGRESS,
            workstream_id=ws["Mobile App"],
            start_date=today,
            notes="Queue mutations in SQLite when offline, replay on reconnect.\n\nConflict resolution: last-write-wins with server timestamp.",
        )
        s.add(t8)
        s.flush()
        s.add(TaskLabelLink(task_id=t8.id, label_id=labels["feature"]))

        # Observability tasks
        t9 = Task(
            action="Set up distributed tracing with OpenTelemetry",
            state=TaskState.IN_PROGRESS,
            workstream_id=ws["Observability"],
            high_impact=True,
            start_date=two_days_ago,
            notes="Rolling out OTel SDK across services.\n\n**Progress:**\n- API gateway: ✅\n- Auth service: ✅\n- User service: 🔄 in progress\n- Billing service: ⏳ next",
        )
        s.add(t9)
        s.flush()
        s.add(TaskLabelLink(task_id=t9.id, label_id=labels["infra"]))
        s.add(TaskLink(task_id=t9.id, url="https://acme.grafana.net/d/abc123", label="Tracing dashboard", link_type=LinkType.DOC))

        t10 = Task(
            action="Add SLO alerting for p99 latency",
            state=TaskState.TODO,
            workstream_id=ws["Observability"],
            notes="Target: p99 < 200ms for all public endpoints.\nUse multi-window, multi-burn-rate alerts.",
        )
        s.add(t10)
        s.flush()
        s.add(TaskLabelLink(task_id=t10.id, label_id=labels["infra"]))
        s.add(TaskLabelLink(task_id=t10.id, label_id=labels["performance"]))

        t11 = Task(
            action="Migrate legacy StatsD metrics to Prometheus",
            state=TaskState.COMPLETE,
            workstream_id=ws["Observability"],
            start_date=two_days_ago,
            end_date=yesterday,
            notes="Converted 47 custom StatsD metrics to Prometheus counters/histograms.\nRemoved statsd-exporter sidecar from 12 services.",
        )
        s.add(t11)
        s.flush()
        s.add(TaskLabelLink(task_id=t11.id, label_id=labels["tech-debt"]))
        s.add(TaskLabelLink(task_id=t11.id, label_id=labels["infra"]))

        # ── Meetings ──

        # Today
        m1 = Meeting(date=today, title="Sprint Planning", duration_minutes=60,
                     notes="**Sprint 24 goals:**\n- Complete rate limiting middleware\n- Ship PKCE support to staging\n- Finalize tracing rollout for user service")
        s.add(m1)
        s.flush()

        m2 = Meeting(date=today, title="1:1 with Engineering Manager", duration_minutes=30,
                     notes="- Discussed promotion timeline\n- Feedback on API redesign leadership\n- Action: write up tech lead responsibilities doc")
        s.add(m2)
        s.flush()

        m3 = Meeting(date=today, title="Incident Review — API Outage", duration_minutes=45,
                     notes="Reviewed the 23-min outage from last Tuesday.\n\n**Root cause:** Connection pool exhaustion due to slow downstream.\n**Action items:**\n- Add circuit breaker (assigned to me)\n- Improve connection pool monitoring")
        s.add(m3)
        s.flush()

        # Yesterday
        m4 = Meeting(date=yesterday, title="Architecture Review", duration_minutes=60,
                     notes="Reviewed rate limiting design.\nDecision: go with Redis token bucket, add local cache fallback.")
        s.add(m4)
        s.flush()

        m5 = Meeting(date=yesterday, title="Team Standup", duration_minutes=15)
        s.add(m5)
        s.flush()

        # Two days ago
        m6 = Meeting(date=two_days_ago, title="Team Standup", duration_minutes=15)
        s.add(m6)
        s.flush()

        m7 = Meeting(date=two_days_ago, title="Security Review", duration_minutes=30,
                     notes="Reviewed SAML fix and JWT rotation plan. Security team approved both.")
        s.add(m7)
        s.flush()

        # ── Meeting-Task Links ──
        # Sprint Planning → rate limiting (t2), PKCE (t5), tracing (t9)
        s.add(MeetingTaskLink(meeting_id=m1.id, task_id=t2.id))
        s.add(MeetingTaskLink(meeting_id=m1.id, task_id=t5.id))
        s.add(MeetingTaskLink(meeting_id=m1.id, task_id=t9.id))
        # Incident Review → tracing (t9)
        s.add(MeetingTaskLink(meeting_id=m3.id, task_id=t9.id))
        # Architecture Review → rate limiting (t2)
        s.add(MeetingTaskLink(meeting_id=m4.id, task_id=t2.id))
        # Security Review → SAML fix (t4), JWT rotation (t6)
        s.add(MeetingTaskLink(meeting_id=m7.id, task_id=t4.id))
        s.add(MeetingTaskLink(meeting_id=m7.id, task_id=t6.id))

        # ── Day Statuses ──
        s.add(DayStatus(day=two_days_ago, status="⏰ Half day"))

        # ── Default status options ──
        import json
        s.add(Setting(key="day_status_options", value=json.dumps(
            ["🤒 Sick", "🏠 Kid at home", "🏖️ Vacation", "⏰ Half day", "📅 Out of office"]
        )))

        s.commit()

    print(f"✅ Sample database created at {DB_PATH}")
    print(f"   {DB_PATH.stat().st_size:,} bytes")
    print(f"   Run with: WORKLOG_DB=worklog-sample.db make api")


if __name__ == "__main__":
    main()
