import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).parents[1] / "scripts/publish-nucleosome-progress.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class WslEvidenceTests(unittest.TestCase):
    def test_requires_original_wsl_proof_and_never_retimes_old_presence(self):
        now = dt.datetime.now(dt.timezone.utc)
        at = (now - dt.timedelta(minutes=20)).isoformat()
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "sync/payloads/wsl-relay-presence-fixture/presence.json"
            p.parent.mkdir(parents=True)
            value = {"schema_version": 1, "producer": "original-wsl-catchup", "thread": "fixture-original-thread",
                     "kernel_release": "example-microsoft-standard-WSL2", "observed_utc": at,
                     "connected": True, "watchdog_ACK": False, "hostname": "private-machine"}
            p.write_text(json.dumps(value))
            self.assertIsNone(publisher.read_wsl_connection(directory, "other-thread", now))
            self.assertIsNone(publisher.read_wsl_connection(directory, None, now))
            result = publisher.read_wsl_connection(directory, "fixture-original-thread", now)
            self.assertEqual(result["last_seen_at"], at)
            self.assertNotIn("private", json.dumps(result))
            value["kernel_release"] = "ordinary-cloud-linux"
            p.write_text(json.dumps(value))
            self.assertIsNone(publisher.read_wsl_connection(directory, "fixture-original-thread", now))
            value["kernel_release"] = "microsoft-WSL2"
            value["observed_utc"] = (now + dt.timedelta(hours=1)).isoformat()
            p.write_text(json.dumps(value))
            self.assertIsNone(publisher.read_wsl_connection(directory, "fixture-original-thread", now))

if __name__ == "__main__":
    unittest.main()
