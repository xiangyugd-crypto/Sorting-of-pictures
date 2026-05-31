#!/usr/bin/env python3
import base64
import cgi
import hashlib
import hmac
import io
import json
import os
import secrets
import sqlite3
import time
import uuid
import shutil
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "app.db"
DB_MAX_BYTES = 10 * 1024 * 1024 * 1024
COOKIE_NAME = "poster_session"
BASE_PATH = os.environ.get("APP_BASE_PATH", "").strip().rstrip("/")
if BASE_PATH == "/":
    BASE_PATH = ""
DEFAULT_QUOTA_BYTES = 512 * 1024 * 1024
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_RAW_UPLOAD_BYTES = 60 * 1024 * 1024
COMPRESSED_IMAGE_MAX_BYTES = 500 * 1024
SESSION_TTL = 7 * 24 * 60 * 60


def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA max_page_count = {DB_MAX_BYTES // 4096}")
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with db_connect() as conn:
        conn.execute("PRAGMA page_size = 4096")
        conn.execute(f"PRAGMA max_page_count = {DB_MAX_BYTES // 4096}")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'user',
              quota_bytes INTEGER NOT NULL DEFAULT 536870912,
              used_bytes INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS assets (
              id TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL,
              original_name TEXT NOT NULL,
              path TEXT NOT NULL,
              mime TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.commit()
        ensure_admin(conn)


def ensure_admin(conn):
    admin_name = os.environ.get("ADMIN_USERNAME", "admin")
    admin_password = os.environ.get("ADMIN_PASSWORD", "ChangeMe123!")
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (admin_name,)).fetchone()
    if existing:
        return
    conn.execute(
        """
        INSERT INTO users (username, password_hash, role, quota_bytes, used_bytes, created_at)
        VALUES (?, ?, 'admin', ?, 0, ?)
        """,
        (admin_name, hash_password(admin_password), DB_MAX_BYTES, int(time.time())),
    )
    conn.commit()


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password, stored):
    try:
        method, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    if method != "pbkdf2_sha256":
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180000).hex()
    return hmac.compare_digest(actual, digest)


def secret_key():
    value = os.environ.get("APP_SECRET")
    if value:
        return value.encode("utf-8")
    fallback = DATA_DIR / ".secret"
    if not fallback.exists():
        fallback.write_text(secrets.token_hex(32), encoding="utf-8")
    return fallback.read_text(encoding="utf-8").strip().encode("utf-8")


