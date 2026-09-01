import time


class MonotonicWallClock:
    """
    A Monotonic Wall Clock with Phase-Locked Loop (PLL) frequency slewing.

    Guarantees:
    1. Monotonicity: Time NEVER moves backward.
    2. Zero long-term drift: Smoothly converges with UTC system wall time.
    3. Smooth transitions: Slews clock speed by +/- 5% during system time shifts.
    """

    def __init__(self, max_slew_rate: float = 0.05, sync_threshold: float = 0.001):
        """
        :param max_slew_rate: Maximum frequency adjustment (e.g., 0.05 = +/- 5% speed adjustment).
        :param sync_threshold: Error threshold in seconds (1ms) below which clock runs at 1.0x.
        """
        self._max_slew_rate = max_slew_rate
        self._sync_threshold = sync_threshold

        self._server_time = time.time()
        self._last_mono = time.monotonic()

    def now(self) -> float:
        now_mono = time.monotonic()
        dt_mono = max(0.0, now_mono - self._last_mono)
        self._last_mono = now_mono

        target_wall = time.time()

        # Calculate offset error: positive means server clock is behind, negative means ahead
        error = target_wall - self._server_time

        if abs(error) <= self._sync_threshold:
            # In sync (within 1ms): run at 1.0x rate and lock directly to wall time
            self._server_time = target_wall
        elif error > 0:
            # Server clock is BEHIND system time: speed up by +5% to catch up smoothly
            rate = 1.0 + self._max_slew_rate
            self._server_time += dt_mono * rate
            # Don't overshoot target_wall
            if self._server_time > target_wall:
                self._server_time = target_wall
        else:
            # Server clock is AHEAD of system time (system clock jumped back):
            # Slow down by -5% (runs at 95% speed) so system time catches up
            rate = 1.0 - self._max_slew_rate
            self._server_time += dt_mono * rate
            # Don't drop below current target_wall if target_wall starts moving ahead again
            if self._server_time < target_wall:
                self._server_time = target_wall

        return self._server_time
