"""Limit repeated failed logins, per email + IP.

After MAX_ATTEMPTS failed logins within WINDOW_SECONDS (counted from the first
one), that email + IP is blocked until the window ends, even with the right
password. A successful login clears the count.

Counts live in this process's memory: they reset when the server restarts and
aren't shared between worker processes. That's fine for one server; a bigger
deployment would keep them in Redis instead. See docs/deploy-notes.md.
"""

import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60

LimitKey = tuple[str, str]  # (lowercased email, client IP)


@dataclass
class _Window:
    started: float
    attempts: int = 0


class LoginLimiter:
    def __init__(
        self,
        max_attempts: int = MAX_ATTEMPTS,
        window_seconds: int = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.clock = clock  # tests swap this for a fake clock
        self._windows: dict[LimitKey, _Window] = {}
        self._lock = threading.Lock()  # sync endpoints run on several threads

    def hit(self, key: LimitKey) -> int:
        """Count a login attempt. Returns 0 if it may go ahead, else seconds to wait.

        Attempts are counted *before* the password is checked, all under the lock,
        so a burst of parallel requests can't slip extra guesses past the limit.
        """
        with self._lock:
            now = self.clock()
            self._drop_expired(now)
            window = self._windows.setdefault(key, _Window(started=now))
            if window.attempts >= self.max_attempts:
                return max(1, math.ceil(window.started + self.window_seconds - now))
            window.attempts += 1
            return 0

    def reset(self, key: LimitKey | None = None) -> None:
        """Clear one email + IP (after a successful login), or everything (tests)."""
        with self._lock:
            if key is None:
                self._windows.clear()
            else:
                self._windows.pop(key, None)

    def _drop_expired(self, now: float) -> None:
        # Keeps memory bounded to the pairs seen in the last WINDOW_SECONDS.
        expired = [k for k, w in self._windows.items() if now - w.started >= self.window_seconds]
        for k in expired:
            del self._windows[k]


login_limiter = LoginLimiter()
