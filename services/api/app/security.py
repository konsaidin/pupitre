"""Ограничение origins и доступ к встроенному серверу по токену сессии."""

import os
import secrets

from fastapi import Request
from fastapi.responses import JSONResponse

API_TOKEN = os.environ.get("PUPITRE_API_TOKEN", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "PUPITRE_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if origin.strip() and origin.strip() not in ("*", "null")
]
# file:// имеет opaque origin; без токена разрешать его нельзя.
if API_TOKEN:
    ALLOWED_ORIGINS.append("null")


async def check_access(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        return JSONResponse({"detail": "origin не разрешён"}, status_code=403)
    if API_TOKEN and request.method != "OPTIONS":
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        # HTMLAudioElement не умеет задавать Authorization. Query-токен
        # принимается только на чтение аудио, а не для изменения библиотеки.
        if not token and request.method in ("GET", "HEAD") and request.url.path.endswith(
            ("/instrumental", "/mix", "/vocal")
        ):
            token = request.query_params.get("token", "")
        if not secrets.compare_digest(token.encode(), API_TOKEN.encode()):
            return JSONResponse({"detail": "неверный токен сервера"}, status_code=401)
    return await call_next(request)
