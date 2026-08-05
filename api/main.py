from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routes import workstreams, tasks, meetings, labels, day, backup

app = FastAPI(title="Daily Work Log", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(workstreams.router)
app.include_router(tasks.router)
app.include_router(meetings.router)
app.include_router(labels.router)
app.include_router(day.router)
app.include_router(backup.router)
