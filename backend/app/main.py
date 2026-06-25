import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any, cast

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("MACROLEIA_DB", BASE_DIR / "data" / "macroleia.db"))
STATIC_DIR = BASE_DIR / "frontend" / "static"
SESSION_COOKIE = "macroleia_session"
STORAGE_BACKEND = os.getenv("MACROLEIA_STORAGE", "sqlite").lower()
firestore_client: Any | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="MacroLeia", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordResetRequest(BaseModel):
    username: str
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    new_password: str = Field(min_length=6, max_length=128)


class MacroButtonIn(BaseModel):
    label: str = Field(default="", max_length=60)
    message: str = Field(default="", max_length=5000)


class MacroIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    buttons: list[MacroButtonIn] = Field(default_factory=list, max_length=30)


class ReorderRequest(BaseModel):
    direction: str = Field(pattern=r"^(up|down)$")


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, digest_hex = stored_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000)
    return hmac.compare_digest(actual, expected)


@contextmanager
def db() -> Any:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    if STORAGE_BACKEND == "firestore":
        get_firestore()
        return

    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS macros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS macro_buttons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                macro_id INTEGER NOT NULL REFERENCES macros(id) ON DELETE CASCADE,
                number INTEGER NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                UNIQUE(macro_id, number)
            );
            """
        )


def get_firestore() -> Any:
    global firestore_client
    if firestore_client is None:
        from google.cloud import firestore

        firestore_client = firestore.Client()
    return firestore_client


def using_firestore() -> bool:
    return STORAGE_BACKEND == "firestore"


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "username": row["username"], "email": row["email"]}


def public_firestore_user(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"id": user_id, "username": data["username"], "email": data["email"]}


def get_current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login necessario")

    if using_firestore():
        client = get_firestore()
        session = client.collection("sessions").document(token).get()
        if not session.exists:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessao invalida")

        session_data = session.to_dict()
        user_id = session_data["user_id"]
        user = client.collection("users").document(user_id).get()
        if not user.exists:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessao invalida")
        return public_firestore_user(user_id, user.to_dict())

    with db() as connection:
        row = connection.execute(
            """
            SELECT users.id, users.username, users.email
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessao invalida")
    return public_user(row)


def macro_to_dict(connection: sqlite3.Connection, macro: sqlite3.Row) -> dict[str, Any]:
    buttons = connection.execute(
        """
        SELECT number, label, message
        FROM macro_buttons
        WHERE macro_id = ?
        ORDER BY number
        """,
        (macro["id"],),
    ).fetchall()
    return {
        "id": macro["id"],
        "name": macro["name"],
        "position": macro["position"],
        "buttons": [dict(button) for button in buttons],
    }


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, response: Response) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    if using_firestore():
        client = get_firestore()
        user_ref = client.collection("users").document(payload.username)
        if user_ref.get().exists:
            raise HTTPException(status_code=409, detail="Usuario ja existe")

        user_data = {
            "username": payload.username,
            "email": payload.email,
            "password_hash": hash_password(payload.password),
        }
        user_ref.set(user_data)
        client.collection("sessions").document(token).set({"user_id": payload.username})
        response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
        return {"user": public_firestore_user(payload.username, user_data)}

    with db() as connection:
        try:
            cursor = connection.execute(
                "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                (payload.username, payload.email, hash_password(payload.password)),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Usuario ja existe") from exc
        user_id = cursor.lastrowid
        connection.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        user = connection.execute(
            "SELECT id, username, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
    return {"user": public_user(user)}


@app.post("/api/auth/login")
def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    if using_firestore():
        client = get_firestore()
        user = client.collection("users").document(payload.username).get()
        if not user.exists:
            raise HTTPException(status_code=401, detail="Usuario ou senha invalidos")

        user_data = user.to_dict()
        if not verify_password(payload.password, user_data["password_hash"]):
            raise HTTPException(status_code=401, detail="Usuario ou senha invalidos")

        token = secrets.token_urlsafe(32)
        client.collection("sessions").document(token).set({"user_id": payload.username})
        response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
        return {"user": public_firestore_user(payload.username, user_data)}

    with db() as connection:
        row = connection.execute(
            "SELECT id, username, email, password_hash FROM users WHERE username = ?",
            (payload.username,),
        ).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Usuario ou senha invalidos")

        token = secrets.token_urlsafe(32)
        connection.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, row["id"]))

    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
    return {"user": public_user(row)}


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        if using_firestore():
            get_firestore().collection("sessions").document(token).delete()
            response.delete_cookie(SESSION_COOKIE)
            return

        with db() as connection:
            connection.execute("DELETE FROM sessions WHERE token = ?", (token,))
    response.delete_cookie(SESSION_COOKIE)


