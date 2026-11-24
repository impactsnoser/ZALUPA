"""Единый кошелёк: баланс, пополнение Stars/TON, история операций.

Внутренняя валюта — звёзды (целые числа). TON — это второй способ
пополнения и альтернативное отображение того же баланса по курсу
STARS_PER_TON. Благодаря этому баланс один, а не два независимых.
"""

from __future__ import annotations

import base64
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import telegram_bot
from config import (
    ADMIN_IDS,
    MAX_STARS_DEPOSIT,
    MAX_TON_DEPOSIT,
    MIN_STARS_DEPOSIT,
    MIN_TON_DEPOSIT,
    PUBLIC_BASE_URL,
    STARS_PER_TON,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_DISABLED,
    TELEGRAM_WEBHOOK_SECRET,
    TONCENTER_API_KEY,
    TONCENTER_BASE,
    TON_DEPOSIT_ADDRESS,
    TON_DEPOSIT_TTL_SECONDS,
)
from database import Payment, User, WalletTransaction, get_session
from telegram_auth import get_init_data, verify_telegram_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

WEBHOOK_PATH = "/telegram/webhook"


# ---------------------------------------------------------------- модели API


class StarsDepositRequest(BaseModel):
    telegram_id: int
    stars: int = Field(ge=MIN_STARS_DEPOSIT, le=MAX_STARS_DEPOSIT)


class TonDepositRequest(BaseModel):
    telegram_id: int
    ton: float = Field(ge=MIN_TON_DEPOSIT, le=MAX_TON_DEPOSIT)


class TonCheckRequest(BaseModel):
    telegram_id: int
    payment_id: int


class TonConnectDepositRequest(BaseModel):
    telegram_id: int
    amount: float = Field(ge=MIN_TON_DEPOSIT, le=MAX_TON_DEPOSIT)


class SpendRequest(BaseModel):
    telegram_id: int
    amount_stars: int = Field(ge=1, le=10_000_000)
    label: str = Field(default="Игра", max_length=120)


class CreditRequest(BaseModel):
    telegram_id: int
    amount_stars: int = Field(ge=1, le=10_000_000)
    label: str = Field(default="Выигрыш", max_length=120)


# ---------------------------------------------------------------- помощники


def stars_to_ton(stars: int) -> float:
    return round(stars / STARS_PER_TON, 2)


def _tx_dict(tx: WalletTransaction) -> dict:
    return {
        "id": tx.id,
        "amount_stars": tx.amount,
        "amount_ton": round(tx.amount / STARS_PER_TON, 2),
        "kind": tx.kind,
        "label": tx.label,
        "balance_after": tx.balance_after,
        "created_at": tx.created_at,
    }


async def _user_by_telegram_id(
    session: AsyncSession, telegram_id: int, *, lock: bool = False
) -> User:
    statement = select(User).where(User.telegram_id == telegram_id)
    if lock:
        statement = statement.with_for_update()
    user = await session.scalar(statement)
    if user is None:
        raise HTTPException(
            status_code=404,
            detail="Пользователь не найден. Откройте приложение заново.",
        )
    return user


def _add_transaction(
    session: AsyncSession,
    user: User,
    *,
    amount: int,
    kind: str,
    label: str | None,
    reference: str | None = None,
) -> None:
    session.add(
        WalletTransaction(
            user_id=user.id,
            amount=amount,
            kind=kind,
            label=label,
            reference=reference,
            balance_after=user.balance_stars,
        )
    )


async def _credit_payment(
    session: AsyncSession, payment: Payment, external_id: str | None
) -> None:
    """Зачисляет оплаченный счёт ровно один раз."""
    if payment.status == "paid":
        return

    user = await session.scalar(
        select(User).where(User.id == payment.user_id).with_for_update()
    )
    if user is None:
        log.error("Платёж %s: пользователь %s не найден", payment.id, payment.user_id)
        return

    user.balance_stars += payment.amount_stars
    payment.status = "paid"
    payment.paid_at = datetime.now(timezone.utc)
    if external_id:
        payment.external_id = external_id

    label = (
        f"Пополнение Telegram Stars: {payment.amount_stars} ⭐"
        if payment.provider == "stars"
        else f"Пополнение TON: {payment.amount_native / 1_000_000_000:g} ◆"
    )
    _add_transaction(
        session,
        user,
        amount=payment.amount_stars,
        kind=f"deposit_{payment.provider}",
        label=label,
        reference=payment.payload,
    )


