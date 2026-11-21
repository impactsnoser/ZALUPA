"""Админ-панель: права, удача игроков и шансы кейсов.

Доступ проверяется по подписи Telegram (initData), а не по telegram_id из
тела запроса: чужой аккаунт не сможет назваться админом.

Владельцы задаются в config.py (DEFAULT_ADMIN_IDS) или переменной ADMIN_IDS.
Остальным права выдаёт админ через панель — они хранятся в users.is_admin.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import ADMIN_IDS, MAX_LUCK
from database import AppSetting, User, get_session
from games import CASES
from telegram_auth import get_init_data, verify_telegram_id
from wallet import _add_transaction

router = APIRouter(prefix="/api/admin")

CASE_LUCK_PREFIX = "case_luck:"


def is_root_admin(telegram_id: int) -> bool:
    return int(telegram_id) in ADMIN_IDS


def is_admin_account(user: User | None) -> bool:
    if user is None:
        return False
    return bool(user.is_admin) or is_root_admin(user.telegram_id)


def _user_dict(user: User) -> dict:
    return {
        "telegram_id": user.telegram_id,
        "username": user.username,
        "balance_stars": user.balance_stars,
        "is_admin": bool(user.is_admin),
        "is_root": is_root_admin(user.telegram_id),
        "luck_multiplier": round(float(user.luck_multiplier or 1.0), 2),
    }


async def _load_admin(
    session: AsyncSession, telegram_id: int, init_data: str | None
) -> User | None:
    """Проверяет подпись Telegram и права админа."""
    verify_telegram_id(telegram_id, init_data)
    user = await session.scalar(
        select(User).where(User.telegram_id == telegram_id)
    )
    if user is None and is_root_admin(telegram_id):
        # Владелец может ещё не открыть приложение — это не мешает панели.
        return None
    if not is_admin_account(user):
        raise HTTPException(status_code=403, detail="Нет доступа к админ-панели")
    return user


async def _load_target(session: AsyncSession, telegram_id: int) -> User:
    target = await session.scalar(
        select(User).where(User.telegram_id == telegram_id)
    )
    if target is None:
        raise HTTPException(
            status_code=404,
            detail="Игрок не найден. Пусть сначала откроет приложение через Telegram.",
        )
    return target


@router.get("/me")
async def admin_me(
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Возвращает права текущего аккаунта — фронт решает, показывать ли панель."""
    verify_telegram_id(telegram_id, init_data)
    user = await session.scalar(
        select(User).where(User.telegram_id == telegram_id)
    )
    return {
        "is_admin": is_admin_account(user) or is_root_admin(telegram_id),
        "is_root": is_root_admin(telegram_id),
        "max_luck": MAX_LUCK,
    }


@router.get("/users")
async def admin_users(
    telegram_id: int,
    q: str = Query(default="", max_length=64),
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Поиск игроков по Telegram ID или username. Без запроса — последние 20."""
    await _load_admin(session, telegram_id, init_data)

    query = q.strip().lstrip("@")
    statement = select(User)
    if query:
        if query.isdigit():
            statement = statement.where(User.telegram_id == int(query))
        else:
            statement = statement.where(
                func.lower(User.username).like(f"%{query.lower()}%")
            )
    users = (
        await session.scalars(statement.order_by(User.id.desc()).limit(20))
    ).all()
    return {"users": [_user_dict(user) for user in users]}


class AdminFlagRequest(BaseModel):
    enabled: bool


@router.post("/users/{target_id}/admin")
async def set_admin_rights(
    target_id: int,
    req: AdminFlagRequest,
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Выдать или снять админку. Владельцев из ADMIN_IDS снять нельзя."""
    admin = await _load_admin(session, telegram_id, init_data)
    target = await _load_target(session, target_id)

    if not req.enabled:
        if is_root_admin(target.telegram_id):
            raise HTTPException(
                status_code=400,
                detail="Этот аккаунт задан в ADMIN_IDS — уберите его из переменных.",
            )
        if admin is not None and admin.id == target.id:
            raise HTTPException(status_code=400, detail="Нельзя снять админку с себя")

    target.is_admin = req.enabled
    await session.commit()
    return {"ok": True, "user": _user_dict(target)}


class LuckRequest(BaseModel):
    luck: float = Field(ge=1.0, le=MAX_LUCK)


@router.post("/users/{target_id}/luck")
async def set_user_luck(
    target_id: int,
    req: LuckRequest,
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Персональный множитель удачи: для партнёров и записи рекламных видео."""
    await _load_admin(session, telegram_id, init_data)
    target = await _load_target(session, target_id)

    target.luck_multiplier = round(float(req.luck), 2)
    await session.commit()
    return {"ok": True, "user": _user_dict(target)}


class BalanceRequest(BaseModel):
    amount_stars: int = Field(ge=1, le=100_000_000)


@router.post("/users/{target_id}/balance")
async def add_user_balance(
    target_id: int,
    req: BalanceRequest,
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Начислить игроку звёзды на единый баланс (подарок, компенсация и т.п.)."""
    admin = await _load_admin(session, telegram_id, init_data)
    target = await _load_target(session, target_id)

    target.balance_stars += req.amount_stars
    _add_transaction(
        session,
        target,
        amount=req.amount_stars,
        kind="admin_credit",
        label=f"Начисление администратором: {req.amount_stars} ⭐",
        reference=f"admin:{admin.telegram_id}" if admin is not None else "admin:env",
    )
    await session.commit()
    return {"ok": True, "user": _user_dict(target)}


async def _case_luck_values(session: AsyncSession) -> list[dict]:
    result = []
    for case in CASES:
        setting = await session.get(AppSetting, f"{CASE_LUCK_PREFIX}{case['id']}")
        luck = 1.0
        if setting is not None:
            try:
                luck = max(1.0, min(MAX_LUCK, float(setting.value)))
            except (TypeError, ValueError):
                luck = 1.0
        result.append(
            {
                "id": case["id"],
                "title": case["title"],
                "price": case["price"],
                "luck_multiplier": round(luck, 2),
            }
        )
    return result


@router.get("/settings")
async def admin_settings(
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    await _load_admin(session, telegram_id, init_data)
    return {"cases": await _case_luck_values(session), "max_luck": MAX_LUCK}


class CaseLuckRequest(BaseModel):
    luck: float = Field(ge=1.0, le=MAX_LUCK)


@router.post("/cases/{case_id}/luck")
async def set_case_luck(
    case_id: str,
    req: CaseLuckRequest,
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Общий множитель шансов кейса — действует на всех игроков."""
    await _load_admin(session, telegram_id, init_data)

    case = next((item for item in CASES if item["id"] == case_id), None)
    if case is None:
        raise HTTPException(status_code=404, detail="Кейс не найден")

    key = f"{CASE_LUCK_PREFIX}{case_id}"
    setting = await session.get(AppSetting, key)
    if setting is None:
        session.add(AppSetting(key=key, value=str(round(float(req.luck), 2))))
    else:
        setting.value = str(round(float(req.luck), 2))
    await session.commit()

    return {
        "ok": True,
        "case": {
            "id": case["id"],
            "title": case["title"],
            "price": case["price"],
            "luck_multiplier": round(float(req.luck), 2),
        },
    }
