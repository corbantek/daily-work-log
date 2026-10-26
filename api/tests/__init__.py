# Keep every test's files away from the real app folders: anything that saves files (attachments,
# note snapshots) goes to a throwaway directory unless a test sets its own.
import os
import tempfile

_scratch = tempfile.mkdtemp(prefix="worklog-tests-")
os.environ.setdefault("WORKLOG_FILES", os.path.join(_scratch, "files"))
os.environ.setdefault("WORKLOG_NOTE_SNAPSHOTS", os.path.join(_scratch, "note-snapshots"))