def _is_expired(payment: Payment) -> bool:
    created = payment.created_at
    if created is None:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created > timedelta(seconds=TON_DEPOSIT_TTL_SECONDS)


def _decode_comment(value: str) -> str:
    """TON-комментарии в toncenter бывают base64-строкой."""
    text = value.strip()
    if not text:
        return ""
    try:
        decoded = base64.b64decode(text, validate=True).decode("utf-8")
        if decoded.isprintable():
            return decoded.strip()
    except (ValueError, UnicodeDecodeError):
        pass
    return text


def _message_comment(message: dict) -> str:
    for key in ("message", "text"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return _decode_comment(value)
    msg_data = message.get("msg_data") or {}
    value = msg_data.get("text")
    if isinstance(value, str):
        return _decode_comment(value)
    return ""


async def _find_ton_transfer(
    address: str, comment: str, min_nano: int, created_ts: int
) -> dict | None:
    params: dict = {"address": address, "limit": 50}
    if TONCENTER_API_KEY:
        params["api_key"] = TONCENTER_API_KEY

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{TONCENTER_BASE}/getTransactions", params=params)
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.error("toncenter: %s", exc)
        raise HTTPException(
            status_code=502, detail="Не удалось проверить блокчейн TON. Попробуйте позже."
        ) from exc

    if not payload.get("ok"):
        error = payload.get("error") or payload.get("result") or "неизвестная ошибка"
        log.error("toncenter: %s", error)
        raise HTTPException(status_code=502, detail=f"TON API: {error}")

    for tx in payload.get("result") or []:
        in_msg = tx.get("in_msg") or {}
        if not in_msg:
            continue

        tx_comment = _message_comment(in_msg)
        if tx_comment != comment:
            continue

        try:
            value = int(str(in_msg.get("value", "0")))
        except ValueError:
            continue
        if value < int(min_nano * 0.99):
            continue

        try:
            utime = int(tx.get("utime") or 0)
        except (TypeError, ValueError):
            utime = 0
        if utime and utime < created_ts - 300:
            continue

        tx_hash = (tx.get("transaction_id") or {}).get("hash")
        return {"hash": str(tx_hash) if tx_hash else None, "value": value}

    return None


# ---------------------------------------------------------------- баланс


@router.get("/wallet/{telegram_id}")
async def get_wallet(
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(telegram_id, init_data)
    user = await _user_by_telegram_id(session, telegram_id)

    transactions = (
        await session.scalars(
            select(WalletTransaction)
            .where(WalletTransaction.user_id == user.id)
            .order_by(WalletTransaction.id.desc())
            .limit(25)
        )
    ).all()
    activity_count = await session.scalar(
        select(func.count(WalletTransaction.id)).where(
            WalletTransaction.user_id == user.id,
            WalletTransaction.amount < 0,
        )
    )

    return {
        "telegram_id": user.telegram_id,
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
        "stars_per_ton": STARS_PER_TON,
        "ton_deposit_enabled": bool(TON_DEPOSIT_ADDRESS),
        "ton_address": TON_DEPOSIT_ADDRESS or None,
        "is_admin": bool(user.is_admin or user.telegram_id in ADMIN_IDS),
        "activity_count": int(activity_count or 0),
        "transactions": [_tx_dict(tx) for tx in transactions],
    }


@router.post("/wallet/spend")
async def spend(
    req: SpendRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Списывает ставку с баланса (для клиентских игр)."""
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        if user.balance_stars < req.amount_stars:
            raise HTTPException(status_code=400, detail="Недостаточно средств")
        user.balance_stars -= req.amount_stars
        _add_transaction(
            session,
            user,
            amount=-req.amount_stars,
            kind="bet",
            label=req.label,
        )

    return {
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


@router.post("/wallet/credit")
async def credit(
    req: CreditRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Зачисляет выигрыш на баланс (для клиентских игр)."""
    verify_telegram_id(req.telegram_id, init_data)

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id, lock=True)
        user.balance_stars += req.amount_stars
        _add_transaction(
            session,
            user,
            amount=req.amount_stars,
            kind="win",
            label=req.label,
        )

    return {
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
    }


# ---------------------------------------------------------------- Telegram Stars


@router.post("/wallet/deposit/stars")
async def deposit_stars(
    req: StarsDepositRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Пополнение звёздами не настроено: на сервере нет TELEGRAM_BOT_TOKEN.",
        )

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id)
        payment = Payment(
            user_id=user.id,
            provider="stars",
            amount_stars=req.stars,
            amount_native=req.stars,
            status="pending",
            payload=f"stars_{req.telegram_id}_{secrets.token_hex(8)}",
        )
        session.add(payment)
        await session.flush()
        payment_data = {
            "id": payment.id,
            "payload": payment.payload,
        }

    try:
        invoice_link = await telegram_bot.create_stars_invoice_link(
            title="Пополнение NEXORA",
            description=f"{req.stars} ⭐ на единый баланс",
            payload=payment_data["payload"],
            stars=req.stars,
        )
    except telegram_bot.BotApiError as exc:
        async with session.begin():
            failed = await session.get(Payment, payment_data["id"])
            if failed is not None:
                failed.status = "failed"
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "payment_id": payment_data["id"],
        "invoice_link": invoice_link,
        "stars": req.stars,
        "amount_ton": stars_to_ton(req.stars),
    }


