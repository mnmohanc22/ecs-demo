import { useState, useEffect } from "react"

//const API = "/api"
const API = (window.ENV?.API_URL || "http://localhost:5000") + "/api"

export default function App() {
  const [tasks, setTasks]     = useState([])
  const [stats, setStats]     = useState({})
  const [input, setInput]     = useState("")
  const [priority, setPriority] = useState("medium")
  const [filter, setFilter]   = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetchTasks()
    fetchStats()
  }, [])

  async function fetchTasks() {
    try {
      const res = await fetch(`${API}/tasks`)
      const data = await res.json()
      setTasks(data.tasks)
      setError(null)
    } catch (e) {
      setError("Cannot reach backend API")
    } finally {
      setLoading(false)
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(`${API}/stats`)
      setStats(await res.json())
    } catch {}
  }

  async function addTask() {
    if (!input.trim()) return
    try {
      const res = await fetch(`${API}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: input, priority })
      })
      const task = await res.json()
      setTasks(prev => [...prev, task])
      setStats(prev => ({ ...prev, total: (prev.total||0) + 1, pending: (prev.pending||0) + 1 }))
      setInput("")
    } catch (e) {
      setError("Failed to add task")
    }
  }

  async function toggleTask(id) {
    try {
      const res = await fetch(`${API}/tasks/${id}/toggle`, { method: "PATCH" })
      const updated = await res.json()
      setTasks(prev => prev.map(t => t.id === id ? updated : t))
      fetchStats()
    } catch {}
  }

  async function deleteTask(id) {
    try {
      await fetch(`${API}/tasks/${id}`, { method: "DELETE" })
      setTasks(prev => prev.filter(t => t.id !== id))
      fetchStats()
    } catch {}
  }

  const filtered = tasks.filter(t => {
    if (filter === "pending") return !t.done
    if (filter === "done")    return t.done
    if (filter === "high")    return t.priority === "high"
    return true
  })

  const PRIORITY_COLORS = {
    high:   { bg: "#FAECE7", color: "#993C1D" },
    medium: { bg: "#FAEEDA", color: "#854F0B" },
    low:    { bg: "#EAF3DE", color: "#3B6D11" },
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Task Manager</h1>
        <p style={{ color: "#888", fontSize: 14, marginTop: 4 }}>
          React + Flask + Docker — {stats.total ?? 0} tasks
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: "#FAECE7", color: "#993C1D", padding: "10px 14px", borderRadius: 8, marginBottom: "1rem", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: "1.5rem" }}>
        {[
          { label: "Total",     value: stats.total,   color: "#111" },
          { label: "Completed", value: stats.done,    color: "#1D9E75" },
          { label: "Pending",   value: stats.pending, color: "#BA7517" },
        ].map(s => (
          <div key={s.label} style={{ background: "#f5f5f5", borderRadius: 8, padding: "0.875rem 1rem" }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: s.color }}>{s.value ?? "—"}</div>
          </div>
        ))}
      </div>

      {/* Add task form */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="Add a new task..."
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, outline: "none" }}
        />
        <select
          value={priority}
          onChange={e => setPriority(e.target.value)}
          style={{ padding: "0 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, background: "#fff" }}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button
          onClick={addTask}
          style={{ padding: "0 16px", borderRadius: 8, border: "1px solid #ddd", background: "#111", color: "#fff", fontSize: 13, cursor: "pointer" }}
        >
          + Add
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {["all", "pending", "done", "high"].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "4px 14px", borderRadius: 99, border: "1px solid #ddd",
              background: filter === f ? "#111" : "transparent",
              color: filter === f ? "#fff" : "#555",
              fontSize: 13, cursor: "pointer"
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <p style={{ color: "#aaa", fontSize: 14 }}>Loading tasks...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#aaa", fontSize: 14, textAlign: "center", padding: "2rem" }}>No tasks found</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(task => (
            <div
              key={task.id}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", border: "1px solid #eee",
                borderRadius: 8, background: "#fff"
              }}
            >
              <div
                onClick={() => toggleTask(task.id)}
                style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer",
                  border: task.done ? "none" : "1.5px solid #ccc",
                  background: task.done ? "#1D9E75" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}
              >
                {task.done && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
              </div>
              <span style={{
                flex: 1, fontSize: 14,
                textDecoration: task.done ? "line-through" : "none",
                color: task.done ? "#aaa" : "#111"
              }}>
                {task.title}
              </span>
              <span style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 500,
                background: PRIORITY_COLORS[task.priority].bg,
                color: PRIORITY_COLORS[task.priority].color
              }}>
                {task.priority}
              </span>
              <button
                onClick={() => deleteTask(task.id)}
                style={{ border: "none", background: "none", cursor: "pointer", color: "#bbb", fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: "2.5rem", paddingTop: "1rem", borderTop: "1px solid #eee", fontSize: 12, color: "#aaa", display: "flex", justifyContent: "space-between" }}>
        <span>React frontend → Nginx → Flask backend</span>
        <a href="/api/health" target="_blank" rel="noreferrer" style={{ color: "#1D9E75", textDecoration: "none" }}>
          API health ↗
        </a>
      </div>
    </div>
  )
}
