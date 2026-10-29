"use client";
import { useEffect, useRef, useState, FormEvent } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Msg = { role: "user" | "assistant"; content: string };
const API = process.env.NEXT_PUBLIC_API_URL;

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi! Describe your IT problem and I'll help you fix it." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<{ id: number; title: string }[]>([]);
  const [escalate, setEscalate] = useState(false);
  const [msg, setMsg] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user" as const, content: input }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ messages: next }),
      });
      if (res.status === 401) throw new Error("Please sign in first at /tickets");
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      setMessages([...next, { role: "assistant", content: d.reply }]);
      setSources(d.sources);
      setEscalate(d.needs_ticket);
    } catch (err: any) {
      setMsg(err.message);
    }
    setBusy(false);
  }

  async function createTicket() {
    const userText = messages.filter(m => m.role === "user").map(m => m.content);
    const title = userText[0].slice(0, 80);
    const description = messages.map(m => `${m.role}: ${m.content}`).join("\n");
    try {
      const res = await fetch(`${API}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const ai = await res.json();
      const { error } = await supabase.from("tickets").insert({
        title, description,
        category: ai.category, urgency: ai.urgency,
        affected_service: ai.affected_service, routed_team: ai.routed_team,
        ai_confidence: ai.confidence, ai_summary: ai.summary,
        status: ai.needs_human_review ? "open" : "assigned",
      });
      if (error) throw error;
      setMsg("Ticket created. The IT team will follow up.");
      setEscalate(false);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 flex flex-col h-screen">
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">AI Troubleshooting</h1>
        <Link href="/tickets" className="text-sm underline">Back to tickets</Link>
      </header>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm ${
              m.role === "user" ? "bg-blue-600 text-white" : "border"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-gray-500">Thinking...</p>}
        <div ref={bottom} />
      </div>

      {sources.length > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          Based on: {sources.map(s => s.title).join(", ")}
        </p>
      )}
      {messages.length > 1 && (
        <button onClick={createTicket}
          className={`mt-2 text-sm rounded px-3 py-2 ${escalate ? "bg-orange-500 text-white" : "border"}`}>
          {escalate ? "This needs IT: create a ticket" : "Still not fixed? Create a ticket"}
        </button>
      )}
      {msg && <p className="text-sm text-red-500 mt-2">{msg}</p>}

      <form onSubmit={send} className="flex gap-2 mt-3">
        <input className="flex-1 border p-2 rounded" placeholder="Describe your problem..."
          value={input} onChange={e => setInput(e.target.value)} />
        <button disabled={busy} className="bg-blue-600 text-white px-4 rounded disabled:opacity-50">Send</button>
      </form>
    </main>
  );
}