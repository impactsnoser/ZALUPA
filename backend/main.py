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

from config import SELL_COEF, STARS_PER_TON, WELCOME_STARS
from game_settings import get_global_return_factor
from deploy_services import router as deploy_router
from database import (
    Gift,
    InventoryItem,
    Upgrade,
    User,
    WalletTransaction,
    close_db,
    get_session,
    init_db,
    seed_db,
)
from telegram_auth import get_init_data, verify_telegram_id
from admin import router as admin_router
from games import router as games_router
from wallet import _add_transaction, _user_by_telegram_id, configure_webhook, router as wallet_router, stars_to_ton

MARGIN_COEF = 0.92          # маржа 8%
RNG_PRECISION = 1_000_000   # точность броска


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_db()
    await configure_webhook()
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
app.include_router(wallet_router)
app.include_router(games_router)
app.include_router(admin_router)
app.include_router(deploy_router)


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
    if item.gift is not None:
        return {
            "inventory_id": item.id,
            "gift_id": item.gift.id,
            "name": item.gift.name,
            "price_stars": item.gift.price_stars,
            "image_url": item.gift.image_url,
            "is_nft": bool(item.gift.is_nft),
            "kind": "gift",
            "emoji": None,
        }
    return {
        "inventory_id": item.id,
        "gift_id": None,
        "name": item.prize_name or "Приз",
        "price_stars": item.prize_value_stars or 0,
        "image_url": item.prize_image_url,
        "is_nft": False,
        "kind": "prize",
        "emoji": item.prize_emoji,
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
        "balance_ton": round(user.balance_stars / STARS_PER_TON, 2),
        "stars_per_ton": STARS_PER_TON,
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

            user = User(
                telegram_id=req.telegram_id,
                username=req.username,
                balance_stars=WELCOME_STARS,
            )
            session.add(user)
            await session.flush()
            if WELCOME_STARS:
                session.add(
                    WalletTransaction(
                        user_id=user.id,
                        amount=WELCOME_STARS,
                        kind="welcome",
                        label="Приветственный баланс",
                        balance_after=WELCOME_STARS,
                    )
                )
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


class SellItemRequest(BaseModel):
    telegram_id: int
    inventory_id: int


class SellAllRequest(BaseModel):
    telegram_id: int


@app.get("/api/inventory/{telegram_id}")
async def get_inventory(
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Список предметов в инвентаре пользователя (подарки и призы из кейсов)."""
    verify_telegram_id(telegram_id, init_data)
    user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    items = (
        await session.scalars(
            select(InventoryItem)
            .options(selectinload(InventoryItem.gift))
            .where(InventoryItem.user_id == user.id)
            .order_by(InventoryItem.id.desc())
        )
    ).all()
    return {"items": [_inventory_dict(item) for item in items]}


@app.post("/api/inventory/sell-item")
async def sell_inventory_item(
    req: SellItemRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Продать предмет из инвентаря за звёзды (по курсу SELL_COEF)."""
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        item = await session.scalar(
            select(InventoryItem)
            .options(selectinload(InventoryItem.gift))
            .where(
                InventoryItem.id == req.inventory_id,
                InventoryItem.user_id == user.id,
            )
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Предмет не найден в инвентаре")

        value = 0
        if item.gift is not None:
            value = item.gift.price_stars
        elif item.prize_value_stars is not None:
            value = item.prize_value_stars

        sell_stars = max(1, int(round(value * SELL_COEF)))
        item_name = item.prize_name or (item.gift.name if item.gift else "Предмет")
        await session.execute(
            delete(InventoryItem).where(InventoryItem.id == req.inventory_id)
        )
        user.balance_stars += sell_stars
        _add_transaction(
            session,
            user,
            amount=sell_stars,
            kind="inventory_sell",
            label=f"Продажа: {item_name}",
        )

    return {
        "sold_stars": sell_stars,
        "sold_ton": stars_to_ton(sell_stars),
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


@app.post("/api/inventory/sell-all")
async def sell_all_inventory(
    req: SellAllRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Продать весь инвентарь одной атомарной операцией."""
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        items = (
            await session.scalars(
                select(InventoryItem)
                .options(selectinload(InventoryItem.gift))
                .where(InventoryItem.user_id == user.id)
                .with_for_update()
            )
        ).all()
        if not items:
            raise HTTPException(status_code=400, detail="Инвентарь уже пуст")

        sold_stars = 0
        for item in items:
            value = item.gift.price_stars if item.gift is not None else (item.prize_value_stars or 0)
            sold_stars += max(1, int(round(value * SELL_COEF)))

        await session.execute(
            delete(InventoryItem).where(InventoryItem.user_id == user.id)
        )
        user.balance_stars += sold_stars
        _add_transaction(
            session,
            user,
            amount=sold_stars,
            kind="inventory_sell",
            label=f"Продажа всего инвентаря ({len(items)} предметов)",
        )

    return {
        "sold_count": len(items),
        "sold_stars": sold_stars,
        "sold_ton": stars_to_ton(sold_stars),
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


@app.post("/api/inventory/withdraw-item")
async def withdraw_inventory_item(
    req: SellItemRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Забрать предмет из инвентаря (NFT или подарок). Удаляет из инвентаря."""
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        item = await session.scalar(
            select(InventoryItem)
            .options(selectinload(InventoryItem.gift))
            .where(
                InventoryItem.id == req.inventory_id,
                InventoryItem.user_id == user.id,
            )
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Предмет не найден в инвентаре")

        await session.execute(
            delete(InventoryItem).where(InventoryItem.id == req.inventory_id)
        )

    return {
        "withdrawn": {
            "inventory_id": item.id,
            "name": item.prize_name or (item.gift.name if item.gift else "Подарок"),
            "image_url": item.prize_image_url or (item.gift.image_url if item.gift else None),
            "is_nft": bool(item.gift.is_nft) if item.gift else False,
        },
        "message": "Предмет готов к передаче. Обратитесь в поддержку с чеком оплаты для доставки NFT/подарка.",
    }


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

        # Кейсовые предметы хранятся как prize_* без gift_id. Если подарок
        # входит в каталог, связываем его по имени и разрешаем апгрейд так же,
        # как для обычного подарка из каталога.
        source_gift = item.gift
        if source_gift is None and item.prize_name:
            source_gift = await session.scalar(
                select(Gift).where(Gift.name == item.prize_name)
            )
        if source_gift is None:
            raise HTTPException(status_code=400, detail="Этот предмет нельзя улучшить")

        from_price = item.prize_value_stars if item.gift is None and item.prize_value_stars is not None else source_gift.price_stars
        to_price = target.price_stars
        if to_price <= from_price:
            raise HTTPException(
                status_code=400, detail="Целевой подарок должен быть дороже исходного"
            )

        chance = (from_price / to_price) * MARGIN_COEF * await get_global_return_factor(session)
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
                from_gift_id=source_gift.id,
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
