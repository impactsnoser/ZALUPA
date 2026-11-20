"""Подключение к базе и модели.

В продакшене используется внешний Postgres (Neon, Supabase, Railway):
переменная DATABASE_URL вида postgresql://user:pass@host/db.

Локально без DATABASE_URL приложение падает обратно на SQLite, чтобы можно
было запускать тесты и разработку без установленного Postgres.
"""

import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
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
    UniqueConstraint,
    func,
    select,
    text,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from config import WELCOME_STARS

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
    # Подарок из каталога (для стартового подарка и апгрейда).
    gift_id: Mapped[int | None] = mapped_column(ForeignKey("gifts.id"), nullable=True)
    # Приз из кейса, которого нет в каталоге подарков.
    prize_name: Mapped[str | None] = mapped_column(String, nullable=True)
    prize_value_stars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prize_image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    prize_emoji: Mapped[str | None] = mapped_column(String, nullable=True)
    acquired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="inventory")
    gift: Mapped[Gift | None] = relationship()


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


class WalletTransaction(Base):
    """История движения единого баланса (в звёздах)."""

    __tablename__ = "wallet_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Положительная сумма — пополнение/выигрыш, отрицательная — ставка.
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    reference: Mapped[str | None] = mapped_column(String, nullable=True)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Payment(Base):
    """Счёт на пополнение: Telegram Stars или перевод TON."""

    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("payload", name="uq_payments_payload"),
        UniqueConstraint("external_id", name="uq_payments_external_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String, nullable=False)  # stars | ton
    amount_stars: Mapped[int] = mapped_column(Integer, nullable=False)
    # Для Stars — количество звёзд, для TON — нанотоны.
    amount_native: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    # payload счёта; для TON это же значение служит комментарием к переводу.
    payload: Mapped[str] = mapped_column(String, nullable=False)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class MinesSession(Base):
    """Серверная партия в «Мины»: клиент не знает, где мины."""

    __tablename__ = "mines_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    bet_stars: Mapped[int] = mapped_column(Integer, nullable=False)
    mines_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # Позиции храним строкой "1,7,13": так одинаково работает SQLite и Postgres.
    mine_positions: Mapped[str] = mapped_column(String, nullable=False)
    opened_positions: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    payout_stars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RocketSession(Base):
    """Серверная партия в «Ракетку»: точка падения задаётся на сервере."""

    __tablename__ = "rocket_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    bet_stars: Mapped[int] = mapped_column(Integer, nullable=False)
    crash_milli: Mapped[int] = mapped_column(Integer, nullable=False)
    cashout_milli: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    payout_stars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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


async def _migrate_inventory(connection) -> None:
    """Догоняем схему inventory для баз, созданных до появления призов из кейсов.

    create_all не меняет уже существующие таблицы, поэтому:
    * добавляем колонки prize_* для призов, которых нет в каталоге подарков;
    * снимаем NOT NULL с gift_id: у приза из кейса подарка нет.

    Без второго пункта вставка приза падает с ошибкой NOT NULL, и кейс
    «не открывается» (сервер отвечает 500).
    """
    if connection.dialect.name == "postgresql":
        await connection.execute(
            text(
                """
                ALTER TABLE inventory
                ADD COLUMN IF NOT EXISTS prize_name VARCHAR,
                ADD COLUMN IF NOT EXISTS prize_value_stars INTEGER,
                ADD COLUMN IF NOT EXISTS prize_image_url VARCHAR,
                ADD COLUMN IF NOT EXISTS prize_emoji VARCHAR
                """
            )
        )
        await connection.execute(
            text("ALTER TABLE inventory ALTER COLUMN gift_id DROP NOT NULL")
        )
        return

    # SQLite: ALTER TABLE не умеет IF NOT EXISTS — проверяем колонки вручную.
    rows = (await connection.execute(text("PRAGMA table_info(inventory)"))).all()
    existing = {row[1]: row for row in rows}
    for column, ddl in (
        ("prize_name", "VARCHAR"),
        ("prize_value_stars", "INTEGER"),
        ("prize_image_url", "VARCHAR"),
        ("prize_emoji", "VARCHAR"),
    ):
        if column not in existing:
            await connection.execute(
                text(f"ALTER TABLE inventory ADD COLUMN {column} {ddl}")
            )

    # В старых локальных базах gift_id объявлен NOT NULL. SQLite не умеет
    # менять ограничение через ALTER, поэтому пересобираем таблицу.
    gift_id = existing.get("gift_id")
    if gift_id is None or not gift_id[3]:
        return

    await connection.execute(text("DROP INDEX IF EXISTS ix_inventory_user_id"))
    await connection.execute(text("ALTER TABLE inventory RENAME TO inventory_legacy"))
    await connection.run_sync(lambda sync_conn: InventoryItem.__table__.create(sync_conn))
    columns = ", ".join(column.name for column in InventoryItem.__table__.columns)
    await connection.execute(
        text(f"INSERT INTO inventory ({columns}) SELECT {columns} FROM inventory_legacy")
    )
    await connection.execute(text("DROP TABLE inventory_legacy"))


async def init_db() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await _migrate_inventory(connection)


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
                    balance_stars=WELCOME_STARS,
                )
                session.add(user)
                await session.flush()
                session.add(
                    WalletTransaction(
                        user_id=user.id,
                        amount=WELCOME_STARS,
                        kind="welcome",
                        label="Приветственный баланс",
                        balance_after=WELCOME_STARS,
                    )
                )

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

            # Тестовому аккаунту из прошлой версии один раз выдаём стартовый
            # баланс: раньше поле balance_stars не использовалось.
            if user.balance_stars < WELCOME_STARS:
                history_count = await session.scalar(
                    select(func.count())
                    .select_from(WalletTransaction)
                    .where(WalletTransaction.user_id == user.id)
                )
                if history_count == 0:
                    user.balance_stars = WELCOME_STARS
                    session.add(
                        WalletTransaction(
                            user_id=user.id,
                            amount=WELCOME_STARS,
                            kind="welcome",
                            label="Стартовый баланс",
                            balance_after=WELCOME_STARS,
                        )
                    )


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def close_db() -> None:
    await engine.dispose()
