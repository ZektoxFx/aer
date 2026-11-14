"""Mars surface sunlight from NASA TM-103623 (Appelbaum & Flood, "Solar radiation on Mars: Update 1990").

f(z, tau, al) = sum_{i,j,k} p(i,j,k) * tau^i * (z/100)^j * al^k * (1 - al)      (eq. 18; z in degrees)
Global horizontal G_h = G_ob * cos z * f / (1 - al)                          (eq. 17)
Beam horizontal   G_bh = G_ob * cos z * exp(-tau / cos z)                    (eq. 19)
Diffuse            = G_h - G_bh
G_ob (top of atmosphere) = 590 * (1 + e cos(Ls - 248))^2 / (1 - e^2)^2 W/m2, e = 0.093377

The index orientation of Table III (rows vs columns) and two OCR-damaged digits are resolved by
checking the fit against Table I(a) values transcribed below.
"""
import itertools
import math

import numpy as np

K0 = [
    [1.002800, -0.228681, 0.019613, 0.000231, -0.000130, 0.000003],
    [-0.450073, 1.335955, -1.131691, 0.402126, -0.063967, 0.003758],
    [5.566705, -16.912405, 13.739701, -4.756079, 0.743740, -0.043159],
    [-22.471579, 64.909973, -52.509470, 17.997548, -2.786548, 0.160340],
    [36.334497, -101.800319, 79.895539, -26.762885, 4.074117, -0.231476],
    [-20.420490, 53.207148, -39.949537, 12.977108, -1.931169, 0.107837],
]
K1 = [
    [0.009814, 0.226139, -0.117733, 0.030579, -0.004090, 0.000218],
    [-0.156701, 0.396821, -0.313648, 0.099227, -0.013508, 0.000651],
    [1.361122, -3.758111, 3.007907, -0.987457, 0.141693, None],  # OCR: "-.007.:120"
    [-4.365924, 12.539251, -10.394165, 3.486452, -0.513123, 0.027401],
    [5.991693, -17.498138, 14.291370, -4.765323, 0.703675, -0.037960],
    [-2.915099, 8.275686, -6.593125, 2.173999, -0.320308, 0.017335],  # OCR: "8.2756.86"
]
# Table I(a), albedo 0.1, z = 0..40 deg step 5 (clean rows from the OCR)
TABLE_I = {
    0.10: [.883, .883, .883, .882, .881, .880, .879, .877, .875],
    0.50: [.813, .813, .811, .808, .804, .799, .793, .786, .778],
    1.00: [.728, .727, .724, .719, .712, .704, .694, .683, .669],
    2.00: [.578, .576, .572, .566, .557, .546, .532, .517, .498],
    3.00: [.457, .456, .452, .445, .436, .425, .411, .395, .376],
    5.00: [.289, .288, .285, .280, .273, .264, .253, .241, None],
    6.00: [.229, .227, .224, .220, .215, .209, .200, .189, None],
}


def make_f(rows_are_z, k1_25):
    k1 = [r[:] for r in K1]
    k1[2][5] = k1_25
    P = np.zeros((6, 6, 2))
    for a in range(6):
        for b in range(6):
            i, j = (b, a) if rows_are_z else (a, b)  # i: tau power, j: z power
            P[i, j, 0] = K0[a][b]
            P[i, j, 1] = k1[a][b]

    def f(z_deg, tau, al):
        zz = z_deg / 100.0
        s = 0.0
        for i, j, k in itertools.product(range(6), range(6), range(2)):
            s += P[i, j, k] * tau ** i * zz ** j * al ** k
        return s * (1 - al)

    return f


def calibrate():
    best = None
    for rows_are_z, k in itertools.product([False, True], [-0.007120, -0.007420, -0.007720, -0.001120]):
        f = make_f(rows_are_z, k)
        errs = [abs(f(z, t, 0.1) - v) / v for t, vals in TABLE_I.items() for z, v in zip(range(0, 45, 5), vals) if v]
        e = max(errs)
        if best is None or e < best[0]:
            best = (e, rows_are_z, k, f, float(np.mean(errs)))
    return best


def g_ob(ls_deg):
    e = 0.093377
    return 590.0 * (1 + e * math.cos(math.radians(ls_deg - 248.0))) ** 2 / (1 - e * e) ** 2


if __name__ == "__main__":
    e, rz, k, f, mean = calibrate()
    print(f"best: rows_are_z={rz} p(2,5,1)={k} max err {e*100:.2f}% mean {mean*100:.2f}%")
