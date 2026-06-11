"""Human-readable size string helpers shared by cluster status/queries code.

StarRocks SHOW commands return sizes as strings like "256.78 GB"; these helpers
convert between those strings and byte counts.
"""

from __future__ import annotations

SIZE_UNITS = {
    "b": 1,
    "kb": 1024,
    "mb": 1024**2,
    "gb": 1024**3,
    "tb": 1024**4,
    "pb": 1024**5,
}


def parse_size_bytes(s: str) -> float:
    """Convert a size string like '256.78 GB' to bytes (float)."""
    s = s.strip()
    for unit, factor in sorted(SIZE_UNITS.items(), key=lambda x: -x[1]):
        if s.lower().endswith(unit):
            try:
                return float(s[: -len(unit)].strip()) * factor
            except ValueError:
                return 0.0
    # Assume bytes if no unit
    try:
        return float(s)
    except ValueError:
        return 0.0


def bytes_to_human(total_bytes: float) -> str:
    """Convert bytes to a human-readable string (up to PB)."""
    for unit in ("PB", "TB", "GB", "MB", "KB"):
        divisor = SIZE_UNITS[unit.lower()]
        if total_bytes >= divisor:
            return f"{total_bytes / divisor:.2f} {unit}"
    return f"{int(total_bytes)} B"
