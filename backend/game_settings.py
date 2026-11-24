"""Shared live settings that shape server-authoritative game outcomes."""

from sqlalchemy.ext.asyncio import AsyncSession

from database import AppSetting

GLOBAL_RETURN_FACTOR_KEY = "global_return_factor"
MIN_GLOBAL_RETURN_FACTOR = 0.5
MAX_GLOBAL_RETURN_FACTOR = 1.0
DEFAULT_GLOBAL_RETURN_FACTOR = 0.8


async def get_global_return_factor(session: AsyncSession) -> float:
    setting = await session.get(AppSetting, GLOBAL_RETURN_FACTOR_KEY)
    try:
        value = float(setting.value) if setting else DEFAULT_GLOBAL_RETURN_FACTOR
    except (TypeError, ValueError):
        value = DEFAULT_GLOBAL_RETURN_FACTOR
    return round(max(MIN_GLOBAL_RETURN_FACTOR, min(MAX_GLOBAL_RETURN_FACTOR, value)), 2)
