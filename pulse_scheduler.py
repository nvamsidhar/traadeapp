"""
Background auto-rebuild for the Market Pulse report.

Runs one daemon thread that:
  • on startup, builds once if the stored report is missing or not from today,
  • then rebuilds once per day shortly after the US close (default 17:00 local).

All the live sources (yfinance sectors + SPY quote + options-chain gamma, FINRA
darkpool, CNN fear/greed) are refreshed by each rebuild, so the page stays
current with no manual "Rebuild" click. Intraday, the page still polls
/api/pulse/live for SPY price + Fear & Greed between rebuilds.

Config (env vars):
  PULSE_AUTO_REBUILD = "0" to disable          (default on)
  PULSE_REBUILD_HOUR = local hour 0-23         (default 17)
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime

import pulse_builder

_CHECK_EVERY = 15 * 60  # re-check the clock every 15 minutes


def _report_is_from_today() -> bool:
    data = pulse_builder.load(None)
    if not data:
        return False
    built = (data.get("_built_at") or "")[:10]
    return built == datetime.now().strftime("%Y-%m-%d")


def _rebuild(reason: str) -> None:
    try:
        print(f"[pulse_scheduler] rebuilding ({reason})…")
        pulse_builder.save(pulse_builder.build(live=True))
    except Exception as exc:
        print(f"[pulse_scheduler] rebuild failed: {exc}")


def _loop(target_hour: int) -> None:
    # Fresh-on-boot: only if we don't already have today's report.
    if not _report_is_from_today():
        _rebuild("startup — stored report is stale")

    last_daily = datetime.now().strftime("%Y-%m-%d") if _report_is_from_today() else None
    while True:
        time.sleep(_CHECK_EVERY)
        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        if now.hour >= target_hour and last_daily != today:
            _rebuild(f"daily {target_hour:02d}:00 refresh")
            last_daily = today


def start_pulse_scheduler() -> None:
    if os.environ.get("PULSE_AUTO_REBUILD", "1") == "0":
        print("[pulse_scheduler] disabled (PULSE_AUTO_REBUILD=0)")
        return
    try:
        hour = int(os.environ.get("PULSE_REBUILD_HOUR", "17"))
    except ValueError:
        hour = 17
    t = threading.Thread(target=_loop, args=(hour,), daemon=True)
    t.start()
    print(f"[pulse_scheduler] running — auto-rebuild daily at {hour:02d}:00 local")
