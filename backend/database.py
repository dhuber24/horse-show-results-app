from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@db:5432/horseshow")

# Strip ssl/sslmode query params and pass ssl via connect_args for asyncpg compatibility
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
_parsed = urlparse(DATABASE_URL)
_params = {k: v for k, v in parse_qs(_parsed.query).items() if k not in ("ssl", "sslmode")}
_clean_url = urlunparse(_parsed._replace(query=urlencode(_params, doseq=True)))
_use_ssl = "neon.tech" in DATABASE_URL or os.getenv("DB_SSL", "false").lower() == "true"

engine = create_async_engine(
    _clean_url,
    echo=os.getenv("SQL_ECHO") == "true",
    connect_args={"ssl": True} if _use_ssl else {},
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
