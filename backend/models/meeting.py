from pydantic import BaseModel, HttpUrl


class ProcessMeetingRequest(BaseModel):
    audio_url: HttpUrl
    meeting_id: str
    push_token: str


class ProcessMeetingResponse(BaseModel):
    message: str
    meeting_id: str
