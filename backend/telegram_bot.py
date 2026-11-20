"""Минимальная обёртка над Telegram Bot API.

Нужна для счетов Telegram Stars и настройки вебхука. Без TELEGRAM_BOT_TOKEN
все функции бросают понятную ошибку — приложение продолжает работать,
просто пополнение звёздами недоступно.
"""

from __future__ import annotations

import logging

import httpx

from config import TELEGRAM_BOT_TOKEN

log = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
TIMEOUT = 20.0


class BotApiError(RuntimeError):
    """Ошибка Telegram Bot API с человекочитаемым текстом."""


async def _call(method: str, payload: dict) -> dict:
    if not TELEGRAM_BOT_TOKEN:
        raise BotApiError(
            "TELEGRAM_BOT_TOKEN не настроен: пополнение через Telegram Stars недоступно."
        )

    url = f"{API_BASE}/bot{TELEGRAM_BOT_TOKEN}/{method}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        log.error("Telegram Bot API %s: сеть недоступна: %s", method, exc)
        raise BotApiError("Telegram недоступен, попробуйте ещё раз позже.") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise BotApiError("Telegram вернул некорректный ответ.") from exc

    if not data.get("ok"):
        description = data.get("description") or f"HTTP {response.status_code}"
        log.error("Telegram Bot API %s: %s", method, description)
        raise BotApiError(f"Telegram: {description}")

    return data.get("result")


async def create_stars_invoice_link(
    *, title: str, description: str, payload: str, stars: int
) -> str:
    """Создаёт ссылку на счёт в Telegram Stars (валюта XTR)."""
    result = await _call(
        "createInvoiceLink",
        {
            "title": title,
            "description": description,
            "payload": payload,
            "currency": "XTR",
            "prices": [{"label": "Пополнение баланса", "amount": stars}],
        },
    )
    if not isinstance(result, str) or not result:
        raise BotApiError("Telegram не вернул ссылку на счёт.")
    return result


async def answer_pre_checkout_query(query_id: str, ok: bool, error_message: str = "") -> None:
    payload: dict = {"pre_checkout_query_id": query_id, "ok": ok}
    if not ok and error_message:
        payload["error_message"] = error_message
    await _call("answerPreCheckoutQuery", payload)


async def set_webhook(url: str, secret_token: str) -> None:
    await _call(
        "setWebhook",
        {
            "url": url,
            "secret_token": secret_token,
            "allowed_updates": ["message", "pre_checkout_query"],
            "drop_pending_updates": False,
        },
    )


async def delete_webhook() -> None:
    await _call("deleteWebhook", {"drop_pending_updates": False})
