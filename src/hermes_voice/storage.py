import json
import sqlite3
import time
import uuid


def ident():
    return uuid.uuid4().hex


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT,archived INTEGER DEFAULT 0,created_at REAL,updated_at REAL);
        CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,role TEXT,content TEXT,created_at REAL);
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,brief TEXT,status TEXT,result TEXT,error TEXT,created_at REAL,worker INTEGER);
        CREATE TABLE IF NOT EXISTS contexts(session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,lane TEXT,history TEXT,PRIMARY KEY(session_id,lane));
        PRAGMA user_version=1;
        """)
        self.db.execute(
            "UPDATE tasks SET status='interrupted',error='Server restarted; execution was not replayed.' WHERE status IN ('running','cancelling','pending')"
        )
        self.db.commit()

    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def execute(self, sql, args=()):
        self.db.execute(sql, args)
        self.db.commit()

    def session(self, sid):
        rows = self.rows("SELECT * FROM sessions WHERE id=?", (sid,))
        if not rows:
            return None
        item = rows[0]
        item["archived"] = bool(item["archived"])
        item["busy"] = bool(
            self.rows(
                "SELECT id FROM tasks WHERE session_id=? AND status IN ('running','cancelling')",
                (sid,),
            )
        )
        return item

    def create(self, title):
        sid = ident()
        now = time.time()
        self.execute("INSERT INTO sessions VALUES (?,?,0,?,?)", (sid, title, now, now))
        return self.session(sid)

    def message(self, sid, role, text):
        self.execute(
            "INSERT INTO messages VALUES (?,?,?,?,?)",
            (ident(), sid, role, text, time.time()),
        )
        self.execute("UPDATE sessions SET updated_at=? WHERE id=?", (time.time(), sid))

    def history(self, sid, lane):
        rows = self.rows("SELECT history FROM contexts WHERE session_id=? AND lane=?", (sid, lane))
        return json.loads(rows[0]["history"]) if rows else []

    def save_history(self, sid, lane, history):
        self.execute(
            "INSERT OR REPLACE INTO contexts VALUES (?,?,?)",
            (sid, lane, json.dumps(history)),
        )
