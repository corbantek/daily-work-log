"""Agent API, people half (/agent/people, /agent/interactions, /agent/framework).
Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from api.models import CompetencyAttribute, CompetencyDimension, Interaction, Person, Workstream
from api.routes import agent as A
from api.routes import agent_people as AP

TODAY = date.today()


class Base(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)
        self.s.add(CompetencyDimension(key="teamwork", label="Teamwork", sort_order=0))
        self.s.add(CompetencyDimension(key="impact", label="Impact", sort_order=1))
        self.s.add(CompetencyAttribute(dimension_key="teamwork", text="Shares context openly"))
        self.s.add(CompetencyAttribute(dimension_key="teamwork", text="Helps others unblock"))
        self.s.add(Workstream(name="Maps Sync"))
        self.s.commit()

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def add(self, name, **kw):
        return AP.agent_create_person(AP.NewPerson(name=name, **kw), self.s)

    def assert_status(self, code, fn, contains=""):
        with self.assertRaises(HTTPException) as cm:
            fn()
        self.assertEqual(cm.exception.status_code, code)
        self.assertIn(contains, str(cm.exception.detail))
        return cm.exception.detail

    def activity(self):
        return A.agent_activity(50, self.s)


class PeopleTests(Base):
    def test_build_an_org_by_name_and_inherit_team(self):
        vera = self.add("Vera Ng", role="VP", team="Maps", focus="Maps platform")
        self.assertEqual(vera["ref"], "P1")
        dana = self.add("Dana Ruiz", manager="vera", team="Maps Data")  # unique partial name
        ivy = self.add("Ivy Chen", manager="P2", role="iOS engineer")
        self.assertEqual(ivy["manager"], {"ref": "P2", "name": "Dana Ruiz"})
        self.assertEqual((ivy["team"], ivy["team_inherited_from"]), ("Maps Data", "Dana Ruiz"))
        self.assertEqual((ivy["focus"], ivy["focus_inherited_from"]), ("Maps platform", "Vera Ng"))
        self.assertEqual(ivy["own"], {"team": None, "focus": None})
        self.assertEqual([c["name"] for c in ivy["chain"]], ["Dana Ruiz", "Vera Ng"])
        self.assertEqual([r["ref"] for r in AP.agent_person("Dana", self.s)["reports"]], ["P3"])
        tree = AP.agent_people_tree(False, self.s)["roots"]
        self.assertEqual(tree[0]["reports"][0]["reports"][0], {"ref": "P3", "name": "Ivy Chen", "role": "iOS engineer"})
        self.assertEqual([p["name"] for p in AP.agent_people(None, "maps data", False, self.s)["people"]], ["Dana Ruiz", "Ivy Chen"])
        self.assertIn('added P2 "Dana Ruiz" reporting to Vera Ng', [a["summary"] for a in self.activity()])
        self.assertEqual(dana["ref"], "P2")

    def test_update_moves_clears_and_archives(self):
        self.add("Vera", team="Maps")
        self.add("Lee", team="Tiles", manager="Vera")
        out = AP.agent_update_person("Lee", AP.PersonChanges(team="", focus="Offline"), self.s)
        self.assertEqual((out["team"], out["team_inherited_from"], out["focus"]), ("Maps", "Vera", "Offline"))
        out = AP.agent_update_person("P2", AP.PersonChanges(manager=""), self.s)
        self.assertIsNone(out["manager"])
        out = AP.agent_update_person("Lee", AP.PersonChanges(archived=True), self.s)
        self.assertTrue(out["archived"])
        self.assertEqual([p["name"] for p in AP.agent_people(None, None, False, self.s)["people"]], ["Vera"])
        last = self.activity()[0]
        self.assertEqual((last["action"], last["entity_type"]), ("update_person", "person"))
        self.assertIn("archived", last["summary"])

    def test_loops_unknowns_and_ambiguity_are_400_or_404(self):
        self.add("Vera")
        self.add("Lee", manager="Vera")
        self.assert_status(400, lambda: AP.agent_update_person("Vera", AP.PersonChanges(manager="Lee"), self.s), "loop")
        self.assert_status(404, lambda: self.add("X", manager="Nobody"), "No person")
        self.add("Lee Park")
        detail = self.assert_status(400, lambda: AP.agent_person("le", self.s), "ambiguous")
        self.assertEqual(len(detail["matches"]), 2)
        self.assertEqual(AP.agent_person("Lee", self.s)["ref"], "P2")  # an exact name wins
        self.assert_status(400, lambda: AP.agent_person("T1", self.s), "not a person reference")
        self.assert_status(400, lambda: AP.agent_update_person("Vera", AP.PersonChanges(), self.s), "Nothing to change")

    def test_archived_namesake_does_not_make_a_name_ambiguous(self):
        self.add("Sam")
        AP.agent_update_person("Sam", AP.PersonChanges(archived=True), self.s)
        self.add("Sam")
        self.assertEqual(AP.agent_person("Sam", self.s)["ref"], "P2")

    def test_notes_append_replace_with_snapshots(self):
        self.add("Vera", notes="Met at offsite.")
        out = AP.agent_person_notes("Vera", A.NotesText(text="Runs the Maps org."), self.s)
        self.assertEqual(out["notes"], "Met at offsite.\n\nRuns the Maps org.")
        self.assertTrue(out["notes_backup"].startswith("P1--"))
        self.assertEqual(A.agent_note_backups("P1")["backups"][0]["name"], out["notes_backup"])
        self.assertEqual(A.agent_note_backup("P1", out["notes_backup"])["notes"], "Met at offsite.")
        out = AP.agent_person_notes("P1", A.NotesText(text="Only this.", mode="replace"), self.s)
        self.assertEqual(out["notes"], "Only this.")


class InteractionTests(Base):
    def test_log_with_tags_sentiment_alias_and_workstream(self):
        self.add("Ivy")
        out = AP.agent_log_interaction("Ivy", AP.NewInteraction(
            summary="Walked the team through the sync design", sentiment="kudos",
            tags=["teamwork: shares context", "Impact"], workstream="maps", notes="Clear doc."), self.s)
        self.assertEqual((out["sentiment"], out["workstream"], out["date"]), ("strength", "Maps Sync", TODAY.isoformat()))
        self.assertEqual(out["tags"], ["Teamwork: Shares context openly", "Impact"])
        detail = AP.agent_person("Ivy", self.s)
        self.assertEqual((detail["interaction_count"], detail["recent_interactions"][0]["id"]), (1, out["id"]))
        last = self.activity()[0]
        self.assertEqual((last["entity_type"], last["entity_id"]), ("person", detail["id"]))

    def test_bad_tags_and_sentiment_list_the_options(self):
        self.add("Ivy")
        d = self.assert_status(400, lambda: AP.agent_log_interaction("Ivy", AP.NewInteraction(summary="x", tags=["Charisma"]), self.s), "Unknown")
        self.assertIn("Teamwork", d["valid"])
        d = self.assert_status(400, lambda: AP.agent_log_interaction("Ivy", AP.NewInteraction(summary="x", tags=["Teamwork: o"]), self.s), "ambiguous")
        self.assertEqual(len(d["matches"]), 2)
        self.assert_status(400, lambda: AP.agent_log_interaction("Ivy", AP.NewInteraction(summary="x", sentiment="meh"), self.s), "sentiment")
        self.assertEqual(self.s.exec(select(Interaction)).all(), [])

    def test_update_interaction_and_list_and_review_draft(self):
        self.add("Ivy")
        i = AP.agent_log_interaction("Ivy", AP.NewInteraction(summary="Missed handoff", sentiment="concern",
                                                              tags=["Teamwork"]), self.s)
        out = AP.agent_update_interaction(i["id"], AP.InteractionChanges(tags=["Teamwork: helps"], notes="Followed up."), self.s)
        self.assertEqual((out["tags"], out["notes"], out["sentiment"]), (["Teamwork: Helps others unblock"], "Followed up.", "growth"))
        self.assertIn("tags", self.activity()[0]["summary"])
        listed = AP.agent_person_interactions("Ivy", None, None, "growth", self.s)
        self.assertEqual(listed["count"], 1)
        self.assertEqual(AP.agent_person_interactions("Ivy", None, None, "strength", self.s)["count"], 0)
        draft = AP.agent_person_review_draft("Ivy", None, None, self.s)
        self.assertEqual(draft["total_interactions"], 1)
        self.assertEqual(draft["dimensions"][0]["dimension"], "Teamwork")
        self.assert_status(404, lambda: AP.agent_update_interaction("nope", AP.InteractionChanges(summary="x"), self.s))

    def test_framework_lists_tags(self):
        fw = AP.agent_framework(self.s)
        self.assertEqual(fw["dimensions"][0], {"dimension": "Teamwork", "key": "teamwork",
                                               "attributes": ["Shares context openly", "Helps others unblock"]})


if __name__ == "__main__":
    unittest.main()
