"""Where a US zip code is, and how far apart two places are.

The Trainer Registry's near-me search ranks Pro trainers by distance from the
person looking (`trainer_registry.rank_listings`). Both ends are a zip code --
the trainer's `trainers.zip_code`, the visitor's search box -- or, for the
visitor, the browser's own coordinates.

**The table is a file in the image, not a service.** `data/us_zip_centroids.csv`
is the Census Bureau's ZIP Code Tabulation Area centroids (2023 Gazetteer,
public domain), ~34,000 rows and under 1 MB, read once on first use. A
geocoding API would be a key to manage, a bill per search and an outage the
registry did not have before; a zip's centroid is as precise as "trainers near
me" needs.

**A zip the table does not know is not an error.** ZCTAs leave out PO-box-only
and some business zips, so a real trainer's zip can be missing. They are still
listed -- they just cannot be placed on the map, so they sort after the Pro
trainers who can (`rank_listings`).
"""
from __future__ import annotations

import csv
import math
import os
import re
from functools import lru_cache
from typing import Optional

_DATA = os.path.join(os.path.dirname(__file__), "data", "us_zip_centroids.csv")

_ZIP = re.compile(r"^(\d{5})(?:-?\d{4})?$")

EARTH_RADIUS_MILES = 3958.8

LatLon = tuple[float, float]


@lru_cache(maxsize=1)
def _centroids() -> dict[str, LatLon]:
    table: dict[str, LatLon] = {}
    with open(_DATA, newline="", encoding="utf-8") as f:
        for row in csv.reader(line for line in f if not line.startswith("#")):
            if len(row) == 3:
                table[row[0]] = (float(row[1]), float(row[2]))
    return table


def normalize_zip(raw: Optional[str]) -> Optional[str]:
    """The five-digit zip in "32601", "32601-1234" or "326011234", else None."""
    match = _ZIP.match((raw or "").strip())
    return match.group(1) if match else None


def zip_location(raw: Optional[str]) -> Optional[LatLon]:
    """The centroid of a zip code, or None when it is not one the table knows."""
    zip_code = normalize_zip(raw)
    return _centroids().get(zip_code) if zip_code else None


def valid_coordinates(lat: Optional[float], lon: Optional[float]) -> Optional[LatLon]:
    """A latitude/longitude pair from the browser, or None if it is not one."""
    if lat is None or lon is None:
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return (lat, lon)


def miles_between(a: LatLon, b: LatLon) -> float:
    """Great-circle distance in miles (haversine)."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(h)))