def sign_payload(payload):
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")
    sig = hmac.new(secret_key(), raw.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def parse_token(token):
    if not token or "." not in token:
        return None
    raw, sig = token.rsplit(".", 1)
    expected = hmac.new(secret_key(), raw.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(raw.encode("ascii")))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload


def public_user(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "quotaBytes": row["quota_bytes"],
        "usedBytes": row["used_bytes"],
        "createdAt": row["created_at"],
    }


def parse_size_to_bytes(value):
    text = str(value).strip().lower()
    if not text:
        raise ValueError("empty size")
    units = [("gb", 1024**3), ("g", 1024**3), ("mb", 1024**2), ("m", 1024**2), ("kb", 1024), ("k", 1024)]
    for suffix, multiplier in units:
        if text.endswith(suffix):
            return int(float(text[: -len(suffix)]) * multiplier)
    return int(float(text) * 1024 * 1024)


def compress_image(content, max_bytes=COMPRESSED_IMAGE_MAX_BYTES):
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise RuntimeError("server_image_compressor_missing") from exc

    with Image.open(io.BytesIO(content)) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")

        width, height = image.size
        for scale_round in range(8):
            working = image if scale_round == 0 else image.resize(
                (
                    max(1, int(width * (0.86**scale_round))),
                    max(1, int(height * (0.86**scale_round))),
                ),
                Image.Resampling.LANCZOS,
            )
            for quality in (84, 78, 72, 66, 60, 54, 48, 42):
                output = io.BytesIO()
                working.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
                data = output.getvalue()
                if len(data) <= max_bytes:
                    return data

        output = io.BytesIO()
        working.save(output, format="JPEG", quality=36, optimize=True, progressive=True)
        data = output.getvalue()
        if len(data) > max_bytes:
            raise ValueError("compressed_image_too_large")
        return data


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "PosterCloud/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):
        route = self.normalized_path()
        if route is None:
            return self.send_json({"error": "not_found"}, 404)
        if route == "/api/session":
            return self.handle_session()
        if route == "/api/admin/users":
            return self.handle_list_users()
        if route == "/api/account/assets":
            return self.handle_list_assets()
        if route.startswith("/api/assets/"):
            return self.handle_asset(route.rsplit("/", 1)[-1])
        if route.startswith("/data/"):
            return self.send_json({"error": "not_found"}, 404)
        self.path = route
        return super().do_GET()

    def do_POST(self):
        route = self.normalized_path()
        if route is None:
            return self.send_json({"error": "not_found"}, 404)
        if route == "/api/login":
            return self.handle_login()
        if route == "/api/logout":
            return self.handle_logout()
        if route == "/api/upload":
            return self.handle_upload()
        if route == "/api/upload-file":
            return self.handle_upload_file()
        if route == "/api/account/password":
            return self.handle_change_password()
        if route == "/api/account/clear-storage":
            return self.handle_clear_storage()
        if route == "/api/account/assets/delete":
            return self.handle_delete_assets()
        if route == "/api/admin/users":
            return self.handle_create_user()
        if route == "/api/admin/quota":
            return self.handle_update_quota()
        self.send_json({"error": "not_found"}, 404)

    def normalized_path(self):
        route = urlparse(self.path).path
        if not BASE_PATH:
            return route
        if route == BASE_PATH:
            return "/"
        if route.startswith(f"{BASE_PATH}/"):
            return route[len(BASE_PATH) :]
        return None

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_UPLOAD_BYTES * 2:
            raise ValueError("request_too_large")
        body = self.rfile.read(length)
        return json.loads(body.decode("utf-8") or "{}")

    def current_user(self):
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        jar.load(header)
        token = jar.get(COOKIE_NAME)
        payload = parse_token(token.value if token else "")
        if not payload:
            return None
        with db_connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (payload.get("uid"),)).fetchone()
            return row

    def require_user(self):
        user = self.current_user()
        if not user:
            self.send_json({"error": "unauthorized"}, 401)
            return None
        return user

    def require_admin(self):
        user = self.require_user()
        if not user:
            return None
        if user["role"] != "admin":
            self.send_json({"error": "forbidden"}, 403)
            return None
        return user

    def handle_session(self):
        user = self.current_user()
        self.send_json({"user": public_user(user) if user else None})

    def handle_login(self):
        data = self.read_json()
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        with db_connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not user or not verify_password(password, user["password_hash"]):
            return self.send_json({"error": "用户名或密码错误"}, 401)
        token = sign_payload({"uid": user["id"], "exp": int(time.time()) + SESSION_TTL})
        cookie_path = BASE_PATH or "/"
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header(
            "Set-Cookie",
            f"{COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path={cookie_path}; Max-Age={SESSION_TTL}",
        )
        self.end_headers()
        self.wfile.write(json.dumps({"user": public_user(user)}, ensure_ascii=False).encode("utf-8"))

    def handle_logout(self):
        cookie_path = BASE_PATH or "/"
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"{COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path={cookie_path}; Max-Age=0")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def handle_upload(self):
        user = self.require_user()
        if not user:
            return
        data = self.read_json()
        data_url = str(data.get("dataUrl", ""))
        name = Path(str(data.get("name", "image.jpg"))).name or "image.jpg"
        if "," not in data_url or not data_url.startswith("data:image/"):
            return self.send_json({"error": "只支持浏览器压缩后的图片上传"}, 400)
        meta, encoded = data_url.split(",", 1)
        mime = meta[5:].split(";", 1)[0]
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            return self.send_json({"error": "不支持的图片格式"}, 400)
        try:
            content = base64.b64decode(encoded, validate=True)
        except ValueError:
            return self.send_json({"error": "图片数据无效"}, 400)
        if len(content) > MAX_UPLOAD_BYTES:
            return self.send_json({"error": "图片太大，请降低分辨率后再上传"}, 400)
        try:
            content = compress_image(content)
        except RuntimeError:
            return self.send_json({"error": "服务器缺少图片压缩组件，请先安装 Pillow"}, 500)
        except ValueError:
            return self.send_json({"error": "图片压缩失败，请换一张图片"}, 400)
        self.store_asset(user, name, content, "image/jpeg")

    def handle_upload_file(self):
        user = self.require_user()
        if not user:
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_RAW_UPLOAD_BYTES:
            return self.send_json({"error": "原图太大，单张请控制在 60MB 内"}, 400)
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            return self.send_json({"error": "上传格式无效"}, 400)

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type, "CONTENT_LENGTH": str(length)},
        )
        field = form["image"] if "image" in form else None
        if field is None or not getattr(field, "filename", ""):
            return self.send_json({"error": "请选择图片文件"}, 400)
        name = Path(field.filename).name or "image.jpg"
        content = field.file.read()
        if not content:
            return self.send_json({"error": "图片数据为空"}, 400)
        try:
            compressed = compress_image(content)
        except RuntimeError:
            return self.send_json({"error": "服务器缺少图片压缩组件，请先安装 Pillow"}, 500)
        except Exception:
            return self.send_json({"error": "图片压缩失败，请换一张图片"}, 400)
        self.store_asset(user, name, compressed, "image/jpeg")

    def store_asset(self, user, name, content, mime):
        if user["used_bytes"] + len(content) > user["quota_bytes"]:
            return self.send_json({"error": "账号存储空间不足，请联系管理员调整配额"}, 403)

        asset_id = uuid.uuid4().hex
        user_dir = UPLOAD_DIR / str(user["id"])
        user_dir.mkdir(parents=True, exist_ok=True)
        path = user_dir / f"{asset_id}.jpg"
        path.write_bytes(content)
        stored_path = path.as_posix()
        now = int(time.time())
        with db_connect() as conn:
            conn.execute(
                """
                INSERT INTO assets (id, user_id, original_name, path, mime, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (asset_id, user["id"], name, stored_path, mime, len(content), now),
            )
            conn.execute("UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?", (len(content), user["id"]))
            conn.commit()
            fresh = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        self.send_json({"url": f"{BASE_PATH}/api/assets/{asset_id}", "assetId": asset_id, "user": public_user(fresh)})

    def handle_asset(self, asset_id):
        user = self.require_user()
        if not user:
            return
        with db_connect() as conn:
            asset = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if not asset:
            return self.send_json({"error": "not_found"}, 404)
        if user["role"] != "admin" and asset["user_id"] != user["id"]:
            return self.send_json({"error": "forbidden"}, 403)
        stored_path = Path(asset["path"])
        path = (stored_path if stored_path.is_absolute() else BASE_DIR / stored_path).resolve()
        try:
            path.relative_to(UPLOAD_DIR.resolve())
        except ValueError:
            return self.send_json({"error": "not_found"}, 404)
        if not path.exists():
            return self.send_json({"error": "not_found"}, 404)
        content = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", asset["mime"])
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        self.wfile.write(content)

    def handle_list_assets(self):
        user = self.require_user()
        if not user:
            return
        with db_connect() as conn:
            assets = conn.execute(
                "SELECT * FROM assets WHERE user_id = ? ORDER BY created_at ASC, rowid ASC",
                (user["id"],),
            ).fetchall()
        self.send_json(
            {
                "assets": [
                    {
                        "id": asset["id"],
                        "name": asset["original_name"],
                        "url": f"{BASE_PATH}/api/assets/{asset['id']}",
                        "sizeBytes": asset["size_bytes"],
                        "createdAt": asset["created_at"],
                    }
                    for asset in assets
                ]
            }
        )

    def handle_list_users(self):
        if not self.require_admin():
            return
        with db_connect() as conn:
            users = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        self.send_json({"users": [public_user(user) for user in users]})

    def handle_create_user(self):
        if not self.require_admin():
            return
        data = self.read_json()
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        role = "admin" if data.get("role") == "admin" else "user"
        try:
            quota = parse_size_to_bytes(data.get("quota", "512mb"))
        except ValueError:
            return self.send_json({"error": "配额格式无效，例如 500mb 或 2gb"}, 400)
        if not username or len(username) < 3 or len(password) < 3 or len(password) > 8:
            return self.send_json({"error": "账号至少 3 位，密码 3-8 位"}, 400)
        with db_connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO users (username, password_hash, role, quota_bytes, used_bytes, created_at)
                    VALUES (?, ?, ?, ?, 0, ?)
                    """,
                    (username, hash_password(password), role, quota, int(time.time())),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                return self.send_json({"error": "账号已存在"}, 409)
        self.handle_list_users()

    def handle_change_password(self):
        user = self.require_user()
        if not user:
            return
        data = self.read_json()
        current_password = str(data.get("currentPassword", ""))
        new_password = str(data.get("newPassword", ""))
        if len(new_password) < 3 or len(new_password) > 8:
            return self.send_json({"error": "新密码必须是 3-8 位"}, 400)
        if not verify_password(current_password, user["password_hash"]):
            return self.send_json({"error": "当前密码错误"}, 403)
        with db_connect() as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user["id"]))
            conn.commit()
        self.send_json({"ok": True})

    def handle_clear_storage(self):
        user = self.require_user()
        if not user:
            return
        with db_connect() as conn:
            assets = conn.execute("SELECT path FROM assets WHERE user_id = ?", (user["id"],)).fetchall()
            conn.execute("DELETE FROM assets WHERE user_id = ?", (user["id"],))
            conn.execute("UPDATE users SET used_bytes = 0 WHERE id = ?", (user["id"],))
            conn.commit()
            fresh = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()

        upload_root = UPLOAD_DIR.resolve()
        for asset in assets:
            stored_path = Path(asset["path"])
            path = (stored_path if stored_path.is_absolute() else BASE_DIR / stored_path).resolve()
            try:
                path.relative_to(upload_root)
            except ValueError:
                continue
            path.unlink(missing_ok=True)
        shutil.rmtree(UPLOAD_DIR / str(user["id"]), ignore_errors=True)
        self.send_json({"ok": True, "user": public_user(fresh)})

    def handle_delete_assets(self):
        user = self.require_user()
        if not user:
            return
        data = self.read_json()
        asset_ids = [str(asset_id) for asset_id in data.get("assetIds", []) if asset_id]
        if not asset_ids:
            return self.send_json({"error": "未选择图片"}, 400)
        placeholders = ",".join("?" for _ in asset_ids)
        with db_connect() as conn:
            assets = conn.execute(
                f"SELECT * FROM assets WHERE user_id = ? AND id IN ({placeholders})",
                (user["id"], *asset_ids),
            ).fetchall()
            if not assets:
                return self.send_json({"error": "未找到可删除图片"}, 404)
            total_size = sum(asset["size_bytes"] for asset in assets)
            conn.execute(f"DELETE FROM assets WHERE user_id = ? AND id IN ({placeholders})", (user["id"], *asset_ids))
            conn.execute(
                "UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?",
                (total_size, user["id"]),
            )
            conn.commit()
            fresh = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()

        upload_root = UPLOAD_DIR.resolve()
        for asset in assets:
            stored_path = Path(asset["path"])
            path = (stored_path if stored_path.is_absolute() else BASE_DIR / stored_path).resolve()
            try:
                path.relative_to(upload_root)
            except ValueError:
                continue
            path.unlink(missing_ok=True)
        self.send_json({"ok": True, "user": public_user(fresh)})

    def handle_update_quota(self):
        if not self.require_admin():
            return
        data = self.read_json()
        try:
            user_id = int(data.get("userId"))
            quota = parse_size_to_bytes(data.get("quota"))
        except (TypeError, ValueError):
            return self.send_json({"error": "参数无效"}, 400)
        with db_connect() as conn:
            target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not target:
                return self.send_json({"error": "账号不存在"}, 404)
            if quota < target["used_bytes"]:
                return self.send_json({"error": "新配额不能小于已使用空间"}, 400)
            conn.execute("UPDATE users SET quota_bytes = ? WHERE id = ?", (quota, user_id))
            conn.commit()
        self.handle_list_users()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Poster cloud server running on http://0.0.0.0:{port}")
    server.serve_forever()
