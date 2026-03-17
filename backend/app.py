from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
import datetime

load_dotenv()

app = Flask(__name__)
CORS(app, origins="*")


# ── In-memory store (replace with DB in production) ──
tasks = [
    {"id": 1, "title": "Set up Flask backend",   "done": True,  "priority": "high"},
    {"id": 2, "title": "Build React frontend",    "done": True,  "priority": "high"},
    {"id": 3, "title": "Connect API to React",    "done": False, "priority": "medium"},
    {"id": 4, "title": "Deploy to ECS Fargate",   "done": False, "priority": "low"},
]
next_id = 5

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "version": "1.0.0"
    })

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    priority = request.args.get("priority")
    filtered = tasks if not priority else [t for t in tasks if t["priority"] == priority]
    return jsonify({"tasks": filtered, "total": len(filtered)})

@app.route("/api/tasks/<int:task_id>", methods=["GET"])
def get_task(task_id):
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task)

@app.route("/api/tasks", methods=["POST"])
def create_task():
    global next_id
    data = request.get_json()
    if not data or not data.get("title", "").strip():
        return jsonify({"error": "Title is required"}), 400
    task = {
        "id":       next_id,
        "title":    data["title"].strip(),
        "done":     False,
        "priority": data.get("priority", "medium")
    }
    tasks.append(task)
    next_id += 1
    return jsonify(task), 201

@app.route("/api/tasks/<int:task_id>/toggle", methods=["PATCH"])
def toggle_task(task_id):
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    task["done"] = not task["done"]
    return jsonify(task)

@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    global tasks
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    tasks = [t for t in tasks if t["id"] != task_id]
    return jsonify({"message": "Deleted", "id": task_id})

@app.route("/api/stats", methods=["GET"])
def get_stats():
    return jsonify({
        "total":    len(tasks),
        "done":     sum(1 for t in tasks if t["done"]),
        "pending":  sum(1 for t in tasks if not t["done"]),
        "by_priority": {
            "high":   sum(1 for t in tasks if t["priority"] == "high"),
            "medium": sum(1 for t in tasks if t["priority"] == "medium"),
            "low":    sum(1 for t in tasks if t["priority"] == "low"),
        }
    })

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", debug=False, port=port)
