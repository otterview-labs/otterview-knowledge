"""Bounded pool: each OCR model instance belongs to one request at a time."""

from contextlib import contextmanager
from queue import Empty, Queue
from threading import BoundedSemaphore


class OCRBusy(Exception):
    pass


class EnginePool:
    def __init__(self, engines: list, max_waiting: int):
        if not engines or max_waiting < 0:
            raise ValueError("engines must be nonempty and max_waiting nonnegative")
        if len({id(engine) for engine in engines}) != len(engines):
            raise ValueError("each pool slot requires an independent engine")
        self.workers = len(engines)
        self.max_waiting = max_waiting
        self._engines = Queue(maxsize=self.workers)
        for engine in engines:
            self._engines.put(engine)
        self._admission = BoundedSemaphore(self.workers + max_waiting)

    @contextmanager
    def borrow(self, timeout: float):
        if not self._admission.acquire(blocking=False):
            raise OCRBusy("queue_full")
        engine = None
        try:
            try:
                engine = self._engines.get(timeout=timeout)
            except Empty as exc:
                raise OCRBusy("queue_timeout") from exc
            yield engine
        finally:
            if engine is not None:
                self._engines.put_nowait(engine)
            self._admission.release()
