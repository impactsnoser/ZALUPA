import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import (
    Gift,
    InventoryItem,
    Upgrade,
    User,
    close_db,
    get_session,
    init_db,
    seed_db,
)
from telegram_auth import get_init_data, verify_telegram_id

MARGIN_COEF = 0.92          # маржа 8%
RNG_PRECISION = 1_000_000   # точность броска


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_db()
    yield
    await close_db()


app = FastAPI(title="Gifts Mini App API", lifespan=lifespan)

# Домен фронтенда можно задать через FRONTEND_ORIGIN (несколько — через запятую).
# Пока переменная не задана, разрешаем всё, чтобы не сломать текущий деплой.
_frontend_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGIN", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UpgradeRequest(BaseModel):
    telegram_id: int
    inventory_id: int
    target_gift_id: int


class RegisterRequest(BaseModel):
    telegram_id: int
    username: str | None = None


class StarterRequest(BaseModel):
    telegram_id: int


def _gift_dict(gift: Gift) -> dict:
    return {
        "id": gift.id,
        "name": gift.name,
        "price_stars": gift.price_stars,
        "image_url": gift.image_url,
        "is_nft": bool(gift.is_nft),
    }


def _inventory_dict(item: InventoryItem) -> dict:
    return {
        "inventory_id": item.id,
        "acquired_at": item.acquired_at,
        "gift_id": item.gift.id,
        "name": item.gift.name,
        "price_stars": item.gift.price_stars,
        "image_url": item.gift.image_url,
        "is_nft": bool(item.gift.is_nft),
    }


async def _cheapest_gift(session: AsyncSession) -> Gift | None:
    return await session.scalar(select(Gift).order_by(Gift.price_stars.asc()).limit(1))


async def _grant_starter(session: AsyncSession, user_id: int) -> dict | None:
    """Кладёт самый дешёвый подарок в инвентарь и возвращает его описание."""
    gift = await _cheapest_gift(session)
    if gift is None:
        return None

    item = InventoryItem(user_id=user_id, gift_id=gift.id)
    session.add(item)
    await session.flush()

    return {
        "inventory_id": item.id,
        "gift_id": gift.id,
        "name": gift.name,
        "price_stars": gift.price_stars,
        "image_url": gift.image_url,
        "is_nft": bool(gift.is_nft),
    }


@app.get("/api/health")
async def health(session: AsyncSession = Depends(get_session)):
    """Проверка живости: Railway healthcheck и ручная диагностика."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — healthcheck должен вернуть понятный статус
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc
    return {"status": "ok"}


@app.get("/api/gifts")
async def list_gifts(session: AsyncSession = Depends(get_session)):
    gifts = (
        await session.scalars(select(Gift).order_by(Gift.price_stars.asc()))
    ).all()
    return [_gift_dict(gift) for gift in gifts]


@app.get("/api/user/{telegram_id}")
async def get_user(
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(telegram_id, init_data)

    user = await session.scalar(
        select(User)
        .options(selectinload(User.inventory).selectinload(InventoryItem.gift))
        .where(User.telegram_id == telegram_id)
    )
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "username": user.username,
        "balance_stars": user.balance_stars,
        "created_at": user.created_at,
        "inventory": [
            _inventory_dict(item)
            for item in sorted(user.inventory, key=lambda item: item.id)
        ],
    }


@app.post("/api/register")
async def register(
    req: RegisterRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Идемпотентная регистрация: создаёт юзера и выдаёт стартовый подарок.

    Нужна, чтобы новый Telegram-пользователь не получал 404 и не уходил в демо-режим.
    """
    verify_telegram_id(req.telegram_id, init_data)

    try:
        async with session.begin():
            existing_id = await session.scalar(
                select(User.id).where(User.telegram_id == req.telegram_id)
            )
            if existing_id is not None:
                return {"telegram_id": req.telegram_id, "created": False}

            user = User(telegram_id=req.telegram_id, username=req.username)
            session.add(user)
            await session.flush()
            await _grant_starter(session, user.id)
    except IntegrityError:
        # параллельный запрос уже создал этого пользователя
        await session.rollback()
        return {"telegram_id": req.telegram_id, "created": False}

    return {"telegram_id": req.telegram_id, "created": True}


@app.post("/api/starter")
async def claim_starter(
    req: StarterRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Выдаёт стартовый подарок, если инвентарь пуст.

    Игрок мог проиграть последний предмет в апгрейде — без этого он бы
    навсегда остался без возможности играть.
    """
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await session.scalar(
            select(User).where(User.telegram_id == req.telegram_id).with_for_update()
        )
        if user is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        inventory_count = await session.scalar(
            select(func.count())
            .select_from(InventoryItem)
            .where(InventoryItem.user_id == user.id)
        )
        if inventory_count > 0:
            raise HTTPException(
                status_code=409, detail="В инвентаре уже есть подарки"
            )

        gift = await _grant_starter(session, user.id)
        if gift is None:
            raise HTTPException(status_code=404, detail="Каталог подарков пуст")

    return gift


@app.post("/api/upgrade")
async def upgrade(
    req: UpgradeRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        # Блокировка пользователя сериализует параллельные апгрейды его предметов.
        user = await session.scalar(
            select(User)
            .where(User.telegram_id == req.telegram_id)
            .with_for_update()
        )
        if user is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        # предмет должен существовать и принадлежать именно этому юзеру
        item = await session.scalar(
            select(InventoryItem)
            .options(selectinload(InventoryItem.gift))
            .where(
                InventoryItem.id == req.inventory_id,
                InventoryItem.user_id == user.id,
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Предмет не найден в инвентаре")

        target = await session.get(Gift, req.target_gift_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Целевой подарок не найден")

        from_price, to_price = item.gift.price_stars, target.price_stars
        if to_price <= from_price:
            raise HTTPException(
                status_code=400, detail="Целевой подарок должен быть дороже исходного"
            )

        chance = (from_price / to_price) * MARGIN_COEF
        roll = secrets.randbelow(RNG_PRECISION) / RNG_PRECISION  # [0, 1)
        is_win = roll < chance

        await session.execute(
            delete(InventoryItem).where(
                InventoryItem.id == item.id,
                InventoryItem.user_id == user.id,
            )
        )

        new_inventory_id = None
        if is_win:
            new_item = InventoryItem(user_id=user.id, gift_id=target.id)
            session.add(new_item)
            await session.flush()
            new_inventory_id = new_item.id

        session.add(
            Upgrade(
                user_id=user.id,
                from_gift_id=item.gift_id,
                to_gift_id=target.id,
                chance=chance,
                is_win=is_win,
            )
        )

    return {
        "win": is_win,
        "roll": round(roll, 6),      # бросок 0..1; победа, если roll < chance
        "chance": round(chance, 6),  # шанс 0..1
        "new_inventory_id": new_inventory_id,
    }


if __name__ == "__main__":
    # Локальный запуск и любой хостинг с переменной PORT (Railway, Render и т.п.)
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
