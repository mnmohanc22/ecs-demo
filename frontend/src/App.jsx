import { useState, useEffect, useCallback } from "react"


const API = (window.ENV?.API_URL || "http://localhost:5000") + "/api"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOGGER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const LOG_LEVEL = window.ENV?.LOG_LEVEL || "INFO"

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

const STYLES = {
  DEBUG: "color:#888;font-weight:normal",
  INFO:  "color:#1D9E75;font-weight:bold",
  WARN:  "color:#BA7517;font-weight:bold",
  ERROR: "color:#993C1D;font-weight:bold",
}

function createLogger(module) {
  function log(level, message, extra = {}) {
    if (LEVELS[level] < LEVELS[LOG_LEVEL]) return

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...extra,
    }

    const prefix = `%c[${level}] [${module}]`
    const style  = STYLES[level]

    switch (level) {
      case "ERROR": console.error(prefix, style, message, extra); break
      case "WARN":  console.warn(prefix,  style, message, extra); break
      case "DEBUG": console.debug(prefix, style, message, extra); break
      default:      console.log(prefix,   style, message, extra)
    }

    // Also push to in-memory log store for the log panel
    logStore.push(entry)
    if (logStore.length > 200) logStore.shift()
    logStore.listeners.forEach(fn => fn([...logStore]))
  }

  return {
    debug: (msg, extra) => log("DEBUG", msg, extra),
    info:  (msg, extra) => log("INFO",  msg, extra),
    warn:  (msg, extra) => log("WARN",  msg, extra),
    error: (msg, extra) => log("ERROR", msg, extra),
  }
}

// ── In-memory log store with subscriber pattern ────────
const logStore = []
logStore.listeners = new Set()
logStore.subscribe   = fn => { logStore.listeners.add(fn);    return () => logStore.listeners.delete(fn) }

const appLog = createLogger("App")

appLog.info("Frontend initialised", {
  api_url:   API,
  log_level: LOG_LEVEL,
  user_agent: navigator.userAgent.slice(0, 80),
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API HELPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fetchLog = createLogger("API")

async function apiFetch(path, options = {}) {
  const method     = options.method || "GET"
  const requestId  = Math.random().toString(36).slice(2, 8)
  const startTime  = performance.now()
  const url        = `${API}${path}`

  fetchLog.info("Request started", { request_id: requestId, method, url })

  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
      ...options,
    })

    const durationMs = Math.round(performance.now() - startTime)
    const data       = await res.json()

    if (!res.ok) {
      fetchLog.warn("Request failed", {
        request_id:  requestId,
        method,
        url,
        status:      res.status,
        duration_ms: durationMs,
        error:       data.error,
      })
      throw new Error(data.error || `HTTP ${res.status}`)
    }

    fetchLog.info("Request succeeded", {
      request_id:  requestId,
      method,
      url,
      status:      res.status,
      duration_ms: durationMs,
    })

    return data

  } catch (e) {
    const durationMs = Math.round(performance.now() - startTime)
    fetchLog.error("Request error", {
      request_id:  requestId,
      method,
      url,
      duration_ms: durationMs,
      error:       e.message,
    })
    throw e
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI COMPONENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function StatusBadge({ status }) {
  const map = {
    connected:         { bg: "#EAF3DE", color: "#3B6D11", label: "Connected" },
    ok:                { bg: "#EAF3DE", color: "#3B6D11", label: "OK" },
    error:             { bg: "#FAECE7", color: "#993C1D", label: "Error" },
    connection_failed: { bg: "#FAECE7", color: "#993C1D", label: "Failed" },
    loading:           { bg: "#FAEEDA", color: "#854F0B", label: "Loading..." },
    idle:              { bg: "#f0f0f0", color: "#888",    label: "Idle" },
  }
  const s = map[status] || map.idle
  return (
    <span style={{
      fontSize: 11, padding: "2px 8px", borderRadius: 99,
      fontWeight: 500, background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  )
}

function Card({ title, children, action }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, marginBottom: "1.5rem", overflow: "hidden" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px", background: "#fafafa", borderBottom: "1px solid #eee",
      }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "1rem" }}>{children}</div>
    </div>
  )
}

