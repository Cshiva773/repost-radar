"""Builds eval/manifest.json: CC0 photos from Wikimedia Commons for the phase 3 evaluation.

Run once and commit the output; `make eval` only reads the manifest, so results are reproducible.
Originals and negatives share themes on purpose: a different beach photo is the hard case.

  python eval/build_manifest.py --originals-per-theme 10 --negatives-per-theme 100
"""

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "repost-radar/0.1 (https://github.com/Cshiva773/repost-radar; eval manifest builder)"
THEME_LIST = [
    "mountain", "beach", "dog", "cat", "street", "food", "flower", "bird", "bridge", "forest",
    "church", "car", "lake", "sunset", "insect", "building", "river", "horse", "boat", "waterfall",
]
SEARCH_SCOPES = [
    "incategory:Quality_images incategory:CC-Zero filetype:bitmap",  # preferred: reviewed photos
    "incategory:CC-Zero filetype:bitmap",                              # fallback when a theme runs dry
]
PAGE_SIZE = 50
MIN_WIDTH_PX = 1000
THUMB_WIDTH_PX = 1024
REQUEST_PAUSE_SECONDS = 0.5


def search_page(search_text: str, page_offset: int) -> list[dict]:
    query_params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
        "gsrlimit": str(PAGE_SIZE), "gsroffset": str(page_offset), "gsrsearch": search_text,
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": str(THUMB_WIDTH_PX),
        "iiextmetadatafilter": "LicenseShortName|Artist",
    }
    request = urllib.request.Request(f"{COMMONS_API}?{urllib.parse.urlencode(query_params)}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        page_pages = json.load(response).get("query", {}).get("pages", {})
    return sorted(page_pages.values(), key=lambda page: page.get("index", 0))


def to_entry(page: dict, theme: str) -> dict | None:
    image_info = (page.get("imageinfo") or [{}])[0]
    extended_metadata = image_info.get("extmetadata", {})
    license_name = extended_metadata.get("LicenseShortName", {}).get("value", "")
    if image_info.get("mime") != "image/jpeg" or not license_name.upper().startswith("CC0"):
        return None
    if image_info.get("width", 0) < MIN_WIDTH_PX or not image_info.get("thumburl"):
        return None
    artist_html = extended_metadata.get("Artist", {}).get("value", "")
    artist_text = urllib.parse.unquote("".join(artist_html.split("<")[0::1])).strip()
    return {
        "title": page["title"].removeprefix("File:"),
        "theme": theme,
        "pageUrl": image_info.get("descriptionurl"),
        "downloadUrl": image_info["thumburl"],
        "license": license_name,
        "artist": _strip_tags(artist_html)[:80] or artist_text[:80],
    }


def _strip_tags(html_text: str) -> str:
    plain_text, inside_tag = [], False
    for character in html_text:
        if character == "<":
            inside_tag = True
        elif character == ">":
            inside_tag = False
        elif not inside_tag:
            plain_text.append(character)
    return " ".join("".join(plain_text).split())


def collect_theme(theme: str, wanted_count: int, seen_titles: set[str]) -> list[dict]:
    entry_list: list[dict] = []
    for search_scope in SEARCH_SCOPES:
        page_offset = 0
        while len(entry_list) < wanted_count and page_offset < 1000:
            page_list = search_page(f"{search_scope} {theme}", page_offset)
            if not page_list:
                break
            for page in page_list:
                entry = to_entry(page, theme)
                if entry and entry["title"] not in seen_titles and len(entry_list) < wanted_count:
                    seen_titles.add(entry["title"])
                    entry_list.append(entry)
            page_offset += PAGE_SIZE
            time.sleep(REQUEST_PAUSE_SECONDS)
        if len(entry_list) >= wanted_count:
            break
    return entry_list


def main() -> None:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--originals-per-theme", type=int, default=10)
    argument_parser.add_argument("--negatives-per-theme", type=int, default=100)
    argument_parser.add_argument("--out", type=Path, default=Path(__file__).with_name("manifest.json"))
    argument_parser.add_argument("--exclude", type=Path, default=Path(__file__).parent / "seed" / "manifest.json",
                                 help="manifest whose titles must not be reused (the demo seed set)")
    parsed_arguments = argument_parser.parse_args()

    seen_titles = {entry["title"] for entry in json.loads(parsed_arguments.exclude.read_text(encoding="utf-8"))} if parsed_arguments.exclude.exists() else set()
    original_list, negative_list = [], []
    for theme in THEME_LIST:
        theme_entry_list = collect_theme(theme, parsed_arguments.originals_per_theme + parsed_arguments.negatives_per_theme, seen_titles)
        original_list.extend(theme_entry_list[: parsed_arguments.originals_per_theme])
        negative_list.extend(theme_entry_list[parsed_arguments.originals_per_theme:])
        print(f"{theme:<10} {len(theme_entry_list):>4} images")

    manifest_details = {
        "builtAt": time.strftime("%Y-%m-%d"),
        "source": "Wikimedia Commons, CC0 only",
        "originals": [{"evalId": f"orig-{index:03d}", **entry} for index, entry in enumerate(original_list, start=1)],
        "negatives": [{"evalId": f"neg-{index:04d}", **entry} for index, entry in enumerate(negative_list, start=1)],
    }
    parsed_arguments.out.write_text(json.dumps(manifest_details, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(original_list)} originals and {len(negative_list)} negatives to {parsed_arguments.out}")


if __name__ == "__main__":
    main()
