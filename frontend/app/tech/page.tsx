"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL;
const STAFF = ["technician", "it_admin", "sys_admin"];
const STATUSES = ["open", "assigned", "in_progress", "resolved", "closed"];

type Ticket = {
  id: number; title: string; description: string; status: string;
  urgency: string | null; routed_team: string | null; ai_summary: string | null;
  assigned_to: string | null; created_at: string;
};

export default function TechPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<"mine" | "unassigned" | "all">("mine");
  const [sel, setSel] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [draft, setDraft] = useState<{ title: string; body: string; category: string } | null>(null);
  const [msg, setMsg] = useState("");

  const loadTickets = useCallback(async () => {
    const { data } = await supabase.from("tickets").select("*").order("created_at", { ascending: false });
    setTickets(data ?? []);
    setSel(s => (s ? (data ?? []).find((t: Ticket) => t.id === s.id) ?? null : s));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace("/tickets");
      const { data } = await supabase.from("profiles").select("id,role").eq("id", session.user.id).single();
      if (!data || !STAFF.includes(data.role)) return router.replace("/tickets");
      setMe(data);
      loadTickets();
    })();
  }, [router, loadTickets]);

  async function loadComments(id: number) {
    const { data } = await supabase.from("ticket_comments")
      .select("*, profiles(email)").eq("ticket_id", id).order("created_at");
    setComments(data ?? []);
  }

  function open(t: Ticket) {
    setSel(t); setDraft(null); setMsg("");
    loadComments(t.id);
  }

  async function patch(id: number, p: Record<string, unknown>) {
    const { error } = await supabase.from("tickets")
      .update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) setMsg(error.message); else loadTickets();
  }

  function assignToMe() {
    if (!sel || !me) return;
    patch(sel.id, { assigned_to: me.id, status: sel.status === "open" ? "assigned" : sel.status });
  }

  async function addComment() {
    if (!sel || !text.trim()) return;
    const { error } = await supabase.from("ticket_comments")
      .insert({ ticket_id: sel.id, body: text, is_internal: internal });
    if (error) return setMsg(error.message);
    setText("");
    loadComments(sel.id);
  }

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token}`, "Content-Type": "application/json" };
  }

  async function makeDraft() {
    if (!sel) return;
    setMsg("AI is drafting the article...");
    const res = await fetch(`${API}/kb/draft/${sel.id}`, { method: "POST", headers: await authHeader() });
    if (!res.ok) return setMsg(await res.text());
    setDraft(await res.json());
    setMsg("");
  }

  async function publish() {
    if (!sel || !draft) return;
    const res = await fetch(`${API}/kb`, {
      method: "POST", headers: await authHeader(),
      body: JSON.stringify({ ...draft, source_ticket_id: sel.id }),
    });
    if (!res.ok) return setMsg(await res.text());
    setDraft(null);
    setMsg("Published to the knowledge base.");
  }

  const shown = tickets.filter(t =>
    filter === "all" ? true : filter === "mine" ? t.assigned_to === me?.id : !t.assigned_to);
  const done = sel && ["resolved", "closed"].includes(sel.status);

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Technician Workspace</h1>
        <Link href="/tickets" className="text-sm underline">Back to tickets</Link>
      </header>
      {msg && <div className="p-2 rounded bg-blue-100 text-blue-800 text-sm">{msg}</div>}

      <div className="grid md:grid-cols-3 gap-4">
        <section className="space-y-2">
          <div className="flex gap-2 text-sm">
            {(["mine", "unassigned", "all"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded capitalize ${filter === f ? "bg-blue-600 text-white" : "border"}`}>{f}</button>
            ))}
          </div>
          {shown.map(t => (
            <button key={t.id} onClick={() => open(t)}
              className={`w-full text-left border rounded-xl p-3 ${sel?.id === t.id ? "border-blue-600" : ""}`}>
              <p className="font-medium text-sm">#{t.id} {t.title}</p>
              <p className="text-xs text-gray-500">{t.status} · {t.urgency ?? "n/a"} · {t.routed_team ?? "unrouted"}</p>
            </button>
          ))}
          {shown.length === 0 && <p className="text-sm text-gray-500">Nothing here.</p>}
        </section>

        <section className="md:col-span-2">
          {!sel ? <p className="text-gray-500">Select a ticket.</p> : (
            <div className="border rounded-xl p-4 space-y-4">
              <div>
                <h2 className="font-semibold">#{sel.id} {sel.title}</h2>
                <p className="text-sm mt-1 whitespace-pre-wrap">{sel.description}</p>
                {sel.ai_summary && <p className="text-xs text-gray-500 mt-1">AI summary: {sel.ai_summary}</p>}
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <select className="border rounded p-1 text-sm bg-transparent" value={sel.status}
                  onChange={e => patch(sel.id, { status: e.target.value })}>
                  {STATUSES.map(s => <option key={s} className="text-black">{s}</option>)}
                </select>
                {sel.assigned_to !== me?.id && (
                  <button onClick={assignToMe} className="bg-blue-600 text-white text-sm px-3 py-1 rounded">Assign to me</button>
                )}
                {sel.assigned_to === me?.id && (
                  <button onClick={() => patch(sel.id, { assigned_to: null, status: "open" })}
                    className="border text-sm px-3 py-1 rounded">Unassign</button>
                )}
                {done && (
                  <button onClick={makeDraft} className="bg-green-600 text-white text-sm px-3 py-1 rounded">
                    Convert to KB article
                  </button>
                )}
              </div>

              {draft && (
                <div className="border rounded-lg p-3 space-y-2">
                  <p className="text-sm font-semibold">Review the AI draft before publishing</p>
                  <input className="w-full border p-2 rounded bg-transparent" value={draft.title}
                    onChange={e => setDraft({ ...draft, title: e.target.value })} />
                  <textarea rows={8} className="w-full border p-2 rounded bg-transparent text-sm" value={draft.body}
                    onChange={e => setDraft({ ...draft, body: e.target.value })} />
                  <div className="flex gap-2">
                    <button onClick={publish} className="bg-green-600 text-white text-sm px-3 py-1 rounded">Publish</button>
                    <button onClick={() => setDraft(null)} className="border text-sm px-3 py-1 rounded">Discard</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Comments</h3>
                {comments.map(c => (
                  <div key={c.id} className={`text-sm rounded p-2 ${c.is_internal ? "bg-yellow-100 text-black" : "border"}`}>
                    <p className="text-xs text-gray-500">
                      {c.profiles?.email ?? "user"} · {new Date(c.created_at).toLocaleString()}
                      {c.is_internal && " · internal note"}
                    </p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
                <textarea rows={2} className="w-full border p-2 rounded bg-transparent text-sm"
                  placeholder="Write a reply or note..." value={text} onChange={e => setText(e.target.value)} />
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />
                    Internal note (hidden from the employee)
                  </label>
                  <button onClick={addComment} className="bg-blue-600 text-white px-3 py-1 rounded">Add</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}