"""Tasks list as in progress, todo, done, abandoned. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date

from sqlmodel import Session, SQLModel, create_engine

from api.models import TaskCreate, TaskState
from api.routes.day import get_day
from api.routes.tasks import create_task, list_tasks

WANTED = [TaskState.IN_PROGRESS, TaskState.TODO, TaskState.COMPLETE, TaskState.ABANDONED]


class TaskOrderTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)
        for st in reversed(WANTED):
            create_task(TaskCreate(action=st.value, state=st, start_date=date.today(), end_date=date.today()
                                   if st in (TaskState.COMPLETE, TaskState.ABANDONED) else None), self.s)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def test_list_tasks_order(self):
        self.assertEqual([t.state for t in list_tasks(session=self.s)], WANTED)

    def test_day_view_order(self):
        tasks = [t.state for sec in get_day(date.today(), self.s).workstreams for t in sec.tasks]
        self.assertEqual(tasks, WANTED)


if __name__ == "__main__":
    unittest.main()
