"""Серверные игры: кейсы, мины и ракета.

Главный принцип: клиент присылает только действие (открыть кейс, открыть
клетку, забрать выигрыш), а все случайные числа, ставки и начисления считает
сервер. Поэтому результат нельзя подделать через консоль браузера.
"""

from __future__ import annotations

import math
import json
import secrets
from datetime import datetime, timezone
from math import comb

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import MAX_LUCK, SELL_COEF, STARS_PER_TON
from database import (
    AppSetting,
    Gift,
    InventoryItem,
    MinesSession,
    RocketSession,
    SnowfallSession,
    User,
    get_session,
)
from telegram_auth import get_init_data, verify_telegram_id
from wallet import _add_transaction, _user_by_telegram_id, stars_to_ton

router = APIRouter(prefix="/api")

TOTAL_WEIGHT = 10_000
MINES_CELLS = 25
MINES_RTP = 0.95
ROCKET_RTP = 0.95
ROCKET_GROWTH = 0.08889
ROCKET_MAX_MULTIPLIER = 100.0

SNOWFALL_TOOLS = [
    {"name": "Ледяная кирка", "emoji": "🪓", "rarity": "Обычная", "durability": 6},
    {"name": "Ледяной молот", "emoji": "🔨", "rarity": "Необычная", "durability": 8},
    {"name": "Полярная кирка", "emoji": "⛏️", "rarity": "Редкая", "durability": 10},
    {"name": "Кристальный бур", "emoji": "💎", "rarity": "Эпическая", "durability": 12},
    {"name": "Северная звезда", "emoji": "🌟", "rarity": "Легендарная", "durability": 15},
]
SNOWFALL_BLOCKS = [
    {"name": "Хрупкий лёд", "emoji": "◇", "hp": 1, "kind": "ice"},
    {"name": "Голубой лёд", "emoji": "🔹", "hp": 2, "kind": "ice"},
    {"name": "Кристальная жила", "emoji": "🔷", "hp": 3, "kind": "crystal"},
    {"name": "Древний лёд", "emoji": "◈", "hp": 4, "kind": "stone"},
]
SNOWFALL_RTP = 0.9


# ---------------------------------------------------------------- кейсы

# Веса и состав кейсов лежат в cases_data.py (генерируется из таблицы).
from cases_data import CASES

TOTAL_WEIGHT = 10_000


def _case(case_id: str) -> dict:
    for case in CASES:
        if case["id"] == case_id:
            return case
    raise HTTPException(status_code=404, detail="Кейс не найден")


def _ton_to_stars(value: float) -> int:
    return max(1, int(round(value * STARS_PER_TON)))


CASE_LUCK_PREFIX = "case_luck:"


async def _case_luck(session: AsyncSession, case_id: str) -> float:
    """Глобальный множитель удачи кейса, заданный в админ-панели."""
    setting = await session.get(AppSetting, f"{CASE_LUCK_PREFIX}{case_id}")
    if setting is None:
        return 1.0
    try:
        return max(1.0, min(MAX_LUCK, float(setting.value)))
    except (TypeError, ValueError):
        return 1.0


def _draw_prize(case: dict, luck: float = 1.0) -> dict:
    """Взвешенный розыгрыш.

    luck = 1 — обычные веса. При luck > 1 вес дорогих призов растёт сильнее,
    чем дешёвых: это и есть «повышенные шансы» для партнёров и рекламы.
    """
    luck = max(1.0, min(MAX_LUCK, luck))
    prizes = case["prizes"]

    if luck <= 1.0:
        roll = secrets.randbelow(TOTAL_WEIGHT)
        for prize in prizes:
            if roll < prize["weight"]:
                return prize
            roll -= prize["weight"]
        return prizes[-1]

    max_value = max(prize["value"] for prize in prizes) or 1.0
    weights = [
        prize["weight"] * (1.0 + (luck - 1.0) * (prize["value"] / max_value))
        for prize in prizes
    ]
    roll = secrets.randbelow(1_000_000) / 1_000_000 * sum(weights)
    for prize, weight in zip(prizes, weights):
        if roll < weight:
            return prize
        roll -= weight
    return prizes[-1]


