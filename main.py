import random
import string

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import String, select, desc
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncAttrs, create_async_engine, async_sessionmaker, AsyncSession

DATABASE_URL = "postgresql+asyncpg://postgres:postgres@localhost:5432/test_db"

async_engine = create_async_engine(DATABASE_URL, echo=True)
async_session = async_sessionmaker(bind = async_engine, expire_on_commit=False)

class Base(AsyncAttrs, DeclarativeBase):
    __abstract__ = True

class RecordsORM(Base):
    __tablename__ = "records"
    id : Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name : Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    record : Mapped[int] = mapped_column(nullable=False)

async def create_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

from pydantic import BaseModel, Field
from typing import Annotated, Optional, List


class RecordsBase(BaseModel):
    name : Annotated[str, Field(..., min_length=3, max_length=255)]
    record : Annotated[int, Field(...)]

class Records(RecordsBase):
    id : int
    model_config = {
        "from_attributes" : True
    }

from contextlib import asynccontextmanager
@asynccontextmanager
async def lifespan(app : FastAPI):
    await create_tables()
    yield

app = FastAPI(lifespan=lifespan)

origins = [
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
rooms = {}

async def get_db():
    async with async_session() as session:
        yield session

def count_bulls_and_cows(secret: str, guess: str) -> list[int] | None:
    if len(secret) != len(guess):
        return None

    cows = sum(s == g for s, g in zip(secret, guess))
    secret_copy = list(secret)
    bulls = 0

    for ch in guess:
        if ch in secret_copy:
            bulls += 1
            secret_copy.remove(ch)

    return [bulls, cows]

class room_class:
    users : list[str]
    roles: dict[str, int]
    word : str | None
    attempts : int
    state: str
    restart_votes : int

    def __init__(self):
        self.users = []
        self.roles = {}
        self.word = None
        self.attempts = 0
        self.state = "waiting_word"
        self.restart_votes = 0

    def __repr__(self):
        return (f"<room_class users={len(self.users)} "
                f"roles={self.roles} word={self.word} "
                f"attempts={self.attempts} state={self.state} "
                f"restart_votes={self.restart_votes}>")

@app.get("/create_room")
async def create_room():
    while True:
        room_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
        if room_id not in rooms:
            break

    rooms[room_id] = room_class()
    return {"room_id": room_id}

@app.post("/get_records")
async def get_records(n : Optional[int] = None, db : AsyncSession = Depends(get_db)) -> List[Records]:
    if not n:
        data_from_database = await db.execute(select(RecordsORM))
    else:
        data_from_database = await db.execute(select(RecordsORM).limit(n))
    data_from_database_orm = data_from_database.scalars().all()
    dto = [Records.model_validate(record) for record in data_from_database_orm]
    return dto

@app.post("/create_record")
async def create_record(data : RecordsBase, db : AsyncSession = Depends(get_db)) -> Records:
    obj_for_db = RecordsORM(name = data.name, record = data.record)
    db.add(obj_for_db)
    try:
        await db.commit()
    except IntegrityError: 
        await db.rollback()
        raise HTTPException(status_code=400,
                            detail="Запись с таким name уже существует")
    await db.refresh(obj_for_db)
    return obj_for_db

@app.get("/best_record")
async def get_best_record(db : AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RecordsORM)
        .order_by(RecordsORM.record.asc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    print("-"*100)
    print("best_record")
    print("-"*100)
    print(record.record if record else None)
    return {
        "record": record.record if record else None
    }

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(ws : WebSocket, room_id: str):
    await ws.accept()

    if room_id not in rooms:
        await ws.send_json({
            "type": "error",
            "message": "Комната не существует. Создайте новую комнату."
        })
        await ws.close()
        return
    
    room : room_class = rooms[room_id]
    if len(room.users) == 2:
        await ws.send_json({
            "type": "error",
            "message": "Комната заполнена"
        })
        await ws.close()
        return
    
    room.users.append(ws)
    role = 1 if len(room.users) == 1 else 2
    room.roles[id(ws)] = role

    await ws.send_json({
        "type": "role",
        "role": role,
        "message": f"Вы пользователь {role}"
    })

    try:
        while True:
            msg = await ws.receive_text()
            role = room.roles[id(ws)]

            if len(room.users) == 2:
                if room.state == "waiting_word":
                    if role == 1:
                        room.word = msg.lower()
                        room.state = "playing"

                        await room.users[1].send_json({
                            "type": "length",
                            "length": len(room.word)
                        })

                        await ws.send_json({"type": "lock_input"})
                        await ws.send_json({"type": "info", "message": "Слово сохранено. Игра началась."})
                    elif role == 2:
                        if room.word is None:
                            await ws.send_json({
                                "type": "info",
                                "message": "Ждем пока первый пользователь задаст слово"
                            })
                            continue
                elif room.state == "playing" and role == 2:
                    room.attempts += 1
                    data = count_bulls_and_cows(room.word, msg.lower())
                    if data is None:
                        for client in room.users:
                            await client.send_json({
                                "type": "info",
                                "message": f"Слово {msg.lower()} не содержит {len(room.word)} букв"
                            })
                    else:
                        for client in room.users:
                            await client.send_json({
                                "type": "attempt",
                                "n": room.attempts,
                                "word": msg,
                                "bulls": data[0],
                                "cows": data[1]
                            })
                        if msg.lower() == room.word:
                            room.state = "finished"
                            for client in room.users:
                                await client.send_json({"type": "win", "attempts": room.attempts})
            else:
                for client in room.users:
                    await client.send_json({
                        "type": "info",
                        "message": "Дождитесь подключения второго пользователя"
                    })
    except WebSocketDisconnect:
        temp_role = room.roles[id(ws)]
        room.users.remove(ws)
        if not room.users:
            del rooms[room_id]
        else:
            for client in room.users:
                await client.send_json({
                    "type": "info",
                    "message": f"Пользователь {temp_role} отключился"
                })