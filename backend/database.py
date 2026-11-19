import os
from pathlib import Path

import aiosqlite


def _resolve_db_path() -> Path:
    """Путь к SQLite.

    Приоритет:
    1. DB_PATH — явная переменная (например, /data/app.db);
    2. RAILWAY_VOLUME_MOUNT_PATH — Railway сам подставляет путь смонтированного volume;
    3. рядом с кодом — локальная разработка.
    """
    explicit = os.getenv("DB_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser()

    volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
    if volume:
        return Path(volume) / "app.db"

    return Path(__file__).parent / "app.db"


DB_PATH = _resolve_db_path()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id   INTEGER NOT NULL UNIQUE,
    username      TEXT,
    balance_stars INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gifts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    price_stars INTEGER NOT NULL CHECK (price_stars > 0),
    image_url   TEXT,
    is_nft      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    gift_id     INTEGER NOT NULL REFERENCES gifts(id),
    acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upgrades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    from_gift_id INTEGER NOT NULL REFERENCES gifts(id),
    to_gift_id   INTEGER NOT NULL REFERENCES gifts(id),
    chance       REAL NOT NULL,
    is_win       INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_upgrades_user  ON upgrades(user_id);
"""

SEED_GIFTS = [
    # name, price_stars, image_url, is_nft
    ("Мишка",  15,   "https://example.com/img/bear.png",   0),
    ("Сердце", 25,   "https://example.com/img/heart.png",  0),
    ("Подарок", 50,  "https://example.com/img/gift.png",   0),
    ("Роза",   100,  "https://example.com/img/rose.png",   0),
    ("Торт",   250,  "https://example.com/img/cake.png",   1),
    ("Кубок",  500,  "https://example.com/img/cup.png",    1),
]

TEST_TELEGRAM_ID = 123456789


async def get_connection() -> aiosqlite.Connection:
    # isolation_level=None -> автокоммит, транзакциями управляем вручную (BEGIN/COMMIT)
    db = await aiosqlite.connect(DB_PATH, isolation_level=None)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    await db.execute("PRAGMA busy_timeout = 5000")
    return db


async def init_db() -> None:
    db = await get_connection()
    try:
        await db.execute("PRAGMA journal_mode = WAL")
        await db.executescript(SCHEMA)
    finally:
        await db.close()


async def seed_db() -> None:
    """Идемпотентный seed: заполняет только пустые таблицы."""
    db = await get_connection()
    try:
        cur = await db.execute("SELECT COUNT(*) AS c FROM gifts")
        if (await cur.fetchone())["c"] == 0:
            await db.executemany(
                "INSERT INTO gifts (name, price_stars, image_url, is_nft) VALUES (?, ?, ?, ?)",
                SEED_GIFTS,
            )

        cur = await db.execute("SELECT id FROM users WHERE telegram_id = ?", (TEST_TELEGRAM_ID,))
        user = await cur.fetchone()
        if user is None:
            cur = await db.execute(
                "INSERT INTO users (telegram_id, username, balance_stars) VALUES (?, ?, ?)",
                (TEST_TELEGRAM_ID, "test_user", 100),
            )
            user_id = cur.lastrowid
        else:
            user_id = user["id"]

        # Демо-данные: тестовому пользователю всегда должно быть что улучшать.
        # Выдаём стартовый подарок, только если инвентарь пуст (например, после проигрыша).
        cur = await db.execute(
            "SELECT COUNT(*) AS c FROM inventory WHERE user_id = ?", (user_id,)
        )
        if (await cur.fetchone())["c"] == 0:
            cur = await db.execute("SELECT id FROM gifts ORDER BY price_stars ASC LIMIT 1")
            starter = await cur.fetchone()
            if starter is not None:
                await db.execute(
                    "INSERT INTO inventory (user_id, gift_id) VALUES (?, ?)",
                    (user_id, starter["id"]),
                )
    finally:
        await db.close()


if __name__ == "__main__":
    import asyncio

    async def _run():
        await init_db()
        await seed_db()
        print(f"База готова: {DB_PATH}")

    asyncio.run(_run())