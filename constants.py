from enum import StrEnum


# --- Unit Conversion Constants ---
METERS_PER_MILE: float = 1609.344
METERS_TO_FEET: float = 3.28084
MPS_TO_MPH: float = 2.23694


class Sport(StrEnum):
    RUNNING = "running"
    CYCLING = "cycling"
    SWIMMING = "swimming"
    MULTISPORT = "multisport"


class Intensity(StrEnum):
    WARM_UP = "warm up"
    ACTIVE = "active"
    RECOVERY = "recovery"
    REST = "rest"
    COOLDOWN = "cooldown"
