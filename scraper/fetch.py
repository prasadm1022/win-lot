# SPDX-License-Identifier: Apache-2.0
"""Polite HTTP fetching with retries, the NLB cookie challenge and a resumable on-disk cache.

Cache layout: scraper/.cache/<YYYY-MM-DD>/<sha1(method+url+body)>.html
A run on the same day reuses every page already fetched, so an interrupted backfill resumes.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import time
from pathlib import Path

import requests

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 win-lot-research"
)
DELAY_SECONDS = 0.5
RETRIES = 4
CACHE_ROOT = Path(__file__).resolve().parent / ".cache"
HUMAN_COOKIE_RE = re.compile(r"setCookie\('human','([0-9a-f]+)'")


class Fetcher:
    def __init__(self, use_cache: bool = True, delay: float = DELAY_SECONDS):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.use_cache = use_cache
        self.delay = delay
        self.cache_dir = CACHE_ROOT / dt.date.today().isoformat()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.network_requests = 0

    def _cache_path(self, method: str, url: str, data: dict | None) -> Path:
        body = "&".join(f"{k}={v}" for k, v in sorted((data or {}).items()))
        key = hashlib.sha1(f"{method} {url} {body}".encode()).hexdigest()
        return self.cache_dir / f"{key}.html"

    def get(self, url: str) -> str:
        return self._fetch("GET", url, None)

    def post(self, url: str, data: dict) -> str:
        return self._fetch("POST", url, data)

    def _fetch(self, method: str, url: str, data: dict | None) -> str:
        path = self._cache_path(method, url, data)
        if self.use_cache and path.exists():
            return path.read_text(encoding="utf-8")
        text = self._fetch_network(method, url, data)
        path.write_text(text, encoding="utf-8")
        return text

    def _fetch_network(self, method: str, url: str, data: dict | None) -> str:
        last_error: Exception | None = None
        challenge_rounds = 0
        attempt = 0
        while attempt < RETRIES:
            time.sleep(self.delay)
            self.network_requests += 1
            try:
                resp = self.session.request(method, url, data=data, timeout=30)
                resp.raise_for_status()
                resp.encoding = resp.encoding or "utf-8"
                text = resp.text
            except requests.RequestException as exc:
                last_error = exc
                attempt += 1
                time.sleep(2 ** attempt)
                continue
            challenge = solve_cookie_challenge(text)
            if challenge and challenge_rounds < 3:
                # NLB: tiny JS page sets `human=<sha1>` then reloads. Send it and retry.
                self.session.cookies.set("human", challenge, domain=_host(url), path="/")
                challenge_rounds += 1
                continue
            return text
        raise RuntimeError(f"{method} {url} failed after {RETRIES} attempts: {last_error}")


def solve_cookie_challenge(text: str) -> str | None:
    """Return the `human` cookie value if `text` is the NLB challenge page, else None."""
    if len(text) > 5000:
        return None
    m = HUMAN_COOKIE_RE.search(text)
    return m.group(1) if m else None


def _host(url: str) -> str:
    return url.split("/")[2]
