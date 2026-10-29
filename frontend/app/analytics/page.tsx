"use client";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";

const ALLOWED = ["management", "it_admin", "sys_admin"];
const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
const avg = (xs: number[]) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : 0);
const day = (d: Date) => d.toISOString().slice(5, 10);

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border rounded-xl p-4">
    <h2 className="font-semibold mb-3">{title}</h2>
    <div className="h-64">{children}</div>
  </div>
);

export default function Analytics() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);

  async function load() {
    const [t, a, m] = await Promise.all([
      supabase.from("tickets").select("status,category,routed_team,created_at,first_response_at,resolved_at"),
      supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("metrics").select("host,cpu,memory,disk,created_at")
        .order("created_at", { ascending: false }).limit(500),
    ]);
    setTickets(t.data ?? []);
    setAlerts(a.data ?? []);
    setMetrics(m.data ?? []);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace("/tickets");
      const { data } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      if (!data || !ALLOWED.includes(data.role)) return router.replace("/tickets");
      setOk(true);
      load();
      timer = setInterval(load, 30000);
    })();
    return () => clearInterval(timer);
  }, [router]);

  const d = useMemo(() => {
    const backlog = ["open", "assigned", "in_progress", "resolved", "closed"]
      .map(status => ({ status, count: tickets.filter(t => t.status === status).length }));

    const days = Array.from({ length: 14 }, (_, i) => {
      const x = new Date(); x.setDate(x.getDate() - (13 - i)); return day(x);
    });
    const volume = days.map(k => ({
      day: k,
      opened: tickets.filter(t => day(new Date(t.created_at)) === k).length,
      resolved: tickets.filter(t => t.resolved_at && day(new Date(t.resolved_at)) === k).length,
    }));

    const teams = [...new Set(tickets.map(t => t.routed_team).filter(Boolean))] as string[];
    const times = teams.map(team => {
      const ts = tickets.filter(t => t.routed_team === team);
      return {
        team,
        response_h: avg(ts.filter(t => t.first_response_at).map(t => hours(t.created_at, t.first_response_at))),
        resolution_h: avg(ts.filter(t => t.resolved_at).map(t => hours(t.created_at, t.resolved_at))),
      };
    });

    const top = (counts: Record<string, number>) =>
      Object.entries(counts).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count).slice(0, 8);
    const cat: Record<string, number> = {};
    tickets.forEach(t => { if (t.category) cat[t.category] = (cat[t.category] ?? 0) + 1; });
    const al: Record<string, number> = {};
    alerts.forEach(a => { const k = `${a.host} · ${a.metric}`; al[k] = (al[k] ?? 0) + 1; });

    const latest: Record<string, any> = {};
    metrics.forEach(m => { if (!latest[m.host]) latest[m.host] = m; }); // newest first

    const closed = tickets.filter(t => t.resolved_at);
    return {
      backlog, volume, times,
      recurring: top(cat), recurringAlerts: top(al), hosts: Object.values(latest),
      open: tickets.filter(t => ["open", "assigned", "in_progress"].includes(t.status)).length,
      avgResolution: avg(closed.map(t => hours(t.created_at, t.resolved_at))),
    };
  }, [tickets, alerts, metrics]);

  if (!ok) return <p className="p-6">Checking access...</p>;
  const openAlerts = alerts.filter(a => a.status === "open");
  const hot = (v: number) => (v >= 90 ? "text-red-500 font-bold" : "");

  const hbar = (data: { name: string; count: number }[], color: string) => (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={130} />
        <Tooltip />
        <Bar dataKey="count" fill={color} />
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Management Analytics</h1>
        <Link href="/tickets" className="text-sm underline">Back to tickets</Link>
      </header>

      <section className="grid grid-cols-3 gap-4">
        {[
          ["Open backlog", d.open],
          ["Avg resolution (hours)", d.avgResolution],
          ["Open infrastructure alerts", openAlerts.length],
        ].map(([l, v]) => (
          <div key={l as string} className="border rounded-xl p-4">
            <p className="text-sm text-gray-500">{l}</p>
            <p className="text-3xl font-bold">{v}</p>
          </div>
        ))}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <Card title="Backlog by status">
          <ResponsiveContainer>
            <BarChart data={d.backlog}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" /><YAxis allowDecimals={false} /><Tooltip />
              <Bar dataKey="count" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Tickets opened vs resolved (14 days)">
          <ResponsiveContainer>
            <LineChart data={d.volume}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
              <Line type="monotone" dataKey="opened" stroke="#f97316" />
              <Line type="monotone" dataKey="resolved" stroke="#16a34a" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Response and resolution time by team (hours)">
          <ResponsiveContainer>
            <BarChart data={d.times}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="team" /><YAxis /><Tooltip /><Legend />
              <Bar dataKey="response_h" name="First response" fill="#2563eb" />
              <Bar dataKey="resolution_h" name="Resolution" fill="#9333ea" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Recurring issues by category">{hbar(d.recurring, "#f97316")}</Card>
        <Card title="Recurring infrastructure alerts">{hbar(d.recurringAlerts, "#dc2626")}</Card>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Infrastructure (latest reading per host)</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {d.hosts.map((h: any) => (
            <div key={h.host} className="border rounded-xl p-4 text-sm">
              <p className="font-semibold">{h.host}</p>
              <p className={hot(h.cpu)}>CPU: {h.cpu}%</p>
              <p className={hot(h.memory)}>Memory: {h.memory}%</p>
              <p className={hot(h.disk)}>Disk: {h.disk}%</p>
              <p className="text-xs text-gray-500">{new Date(h.created_at).toLocaleTimeString()}</p>
            </div>
          ))}
          {d.hosts.length === 0 && <p className="text-sm text-gray-500">No agents reporting yet.</p>}
        </div>
        {openAlerts.map(a => (
          <p key={a.id} className="text-sm border border-red-400 rounded p-2">
            {a.host} · {a.metric} · value {a.value} → ticket #{a.ticket_id}
          </p>
        ))}
      </section>
    </main>
  );
}