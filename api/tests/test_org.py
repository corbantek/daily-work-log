"""Org tree: reporting lines, inherited team/focus, loop checks, P references.
Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

import api.database as database
from api.models import Person, PersonCreate, PersonUpdate
from api.refs import parse_ref, person_ref
from api.routes import people as P
from api.routes.search import search


class Base(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def add(self, name, **kw):
        return P.create_person(PersonCreate(name=name, **kw), self.s)

    def org(self):
        """VP (team Maps, focus Maps platform) → Dir (team Maps Data) → Lead → IC."""
        self.vp = self.add("Vera", team="Maps", focus="Maps platform")
        self.dir = self.add("Dana", team="Maps Data", manager_id=self.vp.id)
        self.lead = self.add("Lee", manager_id=self.dir.id)
        self.ic = self.add("Ivy", role="iOS engineer", manager_id=self.lead.id)


class InheritanceTests(Base):
    def test_blank_fields_come_from_the_nearest_manager_that_has_them(self):
        self.org()
        ic = P.get_person(self.ic.id, self.s)
        self.assertEqual((ic.effective_team.value, ic.effective_team.from_name), ("Maps Data", "Dana"))
        self.assertEqual((ic.effective_focus.value, ic.effective_focus.from_name), ("Maps platform", "Vera"))
        self.assertEqual([m.name for m in ic.chain], ["Lee", "Dana", "Vera"])
        self.assertEqual(ic.role, "iOS engineer")  # role is personal

    def test_own_value_overrides_and_clearing_it_inherits_again(self):
        self.org()
        P.update_person(self.lead.id, PersonUpdate(focus="Offline tiles"), self.s)
        ic = P.get_person(self.ic.id, self.s)
        self.assertEqual((ic.effective_focus.value, ic.effective_focus.from_name), ("Offline tiles", "Lee"))
        lead = P.get_person(self.lead.id, self.s)
        self.assertEqual((lead.effective_focus.value, lead.effective_focus.from_person_id), ("Offline tiles", None))
        P.update_person(self.lead.id, PersonUpdate(focus="  "), self.s)  # blank = inherit
        self.assertEqual(P.get_person(self.ic.id, self.s).effective_focus.from_name, "Vera")

    def test_filling_in_a_manager_fills_in_everyone_below(self):
        self.org()
        P.update_person(self.vp.id, PersonUpdate(focus="Maps everything"), self.s)
        self.assertEqual(P.get_person(self.ic.id, self.s).effective_focus.value, "Maps everything")

    def test_reports_listed_on_the_manager(self):
        self.org()
        self.add("Abe", manager_id=self.lead.id)
        self.assertEqual([r.name for r in P.get_person(self.lead.id, self.s).reports], ["Abe", "Ivy"])


class ManagerRuleTests(Base):
    def assert400(self, fn):
        with self.assertRaises(HTTPException) as cm:
            fn()
        self.assertEqual(cm.exception.status_code, 400)

    def test_no_loops_and_no_unknown_managers(self):
        self.org()
        self.assert400(lambda: P.update_person(self.vp.id, PersonUpdate(manager_id=self.vp.id), self.s))
        self.assert400(lambda: P.update_person(self.vp.id, PersonUpdate(manager_id=self.ic.id), self.s))
        self.assert400(lambda: P.update_person(self.lead.id, PersonUpdate(manager_id="nope"), self.s))
        self.assert400(lambda: self.add("X", manager_id="nope"))
        P.update_person(self.ic.id, PersonUpdate(manager_id=self.vp.id), self.s)  # moving up is fine
        P.update_person(self.ic.id, PersonUpdate(manager_id=None), self.s)  # and so is unplacing
        self.assertIsNone(P.get_person(self.ic.id, self.s).manager_id)

    def test_deleting_a_manager_moves_their_reports_up(self):
        self.org()
        P.delete_person(self.lead.id, self.s)
        self.assertEqual(P.get_person(self.ic.id, self.s).manager_id, self.dir.id)
        P.delete_person(self.vp.id, self.s)
        self.assertIsNone(P.get_person(self.dir.id, self.s).manager_id)


class TreeTests(Base):
    def test_forest_with_counts_and_inherited_values(self):
        self.org()
        loner = self.add("Zed")
        tree = P.org_tree(True, self.s)
        self.assertEqual([n.name for n in tree], ["Vera", "Zed"])
        vera = tree[0]
        self.assertEqual(vera.report_count, 3)
        ivy = vera.reports[0].reports[0].reports[0]
        self.assertEqual((ivy.name, ivy.effective_team.value, ivy.team), ("Ivy", "Maps Data", None))
        self.assertEqual(tree[1].id, loner.id)

    def test_archived_people_kept_by_default_or_skipped_with_reports_reattached(self):
        self.org()
        P.update_person(self.lead.id, PersonUpdate(archived_at=datetime(2026, 10, 1)), self.s)
        tree = P.org_tree(True, self.s)
        self.assertTrue(tree[0].reports[0].reports[0].archived)
        tree = P.org_tree(False, self.s)
        dana = tree[0].reports[0]
        self.assertEqual([r.name for r in dana.reports], ["Ivy"])
        self.assertEqual(dana.reports[0].effective_team.value, "Maps Data")

    def test_a_loop_in_stored_data_still_shows_everyone(self):
        a, b = Person(name="A"), Person(name="B")
        self.s.add_all([a, b])
        self.s.commit()
        a.manager_id, b.manager_id = b.id, a.id
        self.s.commit()
        tree = P.org_tree(True, self.s)
        names = []

        def walk(nodes):
            for n in nodes:
                names.append(n.name)
                walk(n.reports)
        walk(tree)
        self.assertEqual(sorted(names), ["A", "B"])
        self.assertEqual(P.get_person(a.id, self.s).chain[0].name, "B")  # no infinite walk


class RefAndSearchTests(Base):
    def test_people_numbered_and_parsed(self):
        a, b = self.add("A"), self.add("B")
        self.assertEqual((a.number, b.number), (1, 2))
        self.assertEqual((parse_ref("P12"), parse_ref("p-3"), person_ref(4)), (("P", 12), ("P", 3), "P4"))

    def test_search_finds_inherited_team_and_p_references(self):
        self.org()
        self.add("Other", team="Siri")
        names = [r.title for r in search("maps data", self.s) if r.type == "person"]
        self.assertEqual(sorted(names), ["Dana", "Ivy", "Lee"])
        hit = search("P4", self.s)[0]
        self.assertEqual((hit.type, hit.title, hit.number), ("person", "Ivy", 4))
        self.assertFalse(any(r.type == "person" for r in search("4", self.s)))  # bare numbers stay T/M
        self.assertIn("Maps Data", next(r for r in search("Ivy", self.s) if r.type == "person").subtitle)


class MigrationTests(unittest.TestCase):
    def test_person_columns_added_and_people_numbered_oldest_first(self):
        tmp = Path(tempfile.mkdtemp()) / "old.db"
        conn = sqlite3.connect(tmp)
        conn.executescript("""
            CREATE TABLE task (id VARCHAR PRIMARY KEY, action VARCHAR, created_at DATETIME, parent_task_id VARCHAR, notes VARCHAR, number INTEGER);
            CREATE TABLE day_status (day DATE PRIMARY KEY, status VARCHAR, note VARCHAR);
            CREATE TABLE person (id VARCHAR PRIMARY KEY, name VARCHAR, role VARCHAR, team VARCHAR,
                                 relationship VARCHAR, notes VARCHAR, archived_at DATETIME, created_at DATETIME);
            INSERT INTO person (id, name, created_at) VALUES ('b', 'Bo', '2026-02-01'), ('a', 'Al', '2026-01-01');
        """)
        conn.commit()
        conn.close()
        with mock.patch.object(database, "DB_PATH", tmp):
            database._run_migrations()
            database._run_migrations()  # running again changes nothing
        conn = sqlite3.connect(tmp)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(person)")}
        self.assertTrue({"focus", "manager_id", "is_placeholder", "number"} <= cols)
        self.assertEqual(conn.execute("SELECT id, number, is_placeholder FROM person ORDER BY number").fetchall(),
                         [("a", 1, 0), ("b", 2, 0)])
        conn.close()


if __name__ == "__main__":
    unittest.main()
