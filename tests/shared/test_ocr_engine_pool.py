from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock

import pytest

from deploy.ocr.engine_pool import EnginePool, OCRBusy


def test_engines_are_independent_and_exclusive_with_parallel_requests():
    engines = [object(), object()]
    pool = EnginePool(engines, max_waiting=2)
    barrier, lock = Barrier(2), Lock()
    active, seen = set(), set()

    def run(_):
        with pool.borrow(timeout=2) as engine:
            with lock:
                assert id(engine) not in active
                active.add(id(engine))
                seen.add(id(engine))
            barrier.wait(timeout=2)
            with lock:
                active.remove(id(engine))

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(run, range(4)))
    assert seen == {id(engine) for engine in engines}
    assert not active


def test_full_queue_rejects_without_stealing_an_active_engine():
    engine = object()
    pool = EnginePool([engine], max_waiting=0)
    with pool.borrow(timeout=0) as active:
        with pytest.raises(OCRBusy, match="queue_full"), pool.borrow(timeout=0):
            pytest.fail("must reject while the engine is borrowed")
        assert active is engine
    with pool.borrow(timeout=0) as returned:
        assert returned is engine


def test_queue_timeout_and_inference_failure_release_capacity():
    pool = EnginePool([object()], max_waiting=1)
    with pool.borrow(timeout=0):
        for _ in range(3):
            with pytest.raises(OCRBusy, match="queue_timeout"), pool.borrow(timeout=0.001):
                pytest.fail("engine is still in use")
    with pytest.raises(RuntimeError), pool.borrow(timeout=0):
        raise RuntimeError("model failed")
    with pool.borrow(timeout=0):
        pass


def test_pool_rejects_duplicate_engine_instances():
    engine = object()
    with pytest.raises(ValueError, match="independent"):
        EnginePool([engine, engine], max_waiting=1)
