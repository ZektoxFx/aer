"""Solar longitude (Ls, the Mars season) for a Perseverance mission sol.

Allison & McEwen 2000, Planet. Space Sci. 48, 215 (the algorithm used by NASA GISS Mars24),
evaluated at local noon of the sol at Jezero. Perseverance landed on sol 0 at 2021-02-18 20:55 UTC
(about 15:53 local mean solar time).
"""
import math

MARS_SOL_S = 88775.244
LANDING_JD_UTC = 2459264.37153   # 2021-02-18 20:55:00 UTC
LANDING_LMST_H = 15.9            # local mean solar time at touchdown, hours
TT_MINUS_UTC_S = 69.184          # 32.184 + 37 leap seconds


def ls_for_sol(sol: float) -> float:
    """Ls in degrees [0, 360) at local noon of the given sol."""
    days = (sol + (12.0 - LANDING_LMST_H) / 24.0) * MARS_SOL_S / 86400.0
    dt = LANDING_JD_UTC + days + TT_MINUS_UTC_S / 86400.0 - 2451545.0   # days since J2000 (TT)
    m = math.radians(19.3871 + 0.52402073 * dt)
    alpha_fms = 270.3871 + 0.524038496 * dt
    eoc = ((10.691 + 3.0e-7 * dt) * math.sin(m) + 0.623 * math.sin(2 * m) + 0.050 * math.sin(3 * m)
           + 0.005 * math.sin(4 * m) + 0.0005 * math.sin(5 * m))
    return (alpha_fms + eoc) % 360.0
