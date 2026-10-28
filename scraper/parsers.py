"""HTML parsers for NLB and DLB result pages (ported 1:1 to worker/src/parsers.ts).

Every parser returns raw rows: {draw_no, draw_date, letter, numbers, extra}
where `numbers` is every main-ball integer in page order and `extra` holds anything else
(e.g. NLB "Super Number", Dhana "Sunday Bonus"). `normalize()` maps a raw row onto the
lottery's format (letter, main numbers, bonus).
"""
from __future__ import annotations

import datetime as dt
import re

from bs4 import BeautifulSoup

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def parse_nlb_date(text: str) -> str:
    """'Tuesday October 27, 2026' -> '2026-10-27'."""
    m = re.search(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", text)
    if not m:
        raise ValueError(f"unparseable NLB date: {text!r}")
    month = MONTHS[m.group(1)[:3].lower()]
    return dt.date(int(m.group(3)), month, int(m.group(2))).isoformat()


def parse_dlb_date(text: str) -> str:
    """'2026-Oct-15 Thursday' -> '2026-10-15'."""
    m = re.search(r"(\d{4})-([A-Za-z]{3})-(\d{1,2})", text)
    if not m:
        raise ValueError(f"unparseable DLB date: {text!r}")
    return dt.date(int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3))).isoformat()


def parse_nlb(html: str) -> list[dict]:
    """Rows of the NLB results table (`table.tbl`)."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.select_one("table.tbl")
    if table is None:
        return []
    rows = []
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 2 or tds[0].b is None:
            continue
        draw_no = int(tds[0].b.get_text(strip=True))
        draw_date = parse_nlb_date(tds[0].get_text(" ", strip=True))
        letter, numbers, extra = None, [], {}
        lists = tds[1].find_all("ol", class_="B")
        for li in lists[0].find_all("li") if lists else []:
            title = (li.get("title") or "").strip()
            value = li.get_text(strip=True)
            if title == "Letter":
                letter = value
            elif title.startswith("Number-"):
                numbers.append(int(value))
            elif value:
                extra[title] = int(value) if value.isdigit() else value
        for ol in lists[1:]:
            span = ol.find_previous_sibling("span")
            label = span.get_text(strip=True) if span else "Extra"
            extra[label] = [int(li.get_text(strip=True)) for li in ol.find_all("li")
                            if li.get_text(strip=True).isdigit()]
        rows.append(dict(draw_no=draw_no, draw_date=draw_date, letter=letter,
                         numbers=numbers, extra=extra))
    return rows


def parse_dlb_page(html: str) -> list[dict]:
    """Rows of a DLB `result/pagination_re` fragment."""
    soup = BeautifulSoup(f"<table>{html}</table>", "lxml")
    rows = []
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 3:
            continue
        head = tds[0].get_text(" ", strip=True)
        m = re.match(r"(\d+)\s*\|\s*(.+)", head)
        if not m:
            continue
        letter, numbers, extra = None, [], {}
        for li in tds[2].find_all("li"):
            cls = " ".join(li.get("class") or [])
            value = li.get_text(strip=True)
            if not value:
                continue
            if "letter" in cls:
                letter = value
            elif "res_number" in cls:
                numbers.append(int(value))
            else:
                extra[cls or "other"] = value
        rows.append(dict(draw_no=int(m.group(1)), draw_date=parse_dlb_date(m.group(2)),
                         letter=letter, numbers=numbers, extra=extra))
    return rows


def parse_dlb_latest(html: str) -> dict[str, dict]:
    """Latest draw of every lottery on a DLB `/result/<id>/` page, keyed by DLB lottery id.

    Also returns the `resultID` needed for `pagination_re` under key 'result_id'.
    """
    out: dict[str, dict] = {}
    for block in html.split("lot_main_result")[1:]:
        rid = re.search(r'id="resultID(\d+)"\s+value="(\d+)"', block)
        head = re.search(r"Draw Number - (\d+)\s*\|\s*([^<]+)", block)
        if not rid or not head:
            continue
        letter, numbers = None, []
        for cls, value in re.findall(r'<h6 class="([^"]*)"[^>]*>\s*([^<]*?)\s*</h6>', block):
            if not value:
                continue
            if "letter" in cls:
                letter = value
            elif value.isdigit():
                numbers.append(int(value))
        out[rid.group(1)] = dict(draw_no=int(head.group(1)), draw_date=parse_dlb_date(head.group(2)),
                                 letter=letter, numbers=numbers, extra={}, result_id=rid.group(2))
    return out


def normalize(lottery: dict, raw: dict) -> dict | None:
    """Map a raw row to {draw_no, draw_date, letter, numbers, bonus}; None if malformed."""
    numbers = list(raw["numbers"])
    bonus = None
    lid = lottery["id"]
    if lid == "mega-power":
        bonus = raw["extra"].get("Super Number")
    elif lid == "kapruka":
        if len(numbers) == lottery["main_count"] + 1:
            bonus = numbers.pop()
    elif lid == "dhana-nidhanaya":
        digits = raw["extra"].get("Sunday Bonus")
        if digits:
            bonus = {"label": "Sunday Bonus", "digits": digits}
    if len(numbers) != lottery["main_count"]:
        return None
    if lottery["letter_kind"] != "none" and not raw["letter"]:
        return None
    letter = raw["letter"].upper() if raw["letter"] else None
    return dict(draw_no=raw["draw_no"], draw_date=raw["draw_date"], letter=letter,
                numbers=numbers, bonus=bonus)
