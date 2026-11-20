"""Подключение к базе и модели.

В продакшене используется внешний Postgres (Neon, Supabase, Railway):
переменная DATABASE_URL вида postgresql://user:pass@host/db.

Локально без DATABASE_URL приложение падает обратно на SQLite, чтобы можно
было запускать тесты и разработку без установленного Postgres.
"""

import os
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
    select,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

TEST_TELEGRAM_ID = 123456789


def _normalize_url(raw: str) -> str:
    """Приводит строку подключения к формату SQLAlchemy async."""
    url = raw.strip()

    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    elif url.startswith("sqlite:///") and not url.startswith("sqlite+aiosqlite:///"):
        url = "sqlite+aiosqlite:///" + url[len("sqlite:///") :]

    # asyncpg ждёт ssl=... и не понимает channel_binding из Neon/Supabase.
    if url.startswith("postgresql+asyncpg://"):
        base, separator, query = url.partition("?")
        if separator:
            params = dict(parse_qsl(query))
            if "sslmode" in params:
                params["ssl"] = params.pop("sslmode")
            params.pop("channel_binding", None)
            url = base + "?" + urlencode(params)

    return url


def _database_url() -> str:
    raw = os.getenv("DATABASE_URL", "").strip()
    if raw:
        return _normalize_url(raw)

    # На Railway без DATABASE_URL лучше упасть сразу, чем тихо писать в
    # эфемерный SQLite и потерять данные при следующем деплое.
    if any(
        os.getenv(name)
        for name in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_ID")
    ):
        raise RuntimeError(
            "DATABASE_URL не задан. Подключите внешний Postgres и добавьте "
            "переменную DATABASE_URL в настройках сервиса."
        )

    sqlite_path = (Path(__file__).parent / "app.db").as_posix()
    return f"sqlite+aiosqlite:///{sqlite_path}"


DATABASE_URL = _database_url()

_engine_kwargs: dict = {"pool_pre_ping": True}
if DATABASE_URL.startswith("postgresql"):
    _engine_kwargs.update(pool_size=5, max_overflow=5)

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(
        BigInteger, unique=True, index=True, nullable=False
    )
    username: Mapped[str | None] = mapped_column(String, nullable=True)
    balance_stars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    inventory: Mapped[list["InventoryItem"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Gift(Base):
    __tablename__ = "gifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price_stars: Mapped[int] = mapped_column(Integer, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_nft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class InventoryItem(Base):
    __tablename__ = "inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    gift_id: Mapped[int] = mapped_column(ForeignKey("gifts.id"), nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="inventory")
    gift: Mapped[Gift] = relationship()


class Upgrade(Base):
    __tablename__ = "upgrades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    from_gift_id: Mapped[int] = mapped_column(ForeignKey("gifts.id"), nullable=False)
    to_gift_id: Mapped[int] = mapped_column(ForeignKey("gifts.id"), nullable=False)
    chance: Mapped[float] = mapped_column(Float, nullable=False)
    is_win: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


SEED_GIFTS = [
    # name, price_stars, image_url, is_nft
    ("Мишка", 15, "https://example.com/img/bear.png", False),
    ("Сердце", 25, "https://example.com/img/heart.png", False),
    ("Подарок", 50, "https://example.com/img/gift.png", False),
    ("Роза", 100, "https://example.com/img/rose.png", False),
    ("Торт", 250, "https://example.com/img/cake.png", True),
    ("Кубок", 500, "https://example.com/img/cup.png", True),
]


async def init_db() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def seed_db() -> None:
    """Идемпотентный seed: заполняет только пустые таблицы."""
    async with SessionLocal() as session:
        async with session.begin():
            gifts_count = await session.scalar(
                select(func.count()).select_from(Gift)
            )
            if gifts_count == 0:
                session.add_all(
                    [
                        Gift(
                            name=name,
                            price_stars=price,
                            image_url=image,
                            is_nft=is_nft,
                        )
                        for name, price, image, is_nft in SEED_GIFTS
                    ]
                )
                await session.flush()

            user = await session.scalar(
                select(User).where(User.telegram_id == TEST_TELEGRAM_ID)
            )
            if user is None:
                user = User(
                    telegram_id=TEST_TELEGRAM_ID,
                    username="test_user",
                    balance_stars=100,
                )
                session.add(user)
                await session.flush()

            inventory_count = await session.scalar(
                select(func.count())
                .select_from(InventoryItem)
                .where(InventoryItem.user_id == user.id)
            )
            if inventory_count == 0:
                cheapest = await session.scalar(
                    select(Gift).order_by(Gift.price_stars.asc()).limit(1)
                )
                if cheapest is not None:
                    session.add(
                        InventoryItem(user_id=user.id, gift_id=cheapest.id)
                    )


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def close_db() -> None:
    await engine.dispose()