@router.get("/cases")
async def list_cases():
    """Публичный каталог. Цены и призы всё равно проверяются на сервере."""
    return CASES


class CaseOpenRequest(BaseModel):
    telegram_id: int
    case_id: str = Field(min_length=1, max_length=64)


@router.post("/cases/open")
async def open_case(
    req: CaseOpenRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)
    case = _case(req.case_id)
    bet_stars = _ton_to_stars(case["price"])

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        if user.balance_stars < bet_stars:
            raise HTTPException(status_code=400, detail="Недостаточно средств")

        # Удача складывается: общая на кейс + персональная для игрока.
        case_luck = await _case_luck(session, case["id"])
        user_luck = max(1.0, min(MAX_LUCK, float(user.luck_multiplier or 1.0)))
        luck = min(MAX_LUCK, case_luck * user_luck)

        user.balance_stars -= bet_stars
        _add_transaction(
            session,
            user,
            amount=-bet_stars,
            kind="case_bet",
            label=f"Кейс «{case['title']}»",
        )

        prize = _draw_prize(case, luck)
        prize_stars = _ton_to_stars(prize["value"])
        # Приз именуем как в каталоге: запасной emoji не нужен, есть картинка.
        inventory_item = InventoryItem(
                user_id=user.id,
                prize_name=prize["name"],
                prize_value_stars=prize_stars,
                prize_image_url=f"/prizes/{prize['image']}",
                prize_emoji=None,
            )
        session.add(inventory_item)
        await session.flush()

    return {
        "case_id": case["id"],
        "case_title": case["title"],
        "prize": prize,
        "bet_stars": bet_stars,
        "bet_ton": stars_to_ton(bet_stars),
        "prize_stars": prize_stars,
        "sell_value_stars": max(1, int(round(prize_stars * SELL_COEF))),
        "prize_ton": stars_to_ton(prize_stars),
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
        "inventory_added": True,
        "inventory_id": inventory_item.id,
    }


# ---------------------------------------------------------------- мины


def _parse_positions(raw: str) -> list[int]:
    return [int(part) for part in raw.split(",") if part.strip()]


def _join_positions(positions: list[int]) -> str:
    return ",".join(str(position) for position in sorted(set(positions)))


def _mines_multiplier(mines_count: int, opened: int) -> float:
    """Честный множитель: 1 / вероятность открыть opened безопасных клеток.

    Домножен на RTP (0.95), то есть у проекта остаётся 5% преимущества.
    """
    if opened <= 0:
        return 1.0
    safe_cells = MINES_CELLS - mines_count
    probability = comb(safe_cells, opened) / comb(MINES_CELLS, opened)
    return round(MINES_RTP / probability, 2)


