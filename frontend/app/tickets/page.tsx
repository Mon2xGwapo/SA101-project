"use client";
import { useEffect, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Ticket = {
  id: number; title: string; description: string; status: string;
  category: string | null; urgency: string | null; routed_team: string | null;
  ai_confidence: number | null; ai_summary: string | null; created_at: string;
};

const urgencyColor: Record<string, string> = {
  low: "bg-green-100 text-green-800", medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800", critical: "bg-red-100 text-red-800",
};

export default function TicketsPage() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState("employee");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) { loadRole(); loadTickets(); } }, [session]);

  async function loadRole() {
    const { data } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
    if (data) setRole(data.role);
  }

  async function loadTickets() {
    const { data } = await supabase.from("tickets").select("*").order("created_at", { ascending: false });
    setTickets(data ?? []);
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    let { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) ({ error } = await supabase.auth.signUp({ email, password }));
    setMsg(error ? error.message : "");
  }

  async function submitTicket(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/classify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
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
      setTitle(""); setDescription("");
      await loadTickets();
    } catch (err: any) { setMsg(err.message); }
    setBusy(false);
  }

  async function updateStatus(id: number, status: string) {
    await supabase.from("tickets").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    loadTickets();
  }

  const isStaff = role !== "employee";

  if (!session) return (
    <main className="max-w-sm mx-auto mt-24 p-6 border rounded-xl">
      <h1 className="text-2xl font-bold mb-4">NexDesk AI</h1>
      <form onSubmit={signIn} className="space-y-3">
        <input className="w-full border p-2 rounded" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="w-full border p-2 rounded" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="w-full bg-blue-600 text-white p-2 rounded">Sign in / Sign up</button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </form>
    </main>
  );

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
<header className="flex justify-between items-center">
  <h1 className="text-2xl font-bold">NexDesk AI <span className="text-sm font-normal text-gray-500">({role})</span></h1>
<div className="flex gap-3 items-center text-sm">
  <Link href="/chat" className="underline">AI Chat</Link>
  {["technician", "it_admin", "sys_admin"].includes(role) && (
    <Link href="/tech" className="underline">Technician</Link>
  )}
  {["management", "it_admin", "sys_admin"].includes(role) && (
    <Link href="/analytics" className="underline">Analytics</Link>
  )}
  {role === "it_admin" && (
    <Link href="/admin" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">Admin Panel</Link>
  )}
  <button className="underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
</div>
</header>

      <form onSubmit={submitTicket} className="border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Report an IT issue</h2>
        <input required className="w-full border p-2 rounded" placeholder="Short title" value={title} onChange={e => setTitle(e.target.value)} />
        <textarea required rows={3} className="w-full border p-2 rounded" placeholder="e.g. My computer cannot connect to the office WiFi" value={description} onChange={e => setDescription(e.target.value)} />
        <button disabled={busy} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
          {busy ? "AI is analyzing..." : "Submit ticket"}
        </button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </form>

      <section className="space-y-3">
        <h2 className="font-semibold">{isStaff ? "All tickets" : "My tickets"}</h2>
        {tickets.map(t => (
          <article key={t.id} className="border rounded-xl p-4">
            <div className="flex justify-between gap-2">
              <h3 className="font-medium">#{t.id} {t.title}</h3>
              <span className="text-xs px-2 py-1 rounded bg-gray-100">{t.status}</span>
            </div>
            <p className="text-sm text-gray-600 mt-1">{t.ai_summary ?? t.description}</p>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {t.urgency && <span className={`px-2 py-1 rounded ${urgencyColor[t.urgency]}`}>{t.urgency}</span>}
              {t.routed_team && <span className="px-2 py-1 rounded bg-blue-100 text-blue-800">→ {t.routed_team}</span>}
              {t.ai_confidence != null && <span className="px-2 py-1 rounded bg-gray-100">AI {Math.round(t.ai_confidence * 100)}%</span>}
            </div>
            {isStaff && (
              <select className="mt-3 border rounded p-1 text-sm" value={t.status} onChange={e => updateStatus(t.id, e.target.value)}>
                {["open", "assigned", "in_progress", "resolved", "closed"].map(s => <option key={s}>{s}</option>)}
              </select>
            )}
          </article>
        ))}
        {tickets.length === 0 && <p className="text-sm text-gray-500">No tickets yet.</p>}
      </section>
    </main>
  );
}