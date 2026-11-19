"""Проверка подписи Telegram WebApp.

Без проверки `initData` клиент может прислать любой telegram_id и играть
от имени чужого аккаунта. Подпись проверяется по алгоритму из документации
Telegram: HMAC-SHA256 с ключом, производным от токена бота.

Переменные окружения:
- TELEGRAM_BOT_TOKEN — токен бота. Если не задан, проверка выключена (dev).
- ALLOW_DEV_AUTH — разрешить запросы без initData. По умолчанию 1, пока нет токена,
  и 0, если токен задан.
- TELEGRAM_AUTH_MAX_AGE — максимальный возраст initData в секундах (86400 = сутки).
"""

import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl

from fastapi import Header, HTTPException

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ALLOW_DEV_AUTH = os.getenv(
    "ALLOW_DEV_AUTH", "1" if not TELEGRAM_BOT_TOKEN else "0"
).strip().lower() in {"1", "true", "yes", "on"}
TELEGRAM_AUTH_MAX_AGE = int(os.getenv("TELEGRAM_AUTH_MAX_AGE", "86400"))

INIT_DATA_HEADER = "X-Telegram-Init-Data"


def get_init_data(
    x_telegram_init_data: str | None = Header(default=None, alias=INIT_DATA_HEADER),
) -> str | None:
    """Достаёт подписанные данные Telegram из заголовка запроса."""
    return x_telegram_init_data


def _validate_signature(init_data: str) -> dict:
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=500, detail="TELEGRAM_BOT_TOKEN не настроен")

    pairs = parse_qsl(init_data, keep_blank_values=True)
    data = dict(pairs)
    received_hash = data.pop("hash", "")
    if not received_hash:
        raise HTTPException(status_code=401, detail="В initData нет подписи")

    check_string = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
    secret_key = hmac.new(
        b"WebAppData", TELEGRAM_BOT_TOKEN.encode("utf-8"), hashlib.sha256
    ).digest()
    calculated_hash = hmac.new(
        secret_key, check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise HTTPException(status_code=401, detail="Неверная подпись Telegram")

    try:
        auth_date = int(data.get("auth_date", "0"))
    except ValueError:
        auth_date = 0
    if TELEGRAM_AUTH_MAX_AGE > 0 and time.time() - auth_date > TELEGRAM_AUTH_MAX_AGE:
        raise HTTPException(status_code=401, detail="Данные Telegram устарели, откройте приложение заново")

    try:
        user = json.loads(data.get("user", "{}"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=401, detail="Некорректный user в initData") from exc

    if not user.get("id"):
        raise HTTPException(status_code=401, detail="В initData нет пользователя")
    return user


def verify_telegram_id(requested_id: int, init_data: str | None) -> int:
    """Сверяет присланный telegram_id с подписью Telegram.

    Возвращает проверенный id. Если токен не настроен, пропускает запрос
    (локальная разработка). Если токен настроен, но initData нет — запрос
    отклоняется, кроме случая ALLOW_DEV_AUTH=1.
    """
    if not TELEGRAM_BOT_TOKEN:
        return requested_id

    if not init_data:
        if ALLOW_DEV_AUTH:
            return requested_id
        raise HTTPException(
            status_code=401,
            detail="Откройте приложение через Telegram: нет initData",
        )

    user = _validate_signature(init_data)
    authenticated_id = int(user["id"])
    if authenticated_id != int(requested_id):
        raise HTTPException(
            status_code=403,
            detail="telegram_id не совпадает с подписью Telegram",
        )
    return authenticated_id