@router.post(WEBHOOK_PATH)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Вебхук Telegram: подтверждение оплаты и зачисление звёзд.

    Вызывается самим Telegram, без initData, поэтому проверяется секретный
    заголовок, который мы задали при setWebhook.
    """
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_TOKEN не настроен")

    if TELEGRAM_WEBHOOK_SECRET and not (
        x_telegram_bot_api_secret_token
        and hmac.compare_digest(
            x_telegram_bot_api_secret_token, TELEGRAM_WEBHOOK_SECRET
        )
    ):
        raise HTTPException(status_code=403, detail="Неверный секрет вебхука")

    try:
        update = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректный JSON") from exc

    pre_checkout = update.get("pre_checkout_query")
    if isinstance(pre_checkout, dict):
        query_id = pre_checkout.get("id")
        invoice_payload = pre_checkout.get("invoice_payload", "")
        payment = await session.scalar(
            select(Payment).where(Payment.payload == invoice_payload)
        )
        ok = payment is not None and payment.status == "pending"
        try:
            await telegram_bot.answer_pre_checkout_query(
                str(query_id),
                ok,
                "Счёт не найден или уже оплачен." if not ok else "",
            )
        except telegram_bot.BotApiError as exc:
            log.warning("answerPreCheckoutQuery: %s", exc)
        return {"ok": True}

    message = update.get("message") or update.get("edited_message")
    successful_payment = (message or {}).get("successful_payment")
    if isinstance(successful_payment, dict):
        invoice_payload = successful_payment.get("invoice_payload", "")
        charge_id = successful_payment.get("telegram_payment_charge_id")
        currency = successful_payment.get("currency")
        total_amount = int(successful_payment.get("total_amount") or 0)

        if currency != "XTR":
            log.warning("Неожиданная валюта платежа: %s", currency)

        async with session.begin():
            payment = await session.scalar(
                select(Payment)
                .where(Payment.payload == invoice_payload)
                .with_for_update()
            )
            if payment is None:
                log.error("Платёж с payload %s не найден", invoice_payload)
            elif total_amount and total_amount != payment.amount_native:
                log.error(
                    "Платёж %s: сумма %s не совпадает с ожидаемой %s",
                    payment.id,
                    total_amount,
                    payment.amount_native,
                )
            else:
                await _credit_payment(session, payment, charge_id)

    return {"ok": True}


# ---------------------------------------------------------------- TON


def _ton_payment_dict(payment: Payment) -> dict:
    created = payment.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    expires = (
        created + timedelta(seconds=TON_DEPOSIT_TTL_SECONDS)
        if created is not None
        else None
    )
    return {
        "payment_id": payment.id,
        "address": TON_DEPOSIT_ADDRESS,
        "comment": payment.payload,
        "amount_ton": round(payment.amount_native / 1_000_000_000, 4),
        "amount_nano": payment.amount_native,
        "amount_stars": payment.amount_stars,
        "expires_at": expires,
    }


@router.post("/wallet/deposit/ton")
async def deposit_ton(
    req: TonDepositRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    if not TON_DEPOSIT_ADDRESS:
        raise HTTPException(
            status_code=503,
            detail=(
                "Пополнение TON ещё не настроено: добавьте TON_DEPOSIT_ADDRESS "
                "в переменные сервиса."
            ),
        )

    amount_nano = int(round(req.ton * 1_000_000_000))
    amount_stars = max(1, int(round(req.ton * STARS_PER_TON)))

    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id)
        payment = Payment(
            user_id=user.id,
            provider="ton",
            amount_stars=amount_stars,
            amount_native=amount_nano,
            status="pending",
            payload=f"nx{secrets.token_hex(6)}",
        )
        session.add(payment)
        await session.flush()
        result = _ton_payment_dict(payment)

    return result


@router.post("/deposits")
async def create_tonconnect_deposit(
    req: TonConnectDepositRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    """Create a TON transfer request for TON Connect; auth is bound to signed initData."""
    verify_telegram_id(req.telegram_id, init_data)
    if not TON_DEPOSIT_ADDRESS:
        raise HTTPException(status_code=503, detail="TON_DEPOSIT_ADDRESS не настроен")
    amount_nano = int(round(req.amount * 1_000_000_000))
    amount_stars = max(1, int(round(req.amount * STARS_PER_TON)))
    deposit_id = f"nx{secrets.token_hex(12)}"
    async with session.begin():
        user = await _user_by_telegram_id(session, req.telegram_id)
        payment = Payment(
            user_id=user.id,
            provider="ton",
            amount_stars=amount_stars,
            amount_native=amount_nano,
            status="pending",
            payload=deposit_id,
        )
        session.add(payment)
        await session.flush()
        payment_id = payment.id
    # TON text comment cell: 32-bit zero opcode followed by UTF-8 deposit id.
    from tonsdk.boc import begin_cell
    comment_boc = begin_cell().store_uint(0, 32).store_string(deposit_id).end_cell().to_boc(False).hex()
    return {
        "depositId": str(payment_id),
        "transaction": {
            "network": "-239",
            "validUntil": int((datetime.now(timezone.utc) + timedelta(seconds=TON_DEPOSIT_TTL_SECONDS)).timestamp()),
            "messages": [{"address": TON_DEPOSIT_ADDRESS, "amount": str(amount_nano), "payload": base64.b64encode(bytes.fromhex(comment_boc)).decode("ascii")}],
        },
        "comment": deposit_id,
        "amountNano": str(amount_nano),
        "amountStars": amount_stars,
    }


@router.get("/deposits/{deposit_id}")
async def get_tonconnect_deposit(
    deposit_id: str,
    telegram_id: int,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(telegram_id, init_data)
    try:
        payment_id = int(deposit_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Депозит не найден") from exc
    payment = await session.scalar(select(Payment).where(
        Payment.id == payment_id, Payment.provider == "ton",
        Payment.user_id.in_(select(User.id).where(User.telegram_id == telegram_id)),
    ))
    if payment is None:
        raise HTTPException(status_code=404, detail="Депозит не найден")
    if payment.status == "paid":
        return {"status": "credited", "balance_stars": (await _user_by_telegram_id(session, telegram_id)).balance_stars}
    if payment.status == "pending" and _is_expired(payment):
        payment.status = "expired"
        await session.commit()
        return {"status": "expired"}
    created = payment.created_at
    if created and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    transfer = await _find_ton_transfer(TON_DEPOSIT_ADDRESS, payment.payload, payment.amount_native, int(created.timestamp()) if created else 0)
    if transfer:
        payment = await session.get(Payment, payment_id, with_for_update=True)
        if payment and payment.status == "pending":
            await _credit_payment(session, payment, transfer["hash"])
            await session.commit()
        user = await _user_by_telegram_id(session, telegram_id)
        return {"status": "credited", "balance_stars": user.balance_stars}
    return {"status": "pending"}


@router.post("/wallet/deposit/ton/check")
async def check_ton_deposit(
    req: TonCheckRequest,
    session: AsyncSession = Depends(get_session),
    init_data: str | None = Depends(get_init_data),
):
    verify_telegram_id(req.telegram_id, init_data)

    payment = await session.scalar(
        select(Payment).where(
            Payment.id == req.payment_id,
            Payment.provider == "ton",
            Payment.user_id.in_(
                select(User.id).where(User.telegram_id == req.telegram_id)
            ),
        )
    )
    if payment is None:
        raise HTTPException(status_code=404, detail="Счёт не найден")

    user = await _user_by_telegram_id(session, req.telegram_id)
    if payment.status == "paid":
        return {
            "status": "paid",
            "balance_stars": user.balance_stars,
            "balance_ton": stars_to_ton(user.balance_stars),
            "amount_ton": round(payment.amount_native / 1_000_000_000, 4),
            "amount_stars": payment.amount_stars,
        }

    if payment.status == "pending" and _is_expired(payment):
        async with session.begin():
            payment.status = "expired"
        return {"status": "expired", "balance_stars": user.balance_stars}

    if not TON_DEPOSIT_ADDRESS:
        raise HTTPException(status_code=503, detail="Пополнение TON не настроено")

    created = payment.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    created_ts = int(created.timestamp()) if created else 0

    transfer = await _find_ton_transfer(
        TON_DEPOSIT_ADDRESS, payment.payload, payment.amount_native, created_ts
    )
    if transfer is None:
        return {
            "status": "pending",
            "balance_stars": user.balance_stars,
            "balance_ton": stars_to_ton(user.balance_stars),
        }

    payment = await session.get(Payment, req.payment_id, with_for_update=True)
    if payment is not None and payment.status != "paid":
        await _credit_payment(session, payment, transfer["hash"])
        await session.commit()
        user = await _user_by_telegram_id(session, req.telegram_id)

    return {
        "status": "paid",
        "balance_stars": user.balance_stars,
        "balance_ton": stars_to_ton(user.balance_stars),
        "amount_ton": round(payment.amount_native / 1_000_000_000, 4)
        if payment is not None
        else None,
        "amount_stars": payment.amount_stars if payment is not None else None,
    }


# ---------------------------------------------------------------- настройка


async def configure_webhook() -> None:
    """Регистрирует вебхук при старте, чтобы оплата Stars доходила сама."""
    if TELEGRAM_WEBHOOK_DISABLED:
        log.info("Вебхук Telegram отключён через TELEGRAM_WEBHOOK_DISABLED")
        return
    if not TELEGRAM_BOT_TOKEN:
        log.warning("TELEGRAM_BOT_TOKEN не задан: оплата Stars и вебхук недоступны")
        return
    if not PUBLIC_BASE_URL:
        log.warning(
            "Публичный адрес бэкенда неизвестен: задайте PUBLIC_BASE_URL, "
            "иначе вебхук Telegram не настроится автоматически"
        )
        return

    url = f"{PUBLIC_BASE_URL}/api{WEBHOOK_PATH}"
    try:
        await telegram_bot.set_webhook(url, TELEGRAM_WEBHOOK_SECRET)
        log.info("Вебхук Telegram установлен: %s", url)
    except telegram_bot.BotApiError as exc:
        log.error("Не удалось установить вебхук Telegram: %s", exc)
