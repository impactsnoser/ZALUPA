import secrets
import sqlite3
from contextlib import asynccontextmanager

import aiosqlite
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import get_connection, init_db, seed_db

MARGIN_COEF = 0.92          # маржа 8%
RNG_PRECISION = 1_000_000   # точность броска


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_db()
    yield


app = FastAPI(title="Gifts Mini App API", lifespan=lifespan)

# На деве разрешаем всё. В проде впиши сюда домен фронта!
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def get_db():
    db = await get_connection()
    try:
        yield db
    finally:
        await db.close()


class UpgradeRequest(BaseModel):
    telegram_id: int
    inventory_id: int
    target_gift_id: int


class RegisterRequest(BaseModel):
    telegram_id: int
    username: str | None = None


@app.get("/api/health")
async def health():
    """Проверка живости: Railway healthcheck и ручная диагностика."""
    return {"status": "ok"}


@app.get("/api/gifts")
async def list_gifts(db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute(
        "SELECT id, name, price_stars, image_url, is_nft FROM gifts ORDER BY price_stars"
    )
    return [{**dict(r), "is_nft": bool(r["is_nft"])} for r in await cur.fetchall()]


@app.get("/api/user/{telegram_id}")
async def get_user(telegram_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute(
        "SELECT id, telegram_id, username, balance_stars, created_at FROM users WHERE telegram_id = ?",
        (telegram_id,),
    )
    user = await cur.fetchone()
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    cur = await db.execute(
        """
        SELECT i.id AS inventory_id, i.acquired_at,
               g.id AS gift_id, g.name, g.price_stars, g.image_url, g.is_nft
        FROM inventory i
        JOIN gifts g ON g.id = i.gift_id
        WHERE i.user_id = ?
        ORDER BY i.id
        """,
        (user["id"],),
    )
    inventory = [{**dict(r), "is_nft": bool(r["is_nft"])} for r in await cur.fetchall()]
    return {**dict(user), "inventory": inventory}


@app.post("/api/register")
async def register(req: RegisterRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Идемпотентная регистрация: создаёт юзера и выдаёт стартовый подарок.

    Нужна, чтобы новый Telegram-пользователь не получал 404 и не уходил в демо-режим.
    """
    cur = await db.execute("SELECT id FROM users WHERE telegram_id = ?", (req.telegram_id,))
    if await cur.fetchone() is not None:
        return {"telegram_id": req.telegram_id, "created": False}

    try:
        cur = await db.execute(
            "INSERT INTO users (telegram_id, username) VALUES (?, ?)",
            (req.telegram_id, req.username),
        )
        user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        # параллельный запрос уже создал этого пользователя
        return {"telegram_id": req.telegram_id, "created": False}

    cur = await db.execute("SELECT id FROM gifts ORDER BY price_stars ASC LIMIT 1")
    starter = await cur.fetchone()
    if starter is not None:
        await db.execute(
            "INSERT INTO inventory (user_id, gift_id) VALUES (?, ?)",
            (user_id, starter["id"]),
        )

    return {"telegram_id": req.telegram_id, "created": True}


@app.post("/api/upgrade")
async def upgrade(req: UpgradeRequest, db: aiosqlite.Connection = Depends(get_db)):
    # BEGIN IMMEDIATE сразу берёт write-lock: параллельные апгрейды одного предмета встанут в очередь
    await db.execute("BEGIN IMMEDIATE")
    try:
        cur = await db.execute("SELECT id FROM users WHERE telegram_id = ?", (req.telegram_id,))
        user = await cur.fetchone()
        if user is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        # предмет должен существовать и принадлежать именно этому юзеру
        cur = await db.execute(
            """
            SELECT i.id, i.gift_id, g.price_stars
            FROM inventory i JOIN gifts g ON g.id = i.gift_id
            WHERE i.id = ? AND i.user_id = ?
            """,
            (req.inventory_id, user["id"]),
        )
        item = await cur.fetchone()
        if item is None:
            raise HTTPException(status_code=404, detail="Предмет не найден в инвентаре")

        cur = await db.execute(
            "SELECT id, price_stars FROM gifts WHERE id = ?", (req.target_gift_id,)
        )
        target = await cur.fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="Целевой подарок не найден")

        from_price, to_price = item["price_stars"], target["price_stars"]
        if to_price <= from_price:
            raise HTTPException(
                status_code=400, detail="Целевой подарок должен быть дороже исходного"
            )

        chance = (from_price / to_price) * MARGIN_COEF
        roll = secrets.randbelow(RNG_PRECISION) / RNG_PRECISION  # [0, 1)
        is_win = roll < chance

        # удаляем старый предмет (rowcount-проверка = защита от двойной траты)
        cur = await db.execute(
            "DELETE FROM inventory WHERE id = ? AND user_id = ?",
            (item["id"], user["id"]),
        )
        if cur.rowcount != 1:
            raise HTTPException(status_code=409, detail="Предмет уже использован")

        new_inventory_id = None
        if is_win:
            cur = await db.execute(
                "INSERT INTO inventory (user_id, gift_id) VALUES (?, ?)",
                (user["id"], target["id"]),
            )
            new_inventory_id = cur.lastrowid

        await db.execute(
            """
            INSERT INTO upgrades (user_id, from_gift_id, to_gift_id, chance, is_win)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user["id"], item["gift_id"], target["id"], chance, int(is_win)),
        )
        await db.execute("COMMIT")
    except Exception:
        await db.execute("ROLLBACK")
        raise

    return {
        "win": is_win,
        "roll": round(roll, 6),      # бросок 0..1; победа, если roll < chance
        "chance": round(chance, 6),  # шанс 0..1
        "new_inventory_id": new_inventory_id,
    }


if __name__ == "__main__":
    # Локальный запуск и любой хостинг с переменной PORT (Railway, Render и т.п.)
    import os

    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))