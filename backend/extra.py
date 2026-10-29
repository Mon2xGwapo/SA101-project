import json, os
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from supabase import create_client
from google import genai
from google.genai import types

router = APIRouter()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
gem = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
STAFF = {"technician", "it_admin", "sys_admin"}


# ---------- auth ----------
def user(authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    try:
        u = sb.auth.get_user(token).user
        role = sb.table("profiles").select("role").eq("id", u.id).single().execute().data["role"]
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    return {"id": u.id, "role": role}


def staff(u=Depends(user)):
    if u["role"] not in STAFF:
        raise HTTPException(403, "Staff only")
    return u


def embed(text: str, task: str = "RETRIEVAL_DOCUMENT"):
    r = gem.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type=task, output_dimensionality=768),
    )
    return r.embeddings[0].values


def ask_json(prompt: str) -> dict:
    r = gem.models.generate_content(
        model=MODEL, contents=prompt, config={"response_mime_type": "application/json"}
    )
    return json.loads(r.text)


# ---------- 1. AI troubleshooting chat ----------
class Msg(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    messages: list[Msg]


CHAT_PROMPT = """You are NexDesk, an IT helpdesk assistant.
Fix problems using ONLY the approved articles below. If they don't cover the problem,
ask at most 2 short follow-up questions, or say you're not sure.
Give short numbered steps. Never ask for passwords. Never tell the user to change
network, security or system settings unless an article says so.
Set needs_ticket to true if the problem is urgent, security-related, or likely unsolved.
Return ONLY JSON: {{"reply": "...", "needs_ticket": true or false}}

APPROVED ARTICLES:
{kb}

CONVERSATION:
{convo}"""


@router.post("/chat")
def chat(body: ChatIn, u=Depends(user)):
    if not body.messages:
        raise HTTPException(400, "No messages")
    query = " ".join(m.content for m in body.messages if m.role == "user")[-1000:]
    hits = sb.rpc("match_kb", {
        "query_embedding": embed(query, "RETRIEVAL_QUERY"),
        "match_count": 3, "min_similarity": 0.55,
    }).execute().data or []
    kb = "\n\n".join(f"[{h['id']}] {h['title']}\n{h['body']}" for h in hits) or "(none found)"
    convo = "\n".join(f"{m.role}: {m.content}" for m in body.messages[-10:])
    data = ask_json(CHAT_PROMPT.format(kb=kb, convo=convo))
    return {
        "reply": data.get("reply", "Sorry, I couldn't process that."),
        "needs_ticket": bool(data.get("needs_ticket")),
        "sources": [{"id": h["id"], "title": h["title"]} for h in hits],
    }


# ---------- 2. Resolved ticket -> KB article ----------
DRAFT_PROMPT = """Write a reusable troubleshooting article from this resolved IT ticket.
Remove names, emails, passwords, IP addresses and hostnames.
Use a clear title, a short "Symptoms" line, then numbered fix steps in markdown.
Return ONLY JSON: {{"title": "...", "body": "...", "category": "network|hardware|software|accounts|security|general"}}

TICKET: {title}
DESCRIPTION: {description}
TECHNICIAN NOTES:
{notes}"""


@router.post("/kb/draft/{ticket_id}")
def kb_draft(ticket_id: int, u=Depends(staff)):
    t = sb.table("tickets").select("title,description").eq("id", ticket_id).single().execute().data
    cs = sb.table("ticket_comments").select("body").eq("ticket_id", ticket_id) \
        .order("created_at").execute().data
    notes = "\n".join(f"- {c['body']}" for c in cs) or "(no comments)"
    return ask_json(DRAFT_PROMPT.format(notes=notes, **t))


class KBIn(BaseModel):
    title: str
    body: str
    category: Optional[str] = None
    source_ticket_id: Optional[int] = None


@router.post("/kb")
def kb_publish(a: KBIn, u=Depends(staff)):
    row = {**a.model_dump(), "created_by": u["id"], "embedding": embed(f"{a.title}\n{a.body}")}
    return {"id": sb.table("kb_articles").insert(row).execute().data[0]["id"]}


# ---------- 3. Monitoring ingest, alert rules, incident -> ticket ----------
class Metric(BaseModel):
    host: str
    cpu: float
    memory: float
    disk: float
    uptime_s: int = 0
    services: dict[str, bool] = {}


TEAM_FOR = {"cpu": "general", "memory": "general", "disk": "hardware", "service": "software"}


def check(host: str, metric: str, value: float, breached: bool, urgency: str, threshold):
    open_alert = sb.table("alerts").select("id").eq("host", host) \
        .eq("metric", metric).eq("status", "open").execute().data
    if breached and not open_alert:
        kind = metric.split(":")[0]
        desc = (f"Automatic alert from the monitoring agent.\nHost: {host}\nMetric: {metric}\n"
                f"Value: {value}\nThreshold: {threshold}\n"
                "No automatic fix was applied. A technician should investigate.")
        ticket = sb.table("tickets").insert({
            "title": f"[ALERT] {metric} on {host}", "description": desc,
            "created_by": None, "source": "monitoring", "category": "infrastructure",
            "urgency": urgency, "affected_service": host,
            "routed_team": TEAM_FOR.get(kind, "general"), "status": "open",
        }).execute().data[0]
        sb.table("alerts").insert({
            "host": host, "metric": metric, "value": value,
            "threshold": threshold, "ticket_id": ticket["id"],
        }).execute()
    elif not breached and open_alert:
        sb.table("alerts").update({
            "status": "resolved", "resolved_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", open_alert[0]["id"]).execute()


@router.post("/metrics")
def ingest(m: Metric, x_api_key: str = Header(...)):
    if x_api_key != os.environ["AGENT_API_KEY"]:
        raise HTTPException(401, "Bad API key")
    sb.table("metrics").insert({
        "host": m.host, "cpu": m.cpu, "memory": m.memory,
        "disk": m.disk, "uptime_s": m.uptime_s,
    }).execute()
    values = {"cpu": m.cpu, "memory": m.memory, "disk": m.disk}
    for r in sb.table("alert_rules").select("*").eq("enabled", True).execute().data:
        v = values.get(r["metric"])
        if v is not None:
            check(m.host, r["metric"], v, v >= r["threshold"], r["urgency"], r["threshold"])
    for name, up in m.services.items():
        check(m.host, f"service:{name}", 1 if up else 0, not up, "high", None)
    return {"ok": True}