#!/usr/bin/env -S python3 -I
"""Regenerates src/hbc/apps.json and src/hbc/icons/ from each app's latest GitHub release.

Usage: tools/hbc/sync_apps.py   (set GITHUB_TOKEN to lift GitHub's anonymous rate limit)

Release zips are untrusted: each is downloaded into its own empty folder and only
meta.xml and icon.png are read from it, in memory. longDescriptionDraft fields in
apps.json are kept, since the page shows them in place of the meta.xml text.
"""

import json
import os
import struct
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

OWNER = "cmyksoda"
APPS = [
    "AM2R-GX",
    "ASCII-Odyssey",
    "Bird-and-Beans-GX",
    "empty-slot-creator",
    "Paper-Airplane-Chase-GX",
    "sdk-mii-demo",
    "vbcgx",
    "vectrexwii",
    "WiiCam",
    "WiiEAS",
]

# Tagged wii-homebrew but left off on purpose: no release or meta.xml yet, or servers.
# Channels (wii-channel, wii-forwarder) belong to the /wii-forwarders page instead.
EXCLUDED = {"Tanka", "BS-X-GX", "RiiTube-at-Home", "wiiradio-stream-bridge"}
CHANNEL_TOPICS = {"wii-channel", "wii-forwarder"}

MAX_MEMBER_SIZE = 1 << 20
SRC = Path(__file__).resolve().parents[2] / "src" / "hbc"


def fetch(url, accept="application/vnd.github+json"):
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "cmyksoda-sync"})
    # Only GitHub's API gets the token: release downloads redirect to another host.
    if url.startswith("https://api.github.com/") and (token := os.environ.get("GITHUB_TOKEN")):
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def api(path):
    return json.loads(fetch(f"https://api.github.com/{path}"))


def read_release_zip(url):
    """Returns (dirname, meta.xml bytes, icon.png bytes or None) from a release zip."""
    with tempfile.TemporaryDirectory(prefix="hbc-release-") as folder:
        archive = Path(folder) / "release.zip"
        archive.write_bytes(fetch(url, accept="application/octet-stream"))
        with zipfile.ZipFile(archive) as zf:
            names = zf.namelist()

            def member(name):
                if name not in names or zf.getinfo(name).file_size > MAX_MEMBER_SIZE:
                    return None
                return zf.read(name)

            metas = [n for n in names if n.lower().endswith("/meta.xml")]
            if not metas:
                raise SystemExit(f"no meta.xml in {url}")
            meta_name = min(metas, key=lambda n: (not n.startswith("apps/"), len(n)))
            app_dir = meta_name.rsplit("/", 1)[0]
            return app_dir.rsplit("/", 1)[-1], member(meta_name), member(f"{app_dir}/icon.png")


def parse_meta(data):
    """Reads meta.xml the way HBC does (xml.c: meta_parse): author wins over coder."""
    app = ET.fromstring(data)

    def text(tag):
        element = app.find(tag)
        return element.text if element is not None and element.text is not None else None

    return {
        "name": text("name"),
        "coder": text("author") or text("coder"),
        "version": text("version"),
        "shortDescription": text("short_description"),
        "longDescription": text("long_description"),
    }


def is_hbc_icon(png):
    """HBC shows an icon only when it is a 128 x 48 PNG (appentry.c, tex.c)."""
    return png is not None and png[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", png[16:24]) == (128, 48)


def main():
    data_file = SRC / "apps.json"
    old = {app["repo"]: app for app in json.loads(data_file.read_text())} if data_file.exists() else {}
    covered = set(json.loads((SRC / "metrics.json").read_text())["codepoints"]) | {ord("\n"), ord("\r")}
    icons = SRC / "icons"
    icons.mkdir(exist_ok=True)

    apps = []
    for repo in APPS:
        release = api(f"repos/{OWNER}/{repo}/releases/latest")
        asset = next(a for a in release["assets"] if a["name"].endswith(".zip"))
        dirname, meta, icon = read_release_zip(asset["browser_download_url"])

        app = {"repo": repo, "dirname": dirname, **parse_meta(meta)}
        if draft := old.get(repo, {}).get("longDescriptionDraft"):
            app["longDescriptionDraft"] = draft
        app["icon"] = is_hbc_icon(icon)
        if app["icon"]:
            (icons / f"{repo}.png").write_bytes(icon)
        app["source"] = f"https://github.com/{OWNER}/{repo}"
        app["download"] = asset["browser_download_url"]
        apps.append(app)
        print(f"{repo}: {app['version']}")

        text = "".join(value for value in app.values() if isinstance(value, str))
        if missing := sorted({ch for ch in text if ord(ch) not in covered}):
            print(f"note: {repo} uses characters the page's Droid Sans subset lacks: {missing}")

    data_file.write_text(json.dumps(apps, indent=2, ensure_ascii=False) + "\n")

    for r in api(f"users/{OWNER}/repos?per_page=100&type=owner"):
        topics = set(r["topics"])
        if "wii-homebrew" in topics and not topics & CHANNEL_TOPICS and not r["fork"] \
                and r["name"] not in {*APPS, *EXCLUDED}:
            print(f"note: {r['name']} is tagged wii-homebrew but isn't listed in APPS or EXCLUDED")


if __name__ == "__main__":
    sys.exit(main())
