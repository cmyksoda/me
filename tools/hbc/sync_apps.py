#!/usr/bin/env -S python3 -I
"""Keeps src/hbc/apps.json and src/hbc/icons/ current with each app's latest GitHub release.

Usage: tools/hbc/sync_apps.py [--dry-run] [--repo OWNER/NAME ...] [--commit-message FILE]
(set GITHUB_TOKEN to lift GitHub's anonymous rate limit)

Apps are OWNER's repos tagged TOPIC, EXTRA_REPOS and any --repo. Release zips are untrusted:
each is downloaded into its own empty folder and only meta.xml and icon.png are read, in memory.
The page shows longDescriptionDraft over longDescription and the script never edits a draft, so
a longDescription that differs from meta.xml and has no draft is saved as one before it is replaced.
"""

import argparse
import difflib
import json
import os
import struct
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

OWNER = "cmyksoda"
TOPIC = "homebrew-app"
EXTRA_REPOS = ["quatric/GodModeWii"]

FIELD_ORDER = [
    "repo", "dirname", "name", "coder", "version", "shortDescription", "longDescription",
    "longDescriptionDraft", "icon", "source", "download",
]
MAX_MEMBER_SIZE = 1 << 20
MAX_NAMED_IN_MESSAGE = 3
SRC = Path(__file__).resolve().parents[2] / "src" / "hbc"
ICONS = SRC / "icons"


def fetch(url, accept="application/vnd.github+json"):
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "cmyksoda-sync"})
    # Only GitHub's API gets the token: release downloads redirect to another host.
    if url.startswith("https://api.github.com/") and (token := os.environ.get("GITHUB_TOKEN")):
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def api(path):
    return json.loads(fetch(f"https://api.github.com/{path}"))


def tagged_repos():
    """Full names of OWNER's repos that carry TOPIC (the user listing includes topics)."""
    names, page = [], 1
    while batch := api(f"users/{OWNER}/repos?per_page=100&type=owner&page={page}"):
        names += [r["full_name"] for r in batch if TOPIC in r["topics"]]
        page += 1
    return names


def latest_zip_asset(full_name):
    """The newest non-prerelease's first .zip asset, or None after printing why not."""
    try:
        release = api(f"repos/{full_name}/releases/latest")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        print(f"{full_name}: skipped, no published release")
        return None
    asset = next((a for a in release["assets"] if a["name"].endswith(".zip")), None)
    if asset is None:
        print(f"{full_name}: skipped, {release['tag_name']} has no .zip asset")
    return asset


def read_release_zip(url):
    """Returns (dirname, meta.xml bytes, icon.png bytes or None), or None without a usable meta.xml."""
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
                return None
            meta_name = min(metas, key=lambda n: (not n.startswith("apps/"), len(n)))
            app_dir = meta_name.rsplit("/", 1)[0]
            meta = member(meta_name)
            if meta is None:
                return None
            return app_dir.rsplit("/", 1)[-1], meta, member(f"{app_dir}/icon.png")


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


def read_app(full_name):
    """Returns (entry from the release, icon bytes or None), or None when the repo is skipped."""
    asset = latest_zip_asset(full_name)
    if asset is None:
        return None
    url = asset["browser_download_url"]
    try:
        release_zip = read_release_zip(url)
        meta = parse_meta(release_zip[1]) if release_zip else None
    except (zipfile.BadZipFile, ET.ParseError) as error:
        print(f"{full_name}: skipped, unreadable {asset['name']} ({error})")
        return None
    if meta is None:
        print(f"{full_name}: skipped, no usable meta.xml in {asset['name']}")
        return None

    dirname, _, icon = release_zip
    has_icon = is_hbc_icon(icon)
    entry = {
        "repo": full_name.split("/", 1)[1], "dirname": dirname, **meta, "icon": has_icon,
        "source": f"https://github.com/{full_name}", "download": url,
    }
    return entry, icon if has_icon else None


def merge(old, fresh):
    """Applies a release's fields to an entry, keeping the page's text if only apps.json had it."""
    entry = {**old, **fresh}
    old_text = old.get("longDescription")
    if "longDescriptionDraft" not in old and old_text not in (None, fresh["longDescription"]):
        entry["longDescriptionDraft"] = old_text
    known = {key: entry[key] for key in FIELD_ORDER if key in entry}
    return known | {key: value for key, value in entry.items() if key not in known}


def icon_differs(repo, icon):
    path = ICONS / f"{repo}.png"
    return icon is not None and (not path.exists() or path.read_bytes() != icon)


def commit_message(changed):
    """One lowercase line saying what the Homebrew Channel page lists after the change."""
    if len(changed) > MAX_NAMED_IN_MESSAGE:
        return f"the homebrew channel has {len(changed)} updated apps"
    labels = [" ".join(f"{e['name'] or e['dirname']} at {e['version']}".lower().split()) for e in changed]
    return "the homebrew channel has " + (", ".join(labels[:-1]) + " and " + labels[-1] if labels[:-1] else labels[0])


def warn_uncovered(entry, covered):
    text = "".join(value for value in entry.values() if isinstance(value, str))
    if missing := sorted({ch for ch in text if ord(ch) not in covered}):
        print(f"note: {entry['repo']} uses characters the page's Droid Sans subset lacks: {missing}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="print the apps.json diff and write nothing")
    parser.add_argument("--repo", action="append", default=[], metavar="OWNER/NAME",
                        help="also sync this repo, as if it had the topic")
    parser.add_argument("--commit-message", type=Path, metavar="FILE",
                        help="write a one-line commit message here when something changed")
    args = parser.parse_args()

    data_file = SRC / "apps.json"
    old_text = data_file.read_text()
    entries = {app["repo"]: app for app in json.loads(old_text)}
    covered = set(json.loads((SRC / "metrics.json").read_text())["codepoints"]) | {ord("\n"), ord("\r")}

    full_names = list(dict.fromkeys([*tagged_repos(), *EXTRA_REPOS, *args.repo]))
    synced, changed, icon_writes = set(), [], {}
    for full_name in full_names:
        if (app := read_app(full_name)) is None:
            continue
        fresh, icon = app
        repo = fresh["repo"]
        synced.add(repo)
        entry = merge(entries.get(repo, {}), fresh)
        if icon_differs(repo, icon):
            icon_writes[repo] = icon
        if entry != entries.get(repo) or repo in icon_writes:
            changed.append(entry)
            print(f"{repo}: {entries[repo]['version'] if repo in entries else 'new'} -> {entry['version']}")
        else:
            print(f"{repo}: unchanged at {entry['version']}")
        entries[repo] = entry
        warn_uncovered(entry, covered)

    for repo in sorted(set(entries) - synced, key=str.lower):
        print(f"note: {repo} stays as it is in apps.json (not synced this run)")

    new_text = json.dumps(sorted(entries.values(), key=lambda e: e["repo"].lower()), indent=2, ensure_ascii=False) + "\n"
    if args.dry_run:
        sys.stdout.writelines(difflib.unified_diff(
            old_text.splitlines(keepends=True), new_text.splitlines(keepends=True),
            "a/src/hbc/apps.json", "b/src/hbc/apps.json"))
        for repo, icon in icon_writes.items():
            print(f"would write src/hbc/icons/{repo}.png ({len(icon)} bytes)")
        return

    data_file.write_text(new_text)
    ICONS.mkdir(exist_ok=True)
    for repo, icon in icon_writes.items():
        (ICONS / f"{repo}.png").write_bytes(icon)
    if changed and args.commit_message:
        args.commit_message.write_text(commit_message(changed) + "\n")


if __name__ == "__main__":
    sys.exit(main())
