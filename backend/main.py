import json, os
from typing import Literal, Optional
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
app = FastAPI(title="NexDesk AI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_methods=["*"], allow_headers=["*"],
)
from extra import router as extra_router
app.include_router(extra_router)

TEAMS = ["network", "hardware", "software", "accounts", "security", "general"]
CONFIDENCE_THRESHOLD = 0.6  # below this, a human must confirm routing


class TicketIn(BaseModel):
    title: str
    description: str


class Classification(BaseModel):
    category: str
    urgency: Literal["low", "medium", "high", "critical"]
    affected_service: str
    routed_team: str
    confidence: float
    summary: str
    follow_up_questions: list[str] = []
    needs_human_review: bool = False


# --- Fallback rule-based classifier (works without an API key) ---
RULES = {
    "network":  ["wifi", "wi-fi", "internet", "network", "vpn", "lan", "dns"],
    "hardware": ["printer", "monitor", "keyboard", "mouse", "laptop", "battery", "screen"],
    "accounts": ["password", "login", "locked", "account", "access", "email"],
    "security": ["virus", "malware", "phishing", "hacked", "suspicious"],
    "software": ["install", "crash", "error", "update", "app", "excel", "office"],
}

def rule_based(t: TicketIn) -> Classification:
    text = f"{t.title} {t.description}".lower()
    scores = {team: sum(k in text for k in kws) for team, kws in RULES.items()}
    team, hits = max(scores.items(), key=lambda x: x[1])
    if hits == 0:
        team = "general"
    urgency = "high" if any(w in text for w in ["urgent", "down", "cannot work"]) else "medium"
    conf = min(0.4 + 0.15 * hits, 0.8)
    return Classification(
        category=team, urgency=urgency, affected_service=team,
        routed_team=team, confidence=conf, summary=t.title,
        needs_human_review=conf < CONFIDENCE_THRESHOLD,
    )


# --- Gemini classifier ---
PROMPT = """You are an IT helpdesk triage assistant. Classify the ticket.
Return ONLY JSON with keys: category, urgency (low|medium|high|critical),
affected_service, routed_team (one of {teams}), confidence (0-1),
summary (one sentence), follow_up_questions (array, max 3).
Never suggest changing network or security settings automatically.

Title: {title}
Description: {description}"""

def gemini_classify(t: TicketIn) -> Classification:
    from google import genai
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    resp = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=PROMPT.format(teams=TEAMS, title=t.title, description=t.description),
        config={"response_mime_type": "application/json"},
    )
    data = json.loads(resp.text)
    if data.get("routed_team") not in TEAMS:
        data["routed_team"] = "general"
    c = Classification(**data)
    c.needs_human_review = c.confidence < CONFIDENCE_THRESHOLD
    return c


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/classify", response_model=Classification)
def classify(ticket: TicketIn):
    if os.getenv("GEMINI_API_KEY"):
        try:
            return gemini_classify(ticket)
        except Exception as e:  # fall back so ticket creation never breaks
            print("Gemini failed, using rules:", e)
    return rule_based(ticket)