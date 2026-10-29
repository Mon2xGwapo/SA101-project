"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string; email: string | null; full_name: string | null;
  role: string; team: string | null;
};
type Ticket = {
  id: number; title: string; status: string; urgency: string | null;
  routed_team: string | null; ai_confidence: number | null;
  assigned_to: string | null; created_at: string;
};

const ROLES = ["employee", "technician", "it_admin", "sys_admin", "management"];
const TEAMS = ["network", "hardware", "software", "accounts", "security", "general"];
const STATUSES = ["open", "assigned", "in_progress", "resolved", "closed"];

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);
  const [users, setUsers] = useState<Profile[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tab, setTab] = useState<"overview" | "users" | "tickets">("overview");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace("/tickets");
      const { data } = await supabase
        .from("profiles").select("*").eq("id", session.user.id).single();
      if (!data || data.role !== "it_admin") return router.replace("/tickets");
      setMe(data);
      setChecking(false);
      loadAll();
    })();
  }, [router]);

  async function loadAll() {
    const [u, t] = await Promise.all([
      supabase.from("profiles").select("*").order("email"),
      supabase.from("tickets").select("id,title,status,urgency,routed_team,ai_confidence,assigned_to,created_at")
        .order("created_at", { ascending: false }),
    ]);
    setUsers(u.data ?? []);
    setTickets(t.data ?? []);
  }

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  }

  async function updateUser(id: string, patch: Partial<Profile>) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) return flash(error.message);
    flash("User updated");
    loadAll();
  }

  async function updateTicket(id: number, patch: Record<string, unknown>) {
    const { error } = await supabase
      .from("tickets")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return flash(error.message);
    flash("Ticket updated");
    loadAll();
  }

  if (checking) return <p className="p-6">Checking access...</p>;

  const technicians = users.filter(u => u.role === "technician" || u.role === "it_admin");
  const count = (s: string) => tickets.filter(t => t.status === s).length;
  const needsReview = tickets.filter(
    t => t.status === "open" && (t.ai_confidence ?? 0) < 0.6
  ).length;
  const nameOf = (id: string | null) =>
    users.find(u => u.id === id)?.email ?? "Unassigned";

  const stats = [
    { label: "Total tickets", value: tickets.length },
    { label: "Open", value: count("open") },
    { label: "In progress", value: count("in_progress") },
    { label: "Resolved", value: count("resolved") },
    { label: "Needs review", value: needsReview },
    { label: "Users", value: users.length },
  ];

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">
          Admin Panel <span className="text-sm font-normal text-gray-500">({me?.email})</span>
        </h1>
        <a href="/tickets" className="text-sm underline">Back to tickets</a>
      </header>

      {msg && <div className="p-2 rounded bg-blue-100 text-blue-800 text-sm">{msg}</div>}

      <nav className="flex gap-2 border-b">
        {(["overview", "users", "tickets"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 capitalize ${tab === t ? "border-b-2 border-blue-600 font-semibold" : "text-gray-500"}`}>
            {t}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <section className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map(s => (
            <div key={s.label} className="border rounded-xl p-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-3xl font-bold">{s.value}</p>
            </div>
          ))}
        </section>
      )}

      {tab === "users" && (
        <section className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl">
            <thead className="bg-gray-100 text-black text-left">
              <tr><th className="p-2">Email</th><th className="p-2">Role</th><th className="p-2">Team</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t">
                  <td className="p-2">{u.email ?? u.id}</td>
                  <td className="p-2">
                    <select className="border rounded p-1 bg-transparent" value={u.role}
                      disabled={u.id === me?.id}
                      title={u.id === me?.id ? "You can't change your own role" : ""}
                      onChange={e => updateUser(u.id, { role: e.target.value })}>
                      {ROLES.map(r => <option key={r} value={r} className="text-black">{r}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <select className="border rounded p-1 bg-transparent" value={u.team ?? ""}
                      onChange={e => updateUser(u.id, { team: e.target.value || null })}>
                      <option value="" className="text-black">none</option>
                      {TEAMS.map(t => <option key={t} value={t} className="text-black">{t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "tickets" && (
        <section className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl">
            <thead className="bg-gray-100 text-black text-left">
              <tr>
                <th className="p-2">#</th><th className="p-2">Title</th>
                <th className="p-2">Team</th><th className="p-2">AI</th>
                <th className="p-2">Status</th><th className="p-2">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{t.id}</td>
                  <td className="p-2">{t.title}</td>
                  <td className="p-2">
                    <select className="border rounded p-1 bg-transparent" value={t.routed_team ?? ""}
                      onChange={e => updateTicket(t.id, { routed_team: e.target.value })}>
                      <option value="" className="text-black">-</option>
                      {TEAMS.map(x => <option key={x} value={x} className="text-black">{x}</option>)}
                    </select>
                  </td>
                  <td className="p-2">{t.ai_confidence != null ? `${Math.round(t.ai_confidence * 100)}%` : "-"}</td>
                  <td className="p-2">
                    <select className="border rounded p-1 bg-transparent" value={t.status}
                      onChange={e => updateTicket(t.id, { status: e.target.value })}>
                      {STATUSES.map(s => <option key={s} className="text-black">{s}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <select className="border rounded p-1 bg-transparent" value={t.assigned_to ?? ""}
                      onChange={e => updateTicket(t.id, {
                        assigned_to: e.target.value || null,
                        ...(e.target.value && t.status === "open" ? { status: "assigned" } : {}),
                      })}>
                      <option value="" className="text-black">Unassigned</option>
                      {technicians.map(u => (
                        <option key={u.id} value={u.id} className="text-black">{u.email}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}