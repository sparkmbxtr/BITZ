"""Publish a committed monitoring snapshot using GitHub's short-lived OIDC.

Run only from the existing private journal workflow. No scientific integration,
stored publisher key, password, or watchdog acknowledgement is performed here.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://spark.bioengineering.workers.dev/api/nucleosome-progress"


def read_snapshot(root):
    candidates = list(Path(root).glob("sync/payloads/spark-monitor-*/progress.json"))
    if not candidates:
        raise ValueError("No committed cloud observation is available")
    snapshots = []
    for path in candidates:
        raw = path.read_bytes()
        if len(raw) > 100_000:
            raise ValueError("Snapshot exceeds the monitoring size limit")
        value = json.loads(raw)
        observed = dt.datetime.fromisoformat(value["information_updated_at"].replace("Z", "+00:00"))
        if observed.tzinfo is None:
            raise ValueError("Observation timestamp requires a timezone")
        snapshots.append((observed, path, value, hashlib.sha256(raw).hexdigest()))
    return max(snapshots, key=lambda item: item[0])


def fetch_json(url, method="GET", token=None, payload=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    raw = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    if raw is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=raw, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Monitoring {method} failed with HTTP {error.code}") from None


def main():
    observed, path, snapshot, digest = read_snapshot(".")
    # A GitHub run never refreshes the scientific observation timestamp.
    snapshot["source_revision"] = os.environ["GITHUB_SHA"]
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    url += ("&" if "?" in url else "?") + urllib.parse.urlencode({"audience": "nucleosome-progress"})
    identity = fetch_json(url, token=os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"])["value"]
    print("::add-mask::" + identity)
    result = fetch_json(ENDPOINT, method="PUT", token=identity, payload=snapshot)
    saved = fetch_json(ENDPOINT, token=identity)
    expected = sum(job["step"] for job in snapshot["jobs"])
    if (not result.get("published") or saved.get("total_steps") != expected
            or saved.get("information_updated_at") != snapshot["information_updated_at"]
            or any(saved.get(key) != snapshot.get(key) for key in
                   ("jobs", "stages", "runtime_observation", "compute_rate", "watchdog_armed"))):
        raise RuntimeError("Monitoring readback differs from the committed snapshot")
    print(json.dumps({"published": True, "readback_verified": True, "saved_steps": expected,
                      "cloud_observed_at": observed.isoformat(), "source_path": str(path), "sha256": digest}))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf8") as stream:
            stream.write(f"Verified protected dashboard update: **{expected:,} saved steps**.\n\nCloud observed: {observed.isoformat()}.\n\nSnapshot SHA256: `{digest}`.\n\nCommit: `{os.environ['GITHUB_SHA']}`.\n")


if __name__ == "__main__":
    main()