def _mines_state(
    game: MinesSession, user: User, *, reveal_mines: bool = False
) -> dict:
    opened = _parse_positions(game.opened_positions)
    multiplier = (
        _mines_multiplier(game.mines_count, len(opened))
        if game.status in {"active", "won"}
        else 0.0
    )
    return {
        "session_id": game.id,
        "status": game.status,
        "bet_stars": game.bet_stars,
        "bet_ton": stars_to_ton(game.bet_stars),
        "mines_count": game.mines_count,
        "opened": opened,
        "mines": _parse_positions(game.mine_positions) if reveal_mines else None,
        "multiplier": multiplier,
        "payout_stars": game.payout_stars,
        "payout_ton": stars_to_ton(game.payout_stars),
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


async def _finish_mines(game: MinesSession, status: str) -> None:
    game.status = status
    game.finished_at = datetime.now(timezone.utc)


class MinesStartRequest(BaseModel):
    telegram_id: int
    bet_stars: int = Field(ge=1, le=10_000_000)
    mines: int = Field(ge=1, le=10)


@router.post("/mines/start")
async def start_mines(
    req: MinesStartRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)

        # Незавершённая партия сгорает: нельзя копить активные игры.
        active_games = (
            await session.scalars(
                select(MinesSession).where(
                    MinesSession.user_id == user.id,
                    MinesSession.status == "active",
                )
            )
        ).all()
        for active in active_games:
            await _finish_mines(active, "abandoned")

        if user.balance_stars < req.bet_stars:
            raise HTTPException(status_code=400, detail="Недостаточно средств")

        user.balance_stars -= req.bet_stars
        _add_transaction(
            session,
            user,
            amount=-req.bet_stars,
            kind="mines_bet",
            label="Мины: ставка",
        )

        mines = sorted(secrets.SystemRandom().sample(range(MINES_CELLS), req.mines))
        game = MinesSession(
            user_id=user.id,
            bet_stars=req.bet_stars,
            mines_count=req.mines,
            mine_positions=_join_positions(mines),
            opened_positions="",
            status="active",
            payout_stars=0,
        )
        session.add(game)
        await session.flush()

        result = _mines_state(game, user)

    return result


class MinesActionRequest(BaseModel):
    telegram_id: int
    session_id: int


class MinesOpenRequest(MinesActionRequest):
    cell: int = Field(ge=0, le=MINES_CELLS - 1)


@router.post("/mines/open")
async def open_mine(
    req: MinesOpenRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        game = await session.scalar(
            select(MinesSession)
            .where(
                MinesSession.id == req.session_id,
                MinesSession.user_id == user.id,
            )
            .with_for_update()
        )
        if game is None:
            raise HTTPException(status_code=404, detail="Партия не найдена")
        if game.status != "active":
            raise HTTPException(status_code=409, detail="Партия уже завершена")

        opened = _parse_positions(game.opened_positions)
        if req.cell in opened:
            raise HTTPException(status_code=409, detail="Клетка уже открыта")

        mines = _parse_positions(game.mine_positions)
        if req.cell in mines:
            await _finish_mines(game, "lost")
            result = _mines_state(game, user, reveal_mines=True)
        else:
            opened.append(req.cell)
            game.opened_positions = _join_positions(opened)

            safe_cells = MINES_CELLS - game.mines_count
            if len(opened) >= safe_cells:
                multiplier = _mines_multiplier(game.mines_count, len(opened))
                payout = max(1, int(round(game.bet_stars * multiplier)))
                user.balance_stars += payout
                game.payout_stars = payout
                await _finish_mines(game, "won")
                _add_transaction(
                    session,
                    user,
                    amount=payout,
                    kind="mines_win",
                    label="Мины: выигрыш",
                    reference=f"mines:{game.id}",
                )
                result = _mines_state(game, user)
            else:
                result = _mines_state(game, user)

    return result


@router.post("/mines/cashout")
async def cashout_mines(
    req: MinesActionRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        game = await session.scalar(
            select(MinesSession)
            .where(
                MinesSession.id == req.session_id,
                MinesSession.user_id == user.id,
            )
            .with_for_update()
        )
        if game is None:
            raise HTTPException(status_code=404, detail="Партия не найдена")
        if game.status != "active":
            raise HTTPException(status_code=409, detail="Партия уже завершена")

        opened = _parse_positions(game.opened_positions)
        if not opened:
            raise HTTPException(
                status_code=400, detail="Сначала откройте хотя бы одну клетку"
            )

        multiplier = _mines_multiplier(game.mines_count, len(opened))
        payout = max(1, int(round(game.bet_stars * multiplier)))
        user.balance_stars += payout
        game.payout_stars = payout
        await _finish_mines(game, "won")
        _add_transaction(
            session,
            user,
            amount=payout,
            kind="mines_win",
            label="Мины: выигрыш",
            reference=f"mines:{game.id}",
        )
        result = _mines_state(game, user)

    return result


# ---------------------------------------------------------------- ракета


def _to_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _rocket_multiplier(elapsed: float) -> float:
    """Плавная кривая, совпадающая с визуальной анимацией на клиенте."""
    if elapsed <= 0:
        return 1.0
    return max(1.0, 6 * math.exp(ROCKET_GROWTH * elapsed) - 5)


def _rocket_state(game: RocketSession, user: User) -> dict:
    started = _to_utc(game.started_at)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    crash = game.crash_milli / 1000

    if game.status == "won":
        multiplier = (game.cashout_milli or 0) / 1000
        current = multiplier
    elif game.status in {"lost", "abandoned"}:
        multiplier = crash
        current = crash
    else:
        current = min(_rocket_multiplier(elapsed), crash)

    return {
        "session_id": game.id,
        "status": game.status,
        "bet_stars": game.bet_stars,
        "bet_ton": stars_to_ton(game.bet_stars),
        "multiplier": round(current, 2),
        # Точку падения показываем только после завершения партии.
        "crash_multiplier": round(crash, 2) if game.status != "active" else None,
        "payout_stars": game.payout_stars,
        "payout_ton": stars_to_ton(game.payout_stars),
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


class RocketStartRequest(BaseModel):
    telegram_id: int
    bet_stars: int = Field(ge=1, le=10_000_000)


@router.post("/rocket/start")
async def start_rocket(
    req: RocketStartRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)

        active_games = (
            await session.scalars(
                select(RocketSession).where(
                    RocketSession.user_id == user.id,
                    RocketSession.status == "active",
                )
            )
        ).all()
        for active in active_games:
            active.status = "abandoned"
            active.finished_at = datetime.now(timezone.utc)

        if user.balance_stars < req.bet_stars:
            raise HTTPException(status_code=400, detail="Недостаточно средств")

        user.balance_stars -= req.bet_stars
        _add_transaction(
            session,
            user,
            amount=-req.bet_stars,
            kind="rocket_bet",
            label="Ракетка: ставка",
        )

        # Распределение с постоянным RTP 95%: P(crash >= x) = RTP / x.
        # Точка падения никогда не раскрывается до завершения партии.
        roll = secrets.randbelow(1_000_000) / 1_000_000
        crash = min(ROCKET_MAX_MULTIPLIER, max(1.01, ROCKET_RTP / (1 - roll)))
        game = RocketSession(
            user_id=user.id,
            bet_stars=req.bet_stars,
            crash_milli=max(1010, int(round(crash * 1000))),
            status="active",
            payout_stars=0,
            started_at=datetime.now(timezone.utc),
        )
        session.add(game)
        await session.flush()

        result = _rocket_state(game, user)

    return result


class RocketCheckRequest(MinesActionRequest):
    pass


@router.post("/rocket/check")
async def check_rocket(
    req: RocketCheckRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        game = await session.scalar(
            select(RocketSession)
            .where(
                RocketSession.id == req.session_id,
                RocketSession.user_id == user.id,
            )
            .with_for_update()
        )
        if game is None:
            raise HTTPException(status_code=404, detail="Партия не найдена")

        state = _rocket_state(game, user)
        if game.status == "active" and state["multiplier"] >= game.crash_milli / 1000:
            game.status = "lost"
            game.finished_at = datetime.now(timezone.utc)
            state = _rocket_state(game, user)

    return state


@router.post("/rocket/cashout")
async def cashout_rocket(
    req: RocketCheckRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        game = await session.scalar(
            select(RocketSession)
            .where(
                RocketSession.id == req.session_id,
                RocketSession.user_id == user.id,
            )
            .with_for_update()
        )
        if game is None:
            raise HTTPException(status_code=404, detail="Партия не найдена")
        if game.status == "won":
            raise HTTPException(status_code=409, detail="Выигрыш уже забран")
        if game.status != "active":
            return _rocket_state(game, user)

        state = _rocket_state(game, user)
        if state["multiplier"] >= game.crash_milli / 1000:
            game.status = "lost"
            game.finished_at = datetime.now(timezone.utc)
            result = _rocket_state(game, user)
        else:
            multiplier = max(1.0, state["multiplier"])
            payout = max(1, int(round(game.bet_stars * multiplier)))
            user.balance_stars += payout
            game.payout_stars = payout
            game.cashout_milli = int(round(multiplier * 1000))
            game.status = "won"
            game.finished_at = datetime.now(timezone.utc)
            _add_transaction(
                session,
                user,
                amount=payout,
                kind="rocket_win",
                label="Ракетка: выигрыш",
                reference=f"rocket:{game.id}",
            )
            result = _rocket_state(game, user)

    return result


# ---------------------------------------------------------- зимняя шахта

SNOWFALL_TARGET = 8


def _snowfall_state(game: SnowfallSession, user: User) -> dict:
    return {
        "session_id": game.id,
        "status": game.status,
        "bet_stars": game.bet_stars,
        "bet_ton": stars_to_ton(game.bet_stars),
        "tool": {
            "name": game.tool_name,
            "emoji": game.tool_emoji,
            "rarity": game.tool_rarity,
            "durability": game.durability,
            "max_durability": game.max_durability,
        },
        "progress": game.progress,
        "target": game.target,
        "blocks": json.loads(game.block_data),
        "reward": {
            "kind": game.reward_kind,
            "name": game.reward_name,
            "emoji": game.reward_emoji,
            "stars": game.reward_stars,
            "inventory_id": game.inventory_id,
        } if game.status == "opened" else None,
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


class SnowfallRequest(BaseModel):
    telegram_id: int
    session_id: int | None = None
    bet_stars: int | None = Field(default=None, ge=1, le=10_000_000)


@router.get("/snowfall/current")
async def current_snowfall(
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(telegram_id, init_data)
    user = await _user_by_telegram_id(session, telegram_id)
    game = await session.scalar(
        select(SnowfallSession)
        .where(SnowfallSession.user_id == user.id, SnowfallSession.status.in_(["active", "chest"]))
        .order_by(SnowfallSession.id.desc())
    )
    return {"game": _snowfall_state(game, user) if game else None}


@router.post("/snowfall/start")
async def start_snowfall(
    req: SnowfallRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)
    if req.bet_stars is None:
        raise HTTPException(status_code=422, detail="Укажите ставку")

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        existing = await session.scalar(
            select(SnowfallSession).where(
                SnowfallSession.user_id == user.id,
                SnowfallSession.status.in_(["active", "chest"]),
            ).order_by(SnowfallSession.id.desc()).with_for_update()
        )
        if existing:
            return _snowfall_state(existing, user)
        if user.balance_stars < req.bet_stars:
            raise HTTPException(status_code=400, detail="Недостаточно средств")

        tool_roll = secrets.randbelow(1000)
        if tool_roll < 520:
            tool = SNOWFALL_TOOLS[0]
        elif tool_roll < 800:
            tool = SNOWFALL_TOOLS[1]
        elif tool_roll < 940:
            tool = SNOWFALL_TOOLS[2]
        elif tool_roll < 990:
            tool = SNOWFALL_TOOLS[3]
        else:
            tool = SNOWFALL_TOOLS[4]

        blocks = []
        for _ in range(SNOWFALL_TARGET):
            template = secrets.choice(SNOWFALL_BLOCKS)
            # A tiny bit of variation makes each block feel less like a static row.
            hp = template["hp"]
            blocks.append({**template, "hp": hp, "max_hp": hp, "destroyed": False})

        user.balance_stars -= req.bet_stars
        _add_transaction(
            session, user, amount=-req.bet_stars, kind="snowfall_bet",
            label="Зимняя шахта: ставка",
        )
        game = SnowfallSession(
            user_id=user.id,
            round_key=secrets.token_urlsafe(18),
            bet_stars=req.bet_stars,
            tool_name=tool["name"],
            tool_emoji=tool["emoji"],
            tool_rarity=tool["rarity"],
            durability=tool["durability"],
            max_durability=tool["durability"],
            progress=0,
            target=SNOWFALL_TARGET,
            block_data=json.dumps(blocks, ensure_ascii=False),
            status="active",
        )
        session.add(game)
        await session.flush()
        result = _snowfall_state(game, user)

    return result


@router.post("/snowfall/hit")
async def hit_snowfall(
    req: SnowfallRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)
    if req.session_id is None:
        raise HTTPException(status_code=422, detail="Партия не указана")
    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        game = await session.scalar(
            select(SnowfallSession).where(
                SnowfallSession.id == req.session_id,
                SnowfallSession.user_id == user.id,
            ).with_for_update()
        )
        if game is None:
            raise HTTPException(status_code=404, detail="Партия не найдена")
        if game.status != "active":
            raise HTTPException(status_code=409, detail="Раунд уже завершён")

        blocks = json.loads(game.block_data)
        block = next((item for item in blocks if not item["destroyed"]), None)
        if block is not None:
            game.durability -= 1
            block["hp"] -= 1
            if block["hp"] <= 0:
                block["hp"] = 0
                block["destroyed"] = True
                game.progress += 1
            game.block_data = json.dumps(blocks, ensure_ascii=False)

        if game.progress >= game.target or game.durability <= 0:
            game.status = "chest"
            game.finished_at = datetime.now(timezone.utc)
        result = _snowfall_state(game, user)

    return result


@router.post("/snowfall/open")
async def open_snowfall_chest(
    req: SnowfallRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)
    if req.session_id is None:
        raise HTTPException(status_code=422, detail="Сундук не указан")
    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        game = await session.scalar(
            select(SnowfallSession).where(
                SnowfallSession.id == req.session_id,
                SnowfallSession.user_id == user.id,
            ).with_for_update()
        )
        if game is None:
            raise HTTPException(status_code=404, detail="Сундук не найден")
        if game.status == "opened":
            return _snowfall_state(game, user)
        if game.status != "chest":
            raise HTTPException(status_code=409, detail="Сначала завершите раунд")

        gifts = (await session.scalars(select(Gift))).all()
        nft_gifts = [gift for gift in gifts if gift.is_nft]
        rare_gifts = [gift for gift in gifts if not gift.is_nft and gift.price_stars <= 250]
        full_run = game.progress >= game.target
        roll = secrets.randbelow(10_000)
        if full_run and nft_gifts and roll < 50:
            gift = secrets.choice(nft_gifts)
            item = InventoryItem(user_id=user.id, gift_id=gift.id)
            session.add(item)
            await session.flush()
            game.reward_kind = "nft"
            game.reward_name = gift.name
            game.reward_emoji = "💎"
            game.reward_stars = 0
            game.inventory_id = item.id
        elif game.progress >= 5 and rare_gifts and roll < 450:
            gift = secrets.choice(rare_gifts)
            item = InventoryItem(user_id=user.id, gift_id=gift.id)
            session.add(item)
            await session.flush()
            game.reward_kind = "gift"
            game.reward_name = gift.name
            game.reward_emoji = "🎁"
            game.reward_stars = 0
            game.inventory_id = item.id
        else:
            ratio = game.progress / max(1, game.target)
            payout = max(1, int(round(game.bet_stars * (0.12 + 0.88 * ratio))))
            user.balance_stars += payout
            game.reward_kind = "stars"
            game.reward_name = "Звёзды"
            game.reward_emoji = "⭐"
            game.reward_stars = payout
            _add_transaction(
                session, user, amount=payout, kind="snowfall_reward",
                label=f"Зимняя шахта: сундук ({game.progress}/{game.target})",
                reference=f"snowfall:{game.id}",
            )
        game.status = "opened"
        result = _snowfall_state(game, user)

    return result
