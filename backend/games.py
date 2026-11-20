"""Серверные игры: кейсы, мины и ракета.

Главный принцип: клиент присылает только действие (открыть кейс, открыть
клетку, забрать выигрыш), а все случайные числа, ставки и начисления считает
сервер. Поэтому результат нельзя подделать через консоль браузера.
"""

from __future__ import annotations

import math
import secrets
from datetime import datetime, timezone
from math import comb

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import STARS_PER_TON
from database import (
    InventoryItem,
    MinesSession,
    RocketSession,
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


# ---------------------------------------------------------------- кейсы

# Веса подобраны так, чтобы RTP каждого кейса был около 92%:
#   снежный: EV ≈ 4,60 TON при цене 5  → 92,1%
#   золотой: EV ≈ 7,36 TON при цене 8  → 92,0%
# Чем дороже приз, тем меньше его вес: дешёвые выпадают часто, дорогие — редко.
# Сумма весов в каждом кейсе ровно 10 000 (1 вес = 0,01%).
# При изменении цен или призов пересчитывайте веса, иначе RTP уедет.
CASES: list[dict] = [
    {
        "id": "snow",
        "title": "Снежный кейс",
        "price": 5,
        "box": "ice",
        "prizes": [
            {"id": "bag", "name": "Оранжевая сумка", "value": 142.76, "image": "bag.png", "emoji": "👜", "weight": 16},
            {"id": "ring", "name": "Золотое кольцо", "value": 48.79, "image": "ring.png", "emoji": "💍", "weight": 56},
            {"id": "helmet", "name": "Розовый мотошлем", "value": 43.1, "image": "helmet.png", "emoji": "🪖", "weight": 64},
            {"id": "bear", "name": "Плюшевый мишка", "value": 40.49, "image": "bear.png", "emoji": "🧸", "weight": 69},
            {"id": "potion", "name": "Любовное зелье", "value": 18.37, "image": "potion.png", "emoji": "🧪", "weight": 176},
            {"id": "vinyl", "name": "Проигрыватель", "value": 15.28, "image": "vinyl.png", "emoji": "📀", "weight": 218},
            {"id": "candle", "name": "Свеча-сердце", "value": 13.77, "image": "candle.png", "emoji": "🕯️", "weight": 247},
            {"id": "cocoa", "name": "Какао", "value": 6, "image": "cocoa.png", "emoji": "☕", "weight": 657},
            {"id": "snake", "name": "Новогодняя змея", "value": 5.39, "image": "snake.png", "emoji": "🐍", "weight": 746},
            {"id": "giftbox", "name": "Подарочная коробка", "value": 5.25, "image": "giftbox.png", "emoji": "🎁", "weight": 769},
            {"id": "numbers", "name": "Цифры 2025", "value": 5.23, "image": "numbers.png", "emoji": "🔢", "weight": 772},
            {"id": "stocking", "name": "Новогодний носок", "value": 5.18, "image": "stocking.png", "emoji": "🧦", "weight": 781},
            {"id": "ton-1", "name": "1 TON", "value": 1, "image": "ton.png", "emoji": "💎", "weight": 5429},
        ],
    },
    {
        "id": "gold",
        "title": "Золотой кейс",
        "price": 8,
        "box": "gold",
        "prizes": [
            {"id": "hand", "name": "Золотой жест", "value": 131.27, "image": "hand.png", "emoji": "🖖", "weight": 43},
            {"id": "watch", "name": "Золотые часы", "value": 68.68, "image": "watch.png", "emoji": "⌚", "weight": 78},
            {"id": "bear", "name": "Плюшевый мишка", "value": 40.49, "image": "bear.png", "emoji": "🧸", "weight": 126},
            {"id": "rose", "name": "Роза под колпаком", "value": 32.13, "image": "rose.png", "emoji": "🌹", "weight": 156},
            {"id": "locket", "name": "Золотой замочек", "value": 26.61, "image": "locket.png", "emoji": "💛", "weight": 185},
            {"id": "heels", "name": "Розовые туфли", "value": 25.41, "image": "heels.png", "emoji": "👠", "weight": 193},
            {"id": "cigar", "name": "Сигара", "value": 18.21, "image": "cigar.png", "emoji": "🚬", "weight": 261},
            {"id": "tophat", "name": "Цилиндр", "value": 11.49, "image": "tophat.png", "emoji": "🎩", "weight": 397},
            {"id": "gingerbread", "name": "Пряничное сердце", "value": 6.57, "image": "gingerbread.png", "emoji": "🍪", "weight": 659},
            {"id": "clover", "name": "Клевер", "value": 6.43, "image": "clover.png", "emoji": "🍀", "weight": 672},
            {"id": "cocoa", "name": "Какао", "value": 6, "image": "cocoa.png", "emoji": "☕", "weight": 716},
            {"id": "torch", "name": "Факел", "value": 5.22, "image": "torch.png", "emoji": "🔦", "weight": 813},
            {"id": "candycane", "name": "Леденец", "value": 5.15, "image": "candycane.png", "emoji": "🍭", "weight": 823},
            {"id": "ton-3", "name": "3 TON", "value": 3, "image": "ton.png", "emoji": "💎", "weight": 1345},
            {"id": "ton-2.5", "name": "2,5 TON", "value": 2.5, "image": "ton.png", "emoji": "💎", "weight": 1588},
            {"id": "ton-2", "name": "2 TON", "value": 2, "image": "ton.png", "emoji": "💎", "weight": 1945},
        ],
    },
]


def _case(case_id: str) -> dict:
    for case in CASES:
        if case["id"] == case_id:
            return case
    raise HTTPException(status_code=404, detail="Кейс не найден")


def _ton_to_stars(value: float) -> int:
    return max(1, int(round(value * STARS_PER_TON)))


def _draw_prize(case: dict) -> dict:
    roll = secrets.randbelow(TOTAL_WEIGHT)
    for prize in case["prizes"]:
        if roll < prize["weight"]:
            return prize
        roll -= prize["weight"]
    return case["prizes"][-1]


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

        user.balance_stars -= bet_stars
        _add_transaction(
            session,
            user,
            amount=-bet_stars,
            kind="case_bet",
            label=f"Кейс «{case['title']}»",
        )

        prize = _draw_prize(case)
        prize_stars = _ton_to_stars(prize["value"])
        # Приз идёт в инвентарь, а не сразу на баланс.
        session.add(
            InventoryItem(
                user_id=user.id,
                prize_name=prize["name"],
                prize_value_stars=prize_stars,
                prize_image_url=f"/prizes/{prize['image']}",
                prize_emoji=prize["emoji"],
            )
        )

    return {
        "case_id": case["id"],
        "case_title": case["title"],
        "prize": prize,
        "bet_stars": bet_stars,
        "bet_ton": stars_to_ton(bet_stars),
        "prize_stars": prize_stars,
        "prize_ton": stars_to_ton(prize_stars),
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
        "inventory_added": True,
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