@app.post("/api/auth/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: PasswordResetRequest) -> None:
    if using_firestore():
        client = get_firestore()
        user_ref = client.collection("users").document(payload.username)
        user = user_ref.get()
        if not user.exists:
            raise HTTPException(status_code=404, detail="Usuario e email nao conferem")

        user_data = user.to_dict()
        if user_data["email"].lower() != payload.email.lower():
            raise HTTPException(status_code=404, detail="Usuario e email nao conferem")

        user_ref.update({"password_hash": hash_password(payload.new_password)})
        sessions = client.collection("sessions").where("user_id", "==", payload.username).stream()
        for session in sessions:
            session.reference.delete()
        return

    with db() as connection:
        user = connection.execute(
            "SELECT id FROM users WHERE username = ? AND lower(email) = lower(?)",
            (payload.username, payload.email),
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Usuario e email nao conferem")

        connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(payload.new_password), user["id"]),
        )
        connection.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))


@app.get("/api/me")
def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": user}


@app.get("/api/macros")
def list_macros(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if using_firestore():
        return {"macros": list_firestore_macros(user["id"])}

    with db() as connection:
        macros = connection.execute(
            "SELECT id, name, position FROM macros WHERE user_id = ? ORDER BY position, id",
            (user["id"],),
        ).fetchall()
        return {"macros": [macro_to_dict(connection, macro) for macro in macros]}


@app.post("/api/macros", status_code=status.HTTP_201_CREATED)
def create_macro(payload: MacroIn, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if using_firestore():
        client = get_firestore()
        macros = list_firestore_macros(user["id"])
        macro_id = secrets.token_urlsafe(12)
        macro = {
            "id": macro_id,
            "user_id": user["id"],
            "name": payload.name,
            "position": max([item["position"] for item in macros], default=0) + 1,
            "buttons": normalize_buttons(payload.buttons),
        }
        client.collection("macros").document(macro_id).set(macro)
        return {"macro": public_firestore_macro(macro)}

    with db() as connection:
        next_position = connection.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM macros WHERE user_id = ?",
            (user["id"],),
        ).fetchone()["position"]
        cursor = connection.execute(
            "INSERT INTO macros (user_id, name, position) VALUES (?, ?, ?)",
            (user["id"], payload.name, next_position),
        )
        macro_id = cursor.lastrowid
        save_buttons(connection, macro_id, payload.buttons)
        macro = connection.execute("SELECT id, name, position FROM macros WHERE id = ?", (macro_id,)).fetchone()
        return {"macro": macro_to_dict(connection, macro)}


@app.get("/api/macros/{macro_id}")
def get_macro(macro_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if using_firestore():
        return {"macro": public_firestore_macro(find_firestore_macro(str(macro_id), user["id"]))}

    with db() as connection:
        macro = find_macro(connection, macro_id, user["id"])
        return {"macro": macro_to_dict(connection, macro)}


@app.put("/api/macros/{macro_id}")
def update_macro(macro_id: str, payload: MacroIn, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if using_firestore():
        macro = find_firestore_macro(str(macro_id), user["id"])
        macro.update({"name": payload.name, "buttons": normalize_buttons(payload.buttons)})
        get_firestore().collection("macros").document(str(macro_id)).set(macro)
        return {"macro": public_firestore_macro(macro)}

    with db() as connection:
        find_macro(connection, macro_id, user["id"])
        connection.execute(
            "UPDATE macros SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (payload.name, macro_id),
        )
        connection.execute("DELETE FROM macro_buttons WHERE macro_id = ?", (macro_id,))
        save_buttons(connection, macro_id, payload.buttons)
        macro = connection.execute("SELECT id, name, position FROM macros WHERE id = ?", (macro_id,)).fetchone()
        return {"macro": macro_to_dict(connection, macro)}


@app.delete("/api/macros/{macro_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_macro(macro_id: str, user: dict[str, Any] = Depends(get_current_user)) -> None:
    if using_firestore():
        macro = find_firestore_macro(str(macro_id), user["id"])
        client = get_firestore()
        client.collection("macros").document(str(macro_id)).delete()
        for item in list_firestore_macros(user["id"]):
            if item["position"] > macro["position"]:
                client.collection("macros").document(str(item["id"])).update({"position": item["position"] - 1})
        return

    with db() as connection:
        macro = find_macro(connection, macro_id, user["id"])
        connection.execute("DELETE FROM macros WHERE id = ?", (macro_id,))
        connection.execute(
            "UPDATE macros SET position = position - 1 WHERE user_id = ? AND position > ?",
            (user["id"], macro["position"]),
        )


@app.post("/api/macros/{macro_id}/reorder")
def reorder_macro(
    macro_id: str,
    payload: ReorderRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if using_firestore():
        client = get_firestore()
        macro = find_firestore_macro(str(macro_id), user["id"])
        target_position = macro["position"] - 1 if payload.direction == "up" else macro["position"] + 1
        target = next((item for item in list_firestore_macros(user["id"]) if item["position"] == target_position), None)
        if not target:
            return {"macros": list_firestore_macros(user["id"])}

        client.collection("macros").document(str(target["id"])).update({"position": macro["position"]})
        client.collection("macros").document(str(macro["id"])).update({"position": target_position})
        return {"macros": list_firestore_macros(user["id"])}

    with db() as connection:
        macro = find_macro(connection, macro_id, user["id"])
        target_position = macro["position"] - 1 if payload.direction == "up" else macro["position"] + 1
        target = connection.execute(
            "SELECT id, position FROM macros WHERE user_id = ? AND position = ?",
            (user["id"], target_position),
        ).fetchone()
        if not target:
            return list_macros(user)

        connection.execute("UPDATE macros SET position = ? WHERE id = ?", (macro["position"], target["id"]))
        connection.execute("UPDATE macros SET position = ? WHERE id = ?", (target_position, macro_id))
        macros = connection.execute(
            "SELECT id, name, position FROM macros WHERE user_id = ? ORDER BY position, id",
            (user["id"],),
        ).fetchall()
        return {"macros": [macro_to_dict(connection, item) for item in macros]}


def find_macro(connection: sqlite3.Connection, macro_id: str, user_id: int) -> sqlite3.Row:
    macro = connection.execute(
        "SELECT id, name, position FROM macros WHERE id = ? AND user_id = ?",
        (macro_id, user_id),
    ).fetchone()
    if not macro:
        raise HTTPException(status_code=404, detail="Macro nao encontrada")
    return macro


def save_buttons(connection: sqlite3.Connection, macro_id: int, buttons: list[MacroButtonIn]) -> None:
    for button in normalize_buttons(buttons):
        connection.execute(
            "INSERT INTO macro_buttons (macro_id, number, label, message) VALUES (?, ?, ?, ?)",
            (macro_id, button["number"], button["label"], button["message"]),
        )


def normalize_buttons(buttons: list[MacroButtonIn]) -> list[dict[str, Any]]:
    normalized = buttons or [MacroButtonIn(label="", message="") for _ in range(6)]
    return [
        {
            "number": index,
            "label": button.label.strip() or str(index),
            "message": button.message,
        }
        for index, button in enumerate(normalized, start=1)
    ]


def public_firestore_macro(macro: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": macro["id"],
        "name": macro["name"],
        "position": macro["position"],
        "buttons": sorted(macro.get("buttons", []), key=lambda item: item["number"]),
    }


def list_firestore_macros(user_id: str) -> list[dict[str, Any]]:
    docs = get_firestore().collection("macros").where("user_id", "==", user_id).stream()
    macros = [public_firestore_macro(cast(dict[str, Any], doc.to_dict())) for doc in docs]
    return sorted(macros, key=lambda item: (item["position"], item["id"]))


def find_firestore_macro(macro_id: str, user_id: str) -> dict[str, Any]:
    macro = get_firestore().collection("macros").document(macro_id).get()
    if not macro.exists:
        raise HTTPException(status_code=404, detail="Macro nao encontrada")

    data = cast(dict[str, Any], macro.to_dict())
    if data["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Macro nao encontrada")
    return data


app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    file_path = STATIC_DIR / path
    if path and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(STATIC_DIR / "index.html")
