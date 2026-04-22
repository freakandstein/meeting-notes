import logging

from fastapi import FastAPI
from routers.meeting import router as meeting_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="MeetingNotes API",
    version="1.0.0",
    description="Backend API for processing meeting audio recordings.",
)

app.include_router(meeting_router)
