"""Настройки приложения из переменных окружения.

Все значения читаются один раз при старте процесса. В Railway переменные
задаются в Settings → Variables сервиса ZALUPA.
"""

import hashlib
import os


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)).replace(",", "."))
    except (TypeError, ValueError):
        return default


TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()

# Сколько внутренних звёзд даёт 1 TON. Внутренняя валюта — звёзды (целые),
# TON показывается как пересчёт. Меняется без правок кода.
STARS_PER_TON = max(1, _env_int("STARS_PER_TON", 100))

# Приветственный баланс новому игроку.
WELCOME_STARS = max(0, _env_int("WELCOME_STARS", 1000))

# Пополнение TON: адрес кошелька проекта и API для проверки переводов.
TON_DEPOSIT_ADDRESS = os.getenv("TON_DEPOSIT_ADDRESS", "").strip()
TONCENTER_BASE = os.getenv("TONCENTER_BASE", "https://toncenter.com/api/v2").strip()
TONCENTER_API_KEY = os.getenv("TONCENTER_API_KEY", "").strip()
TON_DEPOSIT_TTL_SECONDS = max(300, _env_int("TON_DEPOSIT_TTL_SECONDS", 3600))
MIN_TON_DEPOSIT = _env_float("MIN_TON_DEPOSIT", 0.5)
MAX_TON_DEPOSIT = _env_float("MAX_TON_DEPOSIT", 1000)

# Публичный адрес бэкенда. На Railway переменная RAILWAY_PUBLIC_DOMAIN
# появляется автоматически, если у сервиса есть домен.
def _public_base_url() -> str:
    explicit = os.getenv("PUBLIC_BASE_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    return f"https://{domain}" if domain else ""


PUBLIC_BASE_URL = _public_base_url()

# Секрет вебхука. Telegram присылает его в заголовке
# X-Telegram-Bot-Api-Secret-Token. Если не задан, выводим стабильный
# из токена бота — тогда он не меняется между редеплоями.
_webhook_secret_env = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
TELEGRAM_WEBHOOK_SECRET = _webhook_secret_env or (
    hashlib.sha256(TELEGRAM_BOT_TOKEN.encode("utf-8")).hexdigest()[:48]
    if TELEGRAM_BOT_TOKEN
    else ""
)

TELEGRAM_WEBHOOK_DISABLED = os.getenv("TELEGRAM_WEBHOOK_DISABLED", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

MIN_STARS_DEPOSIT = max(1, _env_int("MIN_STARS_DEPOSIT", 1))
MAX_STARS_DEPOSIT = max(MIN_STARS_DEPOSIT, _env_int("MAX_STARS_DEPOSIT", 10000))