function KV({ label, value, mono }) {
  return (
    <div style={{
      display: "flex", gap: 8, padding: "5px 0",
      borderBottom: "1px solid #f5f5f5", fontSize: 13,
    }}>
      <span style={{ color: "#888", minWidth: 160, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{value ?? "—"}</span>
    </div>
  )
}

function Btn({ onClick, disabled, children, variant = "default" }) {
  const styles = {
    default: { background: "#fff", color: "#333", border: "1px solid #ddd" },
    primary: { background: "#111", color: "#fff", border: "1px solid #111" },
    danger:  { background: "#fff", color: "#c00", border: "1px solid #fcc" },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "5px 12px", borderRadius: 7, fontSize: 13,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      ...styles[variant],
    }}>
      {children}
    </button>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TASK SECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const taskLog = createLogger("Tasks")

function TaskSection() {
  const [tasks,    setTasks]    = useState([])
  const [stats,    setStats]    = useState({})
  const [input,    setInput]    = useState("")
  const [priority, setPriority] = useState("medium")
  const [filter,   setFilter]   = useState("all")
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    taskLog.info("TaskSection mounted")
    fetchTasks()
    fetchStats()
    return () => taskLog.debug("TaskSection unmounted")
  }, [])

  async function fetchTasks() {
    taskLog.info("Fetching tasks")
    try {
      const d = await apiFetch("/api/tasks")
      setTasks(d.tasks)
      setError(null)
      taskLog.info("Tasks loaded", { count: d.tasks.length, total: d.total })
    } catch (e) {
      taskLog.error("Failed to fetch tasks", { error: e.message })
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchStats() {
    taskLog.debug("Fetching stats")
    try {
      const d = await apiFetch("/api/stats")
      setStats(d)
      taskLog.debug("Stats loaded", { total: d.total, done: d.done, pending: d.pending })
    } catch (e) {
      taskLog.warn("Failed to fetch stats", { error: e.message })
    }
  }

  async function addTask() {
    if (!input.trim()) {
      taskLog.warn("Add task skipped — empty input")
      return
    }
    taskLog.info("Adding task", { title: input, priority })
    try {
      const task = await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: input, priority }),
      })
      setTasks(p => [...p, task])
      setStats(p => ({ ...p, total: (p.total||0)+1, pending: (p.pending||0)+1 }))
      setInput("")
      taskLog.info("Task added", { task_id: task.id, title: task.title, priority: task.priority })
    } catch (e) {
      taskLog.error("Failed to add task", { error: e.message })
      setError(e.message)
    }
  }

  async function toggleTask(id) {
    const task = tasks.find(t => t.id === id)
    taskLog.info("Toggling task", { task_id: id, current_done: task?.done })
    try {
      const updated = await apiFetch(`/api/tasks/${id}/toggle`, { method: "PATCH" })
      setTasks(p => p.map(t => t.id === id ? updated : t))
      fetchStats()
      taskLog.info("Task toggled", { task_id: id, done: updated.done })
    } catch (e) {
      taskLog.error("Failed to toggle task", { task_id: id, error: e.message })
    }
  }

  async function deleteTask(id) {
    taskLog.info("Deleting task", { task_id: id })
    try {
      await apiFetch(`/api/tasks/${id}`, { method: "DELETE" })
      setTasks(p => p.filter(t => t.id !== id))
      fetchStats()
      taskLog.info("Task deleted", { task_id: id })
    } catch (e) {
      taskLog.error("Failed to delete task", { task_id: id, error: e.message })
    }
  }

  function setFilterWithLog(f) {
    taskLog.debug("Filter changed", { from: filter, to: f })
    setFilter(f)
  }

  const filtered = tasks.filter(t => {
    if (filter === "pending") return !t.done
    if (filter === "done")    return t.done
    if (filter === "high")    return t.priority === "high"
    return true
  })

  const PC = {
    high:   { bg: "#FAECE7", color: "#993C1D" },
    medium: { bg: "#FAEEDA", color: "#854F0B" },
    low:    { bg: "#EAF3DE", color: "#3B6D11" },
  }

  return (
    <Card title={`Tasks (${stats.total ?? 0})`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: "1rem" }}>
        {[
          { label: "Total",     value: stats.total,   color: "#111" },
          { label: "Completed", value: stats.done,    color: "#1D9E75" },
          { label: "Pending",   value: stats.pending, color: "#BA7517" },
        ].map(s => (
          <div key={s.label} style={{ background: "#f7f7f7", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "#999" }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>{s.value ?? "—"}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: "0.75rem" }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="Add a task..."
          style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid #ddd", fontSize: 13 }}
        />
        <select value={priority} onChange={e => { taskLog.debug("Priority changed", { priority: e.target.value }); setPriority(e.target.value) }}
          style={{ padding: "0 8px", borderRadius: 7, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <Btn onClick={addTask} variant="primary">+ Add</Btn>
      </div>

      <div style={{ display: "flex", gap: 5, marginBottom: "0.75rem" }}>
        {["all","pending","done","high"].map(f => (
          <button key={f} onClick={() => setFilterWithLog(f)} style={{
            padding: "3px 10px", borderRadius: 99, fontSize: 12,
            border: "1px solid #ddd", cursor: "pointer",
            background: filter === f ? "#111" : "transparent",
            color: filter === f ? "#fff" : "#555",
          }}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>
        ))}
      </div>

      {error && (
        <div style={{ background: "#FAECE7", color: "#993C1D", padding: "8px 12px", borderRadius: 7, fontSize: 13, marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}

      {loading
        ? <p style={{ color: "#aaa", fontSize: 13 }}>Loading...</p>
        : filtered.length === 0
          ? <p style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: "1rem" }}>No tasks found</p>
          : filtered.map(task => (
            <div key={task.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", border: "1px solid #f0f0f0",
              borderRadius: 7, marginBottom: 5,
            }}>
              <div onClick={() => toggleTask(task.id)} style={{
                width: 16, height: 16, borderRadius: 3, cursor: "pointer", flexShrink: 0,
                border: task.done ? "none" : "1.5px solid #ccc",
                background: task.done ? "#1D9E75" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {task.done && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
              </div>
              <span style={{ flex: 1, fontSize: 13, textDecoration: task.done ? "line-through" : "none", color: task.done ? "#aaa" : "#111" }}>
                {task.title}
              </span>
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, ...PC[task.priority] }}>{task.priority}</span>
              <button onClick={() => deleteTask(task.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ccc", fontSize: 16 }}>×</button>
            </div>
          ))
      }
    </Card>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DB SECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const dbLog = createLogger("DB")

function DBSection() {
  const [pingResult,    setPingResult]    = useState(null)
  const [healthResult,  setHealthResult]  = useState(null)
  const [pingStatus,    setPingStatus]    = useState("idle")
  const [healthStatus,  setHealthStatus]  = useState("idle")
  const [pingLoading,   setPingLoading]   = useState(false)
  const [healthLoading, setHealthLoading] = useState(false)

  useEffect(() => {
    dbLog.info("DBSection mounted")
    return () => dbLog.debug("DBSection unmounted")
  }, [])

  async function runPing() {
    dbLog.info("DB ping initiated")
    setPingLoading(true); setPingStatus("loading"); setPingResult(null)
    const start = performance.now()
    try {
      const d = await apiFetch("/api/db/ping")
      setPingResult(d); setPingStatus("ok")
      dbLog.info("DB ping succeeded", {
        latency_ms:  d.latency_ms,
        host:        d.host,
        duration_ms: Math.round(performance.now() - start),
      })
    } catch (e) {
      setPingResult({ error: e.message }); setPingStatus("error")
      dbLog.error("DB ping failed", {
        error:       e.message,
        duration_ms: Math.round(performance.now() - start),
      })
    } finally { setPingLoading(false) }
  }

  async function runHealth() {
    dbLog.info("DB health check initiated")
    setHealthLoading(true); setHealthStatus("loading"); setHealthResult(null)
    const start = performance.now()
    try {
      const d = await apiFetch("/api/db/health")
      setHealthResult(d); setHealthStatus("connected")
      dbLog.info("DB health check succeeded", {
        host:               d.host,
        database:           d.database,
        connected_as:       d.connected_as,
        active_connections: d.active_connections,
        elapsed_ms:         d.elapsed_ms,
        secret_source:      d.secret_source,
        duration_ms:        Math.round(performance.now() - start),
      })
    } catch (e) {
      setHealthResult({ error: e.message }); setHealthStatus("error")
      dbLog.error("DB health check failed", {
        error:       e.message,
        duration_ms: Math.round(performance.now() - start),
      })
    } finally { setHealthLoading(false) }
  }

  return (
    <Card title="RDS PostgreSQL">
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>DB Ping</span>
          <StatusBadge status={pingStatus} />
          <div style={{ marginLeft: "auto" }}>
            <Btn onClick={runPing} disabled={pingLoading}>{pingLoading ? "Pinging..." : "Run Ping"}</Btn>
          </div>
        </div>
        {pingResult && (
          <div style={{ background: "#f9f9f9", borderRadius: 7, padding: "0.75rem" }}>
            {pingResult.error
              ? <KV label="Error" value={pingResult.error} />
              : <>
                  <KV label="Status"    value={pingResult.status} />
                  <KV label="Latency"   value={`${pingResult.latency_ms} ms`} />
                  <KV label="Host"      value={pingResult.host} mono />
                  <KV label="Timestamp" value={pingResult.timestamp} />
                </>
            }
          </div>
        )}
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Full Health Check</span>
          <StatusBadge status={healthStatus} />
          <div style={{ marginLeft: "auto" }}>
            <Btn onClick={runHealth} disabled={healthLoading}>{healthLoading ? "Checking..." : "Run Health Check"}</Btn>
          </div>
        </div>
        {healthResult && (
          <div style={{ background: "#f9f9f9", borderRadius: 7, padding: "0.75rem" }}>
            {healthResult.error
              ? <><KV label="Error" value={healthResult.error} />{healthResult.hint && <KV label="Hint" value={healthResult.hint} />}</>
              : <>
                  <KV label="Status"             value={healthResult.status} />
                  <KV label="Host"               value={healthResult.host} mono />
                  <KV label="Database"           value={healthResult.database} />
                  <KV label="Connected as"       value={healthResult.connected_as} />
                  <KV label="Server IP"          value={healthResult.server_ip} mono />
                  <KV label="Active connections" value={healthResult.active_connections} />
                  <KV label="SSL mode"           value={healthResult.sslmode} />
                  <KV label="Secret source"      value={healthResult.secret_source} />
                  <KV label="DB version"         value={healthResult.db_version} />
                  <KV label="DB time"            value={healthResult.db_time} />
                  <KV label="Elapsed"            value={`${healthResult.elapsed_ms} ms`} />
                </>
            }
          </div>
        )}
      </div>
    </Card>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// S3 SECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const s3Log = createLogger("S3")

function S3Section() {
  const [buckets,        setBuckets]        = useState([])
  const [bucketsStatus,  setBucketsStatus]  = useState("idle")
  const [bucketsLoading, setBucketsLoading] = useState(false)
  const [selectedBucket, setSelectedBucket] = useState("")
  const [bucketInfo,     setBucketInfo]     = useState(null)
  const [infoStatus,     setInfoStatus]     = useState("idle")
  const [infoLoading,    setInfoLoading]    = useState(false)
  const [objects,        setObjects]        = useState([])
  const [objectsStatus,  setObjectsStatus]  = useState("idle")
  const [objectsLoading, setObjectsLoading] = useState(false)
  const [prefix,         setPrefix]         = useState("")
  const [maxKeys,        setMaxKeys]        = useState("20")
  const [nextToken,      setNextToken]      = useState("")
  const [isTruncated,    setIsTruncated]    = useState(false)
  const [searchQuery,    setSearchQuery]    = useState("")
  const [searchResults,  setSearchResults]  = useState(null)
  const [searchStatus,   setSearchStatus]   = useState("idle")
  const [searchLoading,  setSearchLoading]  = useState(false)

  useEffect(() => {
    s3Log.info("S3Section mounted")
    return () => s3Log.debug("S3Section unmounted")
  }, [])

  function selectBucket(name) {
    s3Log.info("Bucket selected", { bucket: name, previous: selectedBucket })
    setSelectedBucket(name)
    setBucketInfo(null)
    setObjects([])
    setSearchResults(null)
    setInfoStatus("idle")
    setObjectsStatus("idle")
    setSearchStatus("idle")
  }

  async function fetchBuckets() {
    s3Log.info("Listing all buckets")
    setBucketsLoading(true); setBucketsStatus("loading"); setBuckets([])
    const start = performance.now()
    try {
      const d = await apiFetch("/api/s3/buckets")
      setBuckets(d.buckets); setBucketsStatus("ok")
      s3Log.info("Buckets listed", {
        count:       d.total,
        elapsed_ms:  d.elapsed_ms,
        duration_ms: Math.round(performance.now() - start),
        buckets:     d.buckets.map(b => b.name),
      })
    } catch (e) {
      setBuckets([{ error: e.message }]); setBucketsStatus("error")
      s3Log.error("Failed to list buckets", { error: e.message })
    } finally { setBucketsLoading(false) }
  }

  async function fetchBucketInfo() {
    if (!selectedBucket) return
    s3Log.info("Fetching bucket info", { bucket: selectedBucket })
    setInfoLoading(true); setInfoStatus("loading"); setBucketInfo(null)
    const start = performance.now()
    try {
      const d = await apiFetch(`/api/s3/buckets/${selectedBucket}`)
      setBucketInfo(d); setInfoStatus("ok")
      s3Log.info("Bucket info retrieved", {
        bucket:               selectedBucket,
        region:               d.region,
        versioning:           d.versioning,
        encryption:           d.encryption,
        public_access_blocked: d.public_access_blocked,
        object_count:         d.object_count_sample,
        total_size:           d.total_size_human_sample,
        elapsed_ms:           d.elapsed_ms,
        duration_ms:          Math.round(performance.now() - start),
      })
    } catch (e) {
      setBucketInfo({ error: e.message }); setInfoStatus("error")
      s3Log.error("Failed to fetch bucket info", { bucket: selectedBucket, error: e.message })
    } finally { setInfoLoading(false) }
  }

  async function fetchObjects(token = "") {
    if (!selectedBucket) return
    s3Log.info("Listing objects", { bucket: selectedBucket, prefix, max_keys: maxKeys, paginating: !!token })
    setObjectsLoading(true); setObjectsStatus("loading")
    if (!token) setObjects([])
    const start = performance.now()
    try {
      let url = `/api/s3/buckets/${selectedBucket}/objects?max_keys=${maxKeys}`
      if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`
      if (token)  url += `&continuation_token=${encodeURIComponent(token)}`
      const d = await apiFetch(url)
      setObjects(p => token ? [...p, ...d.objects] : d.objects)
      setNextToken(d.next_token || "")
      setIsTruncated(d.is_truncated)
      setObjectsStatus("ok")
      s3Log.info("Objects listed", {
        bucket:       selectedBucket,
        prefix,
        key_count:    d.key_count,
        total_size:   d.total_size_human,
        is_truncated: d.is_truncated,
        elapsed_ms:   d.elapsed_ms,
        duration_ms:  Math.round(performance.now() - start),
      })
    } catch (e) {
      setObjects([]); setObjectsStatus("error")
      s3Log.error("Failed to list objects", { bucket: selectedBucket, error: e.message })
    } finally { setObjectsLoading(false) }
  }

  async function runSearch() {
    if (!selectedBucket || !searchQuery.trim()) {
      s3Log.warn("Search skipped", { bucket: selectedBucket, query: searchQuery })
      return
    }
    s3Log.info("Searching objects", { bucket: selectedBucket, query: searchQuery, prefix })
    setSearchLoading(true); setSearchStatus("loading"); setSearchResults(null)
    const start = performance.now()
    try {
      let url = `/api/s3/buckets/${selectedBucket}/search?q=${encodeURIComponent(searchQuery)}`
      if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`
      const d = await apiFetch(url)
      setSearchResults(d); setSearchStatus("ok")
      s3Log.info("Search complete", {
        bucket:      selectedBucket,
        query:       searchQuery,
        match_count: d.match_count,
        scanned:     d.scanned,
        elapsed_ms:  d.elapsed_ms,
        duration_ms: Math.round(performance.now() - start),
      })
    } catch (e) {
      setSearchResults({ error: e.message }); setSearchStatus("error")
      s3Log.error("Search failed", { bucket: selectedBucket, query: searchQuery, error: e.message })
    } finally { setSearchLoading(false) }
  }

  return (
    <Card title="S3 Buckets">
      {/* List buckets */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>All Buckets</span>
          <StatusBadge status={bucketsStatus} />
          <div style={{ marginLeft: "auto" }}>
            <Btn onClick={fetchBuckets} disabled={bucketsLoading}>{bucketsLoading ? "Loading..." : "List Buckets"}</Btn>
          </div>
        </div>
        {buckets.length > 0 && (
          <div style={{ background: "#f9f9f9", borderRadius: 7, overflow: "hidden" }}>
            {buckets.map((b, i) => b.error
              ? <div key={i} style={{ padding: "8px 12px", fontSize: 13, color: "#993C1D" }}>{b.error}</div>
              : (
                <div key={b.name} onClick={() => selectBucket(b.name)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                  cursor: "pointer", borderBottom: i < buckets.length-1 ? "1px solid #eee" : "none",
                  background: selectedBucket === b.name ? "#e8f4fd" : "transparent",
                }}>
                  <span style={{ fontSize: 16 }}>🪣</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{b.name}</span>
                  <span style={{ fontSize: 11, color: "#888" }}>{b.region}</span>
                  <span style={{ fontSize: 11, color: "#aaa" }}>{b.created_at?.slice(0,10)}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Bucket controls */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: "0.75rem" }}>
          <input value={selectedBucket} onChange={e => setSelectedBucket(e.target.value)}
            placeholder="Bucket name (click row above or type)"
            style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid #ddd", fontSize: 13 }}
          />
          <input value={prefix} onChange={e => setPrefix(e.target.value)}
            placeholder="Prefix (optional)"
            style={{ width: 160, padding: "7px 10px", borderRadius: 7, border: "1px solid #ddd", fontSize: 13 }}
          />
          <select value={maxKeys} onChange={e => setMaxKeys(e.target.value)}
            style={{ padding: "0 8px", borderRadius: 7, border: "1px solid #ddd", fontSize: 13 }}>
            {["10","20","50","100"].map(n => <option key={n} value={n}>{n} items</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn onClick={fetchBucketInfo} disabled={!selectedBucket || infoLoading}>{infoLoading ? "Loading..." : "Bucket Info"}</Btn>
          <Btn onClick={() => fetchObjects()} disabled={!selectedBucket || objectsLoading}>{objectsLoading ? "Loading..." : "List Objects"}</Btn>
        </div>
      </div>

      {/* Bucket info */}
      {bucketInfo && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Bucket Info — {selectedBucket}</span>
            <StatusBadge status={infoStatus} />
          </div>
          <div style={{ background: "#f9f9f9", borderRadius: 7, padding: "0.75rem" }}>
            {bucketInfo.error ? <KV label="Error" value={bucketInfo.error} />
              : <>
                  <KV label="Region"                value={bucketInfo.region} />
                  <KV label="Versioning"            value={bucketInfo.versioning} />
                  <KV label="Encryption"            value={bucketInfo.encryption} />
                  <KV label="Public access blocked" value={String(bucketInfo.public_access_blocked)} />
                  <KV label="Object count (sample)" value={bucketInfo.object_count_sample} />
                  <KV label="Total size (sample)"   value={bucketInfo.total_size_human_sample} />
                  <KV label="Note"                  value={bucketInfo.sample_note} />
                  <KV label="Elapsed"               value={`${bucketInfo.elapsed_ms} ms`} />
                </>
            }
          </div>
        </div>
      )}

      {/* Object list */}
      {objects.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Objects — {selectedBucket}</span>
            <StatusBadge status={objectsStatus} />
            <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>{objects.length} shown</span>
          </div>
          <div style={{ background: "#f9f9f9", borderRadius: 7, overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
            {objects.map((obj, i) => (
              <div key={obj.key} style={{
                display: "flex", gap: 10, alignItems: "center",
                padding: "7px 12px", fontSize: 12,
                borderBottom: i < objects.length-1 ? "1px solid #eee" : "none",
              }}>
                <span style={{ flex: 1, fontFamily: "monospace", wordBreak: "break-all", color: "#333" }}>{obj.key}</span>
                <span style={{ color: "#888", flexShrink: 0 }}>{obj.size_human}</span>
                <span style={{ color: "#bbb", flexShrink: 0 }}>{obj.last_modified?.slice(0,10)}</span>
              </div>
            ))}
          </div>
          {isTruncated && (
            <div style={{ marginTop: "0.5rem" }}>
              <Btn onClick={() => fetchObjects(nextToken)} disabled={objectsLoading}>{objectsLoading ? "Loading..." : "Load more"}</Btn>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: "0.5rem" }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && runSearch()}
            placeholder="Search objects by key name..."
            style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid #ddd", fontSize: 13 }}
          />
          <Btn onClick={runSearch} disabled={!selectedBucket || !searchQuery.trim() || searchLoading}>
            {searchLoading ? "Searching..." : "Search"}
          </Btn>
        </div>
        {searchResults && (
          <div style={{ background: "#f9f9f9", borderRadius: 7, overflow: "hidden" }}>
            {searchResults.error
              ? <div style={{ padding: "8px 12px", fontSize: 13, color: "#993C1D" }}>{searchResults.error}</div>
              : <>
                  <div style={{ padding: "7px 12px", fontSize: 12, color: "#888", borderBottom: "1px solid #eee" }}>
                    {searchResults.match_count} matches · {searchResults.scanned} scanned · {searchResults.elapsed_ms}ms
                  </div>
                  {searchResults.matches?.length === 0
                    ? <div style={{ padding: "8px 12px", fontSize: 13, color: "#aaa" }}>No matches found</div>
                    : searchResults.matches?.map((obj, i) => (
                        <div key={obj.key} style={{
                          display: "flex", gap: 10, padding: "7px 12px", fontSize: 12,
                          borderBottom: i < searchResults.matches.length-1 ? "1px solid #eee" : "none",
                        }}>
                          <span style={{ flex: 1, fontFamily: "monospace", wordBreak: "break-all" }}>{obj.key}</span>
                          <span style={{ color: "#888" }}>{obj.size_human}</span>
                        </div>
                      ))
                  }
                </>
            }
          </div>
        )}
      </div>
    </Card>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOG PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const panelLog = createLogger("LogPanel")

function LogPanel() {
  const [entries,    setEntries]    = useState([...logStore])
  const [levelFilter,setLevelFilter]= useState("ALL")
  const [open,       setOpen]       = useState(false)

  useEffect(() => {
    return logStore.subscribe(setEntries)
  }, [])

  function togglePanel() {
    const next = !open
    panelLog.debug("Log panel toggled", { open: next })
    setOpen(next)
  }

  function clearLogs() {
    panelLog.info("Logs cleared by user")
    logStore.length = 0
    setEntries([])
  }

  const filtered = levelFilter === "ALL"
    ? entries
    : entries.filter(e => e.level === levelFilter)

  const LEVEL_COLOR = {
    DEBUG: "#888", INFO: "#1D9E75", WARN: "#BA7517", ERROR: "#993C1D",
  }

  const counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 }
  entries.forEach(e => { if (counts[e.level] !== undefined) counts[e.level]++ })

  return (
    <div style={{ marginTop: "1.5rem", border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px", background: "#fafafa",
        borderBottom: open ? "1px solid #eee" : "none",
        cursor: "pointer",
      }} onClick={togglePanel}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>Frontend Logs</span>
        <span style={{ fontSize: 11, color: "#888" }}>{entries.length} entries</span>

        {/* Level counts */}
        <div style={{ display: "flex", gap: 5, marginLeft: 4 }}>
          {Object.entries(counts).map(([lvl, cnt]) => cnt > 0 && (
            <span key={lvl} style={{
              fontSize: 10, padding: "1px 6px", borderRadius: 99,
              background: lvl === "ERROR" ? "#FAECE7" : lvl === "WARN" ? "#FAEEDA" : "#f0f0f0",
              color: LEVEL_COLOR[lvl], fontWeight: 600,
            }}>
              {lvl} {cnt}
            </span>
          ))}
        </div>

        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>{open ? "▲ Hide" : "▼ Show"}</span>
      </div>

      {open && (
        <>
          {/* Controls */}
          <div style={{
            display: "flex", gap: 6, alignItems: "center",
            padding: "8px 12px", borderBottom: "1px solid #eee", background: "#fafafa",
          }}>
            <span style={{ fontSize: 12, color: "#888" }}>Filter:</span>
            {["ALL","DEBUG","INFO","WARN","ERROR"].map(lvl => (
              <button key={lvl} onClick={e => { e.stopPropagation(); setLevelFilter(lvl) }} style={{
                padding: "2px 8px", borderRadius: 99, fontSize: 11,
                border: "1px solid #ddd", cursor: "pointer",
                background: levelFilter === lvl ? "#111" : "transparent",
                color: levelFilter === lvl ? "#fff" : LEVEL_COLOR[lvl] || "#555",
              }}>{lvl}</button>
            ))}
            <button onClick={e => { e.stopPropagation(); clearLogs() }} style={{
              marginLeft: "auto", padding: "2px 10px", borderRadius: 7,
              fontSize: 11, border: "1px solid #fcc", background: "#fff",
              color: "#c00", cursor: "pointer",
            }}>Clear</button>
          </div>

          {/* Log entries */}
          <div style={{ maxHeight: 300, overflowY: "auto", background: "#111", padding: "0.5rem 0" }}>
            {filtered.length === 0
              ? <div style={{ padding: "1rem", fontSize: 12, color: "#666", textAlign: "center" }}>No log entries</div>
              : [...filtered].reverse().map((entry, i) => (
                <div key={i} style={{
                  display: "flex", gap: 8, padding: "3px 12px",
                  fontSize: 11, fontFamily: "monospace",
                  borderBottom: "1px solid #1a1a1a",
                }}>
                  <span style={{ color: "#555", flexShrink: 0 }}>{entry.timestamp?.slice(11,23)}</span>
                  <span style={{ color: LEVEL_COLOR[entry.level], flexShrink: 0, minWidth: 40 }}>{entry.level}</span>
                  <span style={{ color: "#888",  flexShrink: 0, minWidth: 70 }}>[{entry.module}]</span>
                  <span style={{ color: "#ddd",  flex: 1 }}>{entry.message}</span>
                  {Object.keys(entry).filter(k => !["timestamp","level","module","message"].includes(k)).length > 0 && (
                    <span style={{ color: "#555", flexShrink: 0, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(entry).filter(([k]) => !["timestamp","level","module","message"].includes(k))
                        )
                      )}
                    </span>
                  )}
                </div>
              ))
            }
          </div>
        </>
      )}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN APP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function App() {
  const [tab, setTab] = useState("tasks")

  useEffect(() => {
    appLog.info("App mounted", { initial_tab: tab })
  }, [])

  function changeTab(t) {
    appLog.info("Tab changed", { from: tab, to: t })
    setTab(t)
  }

  const tabs = [
    { id: "tasks", label: "Tasks" },
    { id: "db",    label: "RDS Database" },
    { id: "s3",    label: "S3 Buckets" },
  ]

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>React + Flask App</h1>
        <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
          Tasks · RDS PostgreSQL · S3 — API: {API}
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", borderBottom: "1px solid #eee", paddingBottom: "0.5rem" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => changeTab(t.id)} style={{
            padding: "6px 16px", borderRadius: 7, fontSize: 13,
            border: "1px solid",
            borderColor: tab === t.id ? "#111" : "#ddd",
            background:  tab === t.id ? "#111" : "transparent",
            color:       tab === t.id ? "#fff" : "#555",
            cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === "tasks" && <TaskSection />}
      {tab === "db"    && <DBSection />}
      {tab === "s3"    && <S3Section />}

      <LogPanel />

      <div style={{ marginTop: "1rem", fontSize: 11, color: "#ccc", display: "flex", justifyContent: "space-between" }}>
        <span>React → Nginx → Flask → RDS / S3</span>
        <a href={`${API}/api/health`} target="_blank" rel="noreferrer" style={{ color: "#1D9E75", textDecoration: "none" }}>
          API health ↗
        </a>
      </div>
    </div>
  )
}
