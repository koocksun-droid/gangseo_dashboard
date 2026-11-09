"""화면 확인용 가상 데이터를 data-demo/ 에 만든다. 실제 시세가 아니다 (index.html?demo=1 로 확인).

  python collector/make_demo.py
"""
import json
import random
import shutil
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data-demo"
random.seed(7)
OUT.mkdir(exist_ok=True)

DONGS = {"화곡동": (37.541, 126.845), "마곡동": (37.564, 126.830), "가양동": (37.566, 126.855), "등촌동": (37.555, 126.860),
         "방화동": (37.573, 126.812), "염창동": (37.549, 126.874), "내발산동": (37.552, 126.836), "공항동": (37.558, 126.806)}
END = date.today()
START = END - timedelta(days=36 * 30)


def rand_date():
    return (START + timedelta(days=random.randint(0, (END - START).days))).isoformat()


def make(kind, n_bld, base_ppy, area_choices, names):
    blds, trades, rents = [], [], []
    for i in range(n_bld):
        dong = random.choice(list(DONGS))
        lat, lon = DONGS[dong]
        blds.append({"dong": dong, "name": f"{names} {i + 1}", "jibun": str(random.randint(100, 1200)), "built": random.randint(1988, 2022),
                     "lat": round(lat + random.uniform(-.008, .008), 5) if kind == "apt" else None,
                     "lon": round(lon + random.uniform(-.01, .01), 5) if kind == "apt" else None})
        lvl = base_ppy * random.uniform(.7, 1.4)
        for _ in range(random.randint(5, 40)):
            d = rand_date(); a = random.choice(area_choices)
            growth = 1 + (date.fromisoformat(d) - START).days / 365 * 0.06
            amt = int(lvl * growth * a / 3.3058 * random.uniform(.92, 1.08))
            trades.append([i, d, a, random.randint(1, 20), amt])
        for _ in range(random.randint(10, 60)):
            d = rand_date(); a = random.choice(area_choices)
            dep = int(lvl * .55 * a / 3.3058 * random.uniform(.85, 1.1))
            monthly = 0 if random.random() < .5 else random.randint(30, 250)
            rents.append([i, d, a, random.randint(1, 20), dep if not monthly else int(dep * .3), monthly, random.choice(["신규", "갱신", ""])])
    trades.sort(key=lambda x: x[1]); rents.sort(key=lambda x: x[1])
    return {"buildings": blds, "trades": trades, "rents": rents, "area": "연면적" if kind == "sh" else "전용면적", "missing": []}


for kind, args in {"apt": (60, 4500, [59.9, 84.9, 114.9], "가상아파트"), "rh": (80, 2500, [29.8, 45.2, 59.5], "가상빌라"), "sh": (30, 2000, [120.5, 210.0, 330.0], "가상주택")}.items():
    (OUT / f"{kind}.json").write_text(json.dumps(make(kind, *args), ensure_ascii=False), encoding="utf-8")


def series(keys, start, step, noise):
    v, out = start, []
    for k in keys:
        v += step + random.uniform(-noise, noise)
        out.append([k, round(v, 2)])
    return out


weeks = [(END - timedelta(days=7 * i + END.weekday())).isoformat() for i in range(200)][::-1]
months = sorted({f"{(END - timedelta(days=30 * i)).year}{(END - timedelta(days=30 * i)).month:02d}" for i in range(50)})
rone = {}
for k, keys in (("sale_w", weeks), ("jeonse_w", weeks), ("sale_m", months), ("jeonse_m", months)):
    rone[k] = {r: series(keys, 92 + j, .03 if k.endswith("w") else .15, .05) for j, r in enumerate(("전국", "서울", "강서구"))}
rone["ratio_m"] = {r: series(months, 55 - j * 2, -.03, .3) for j, r in enumerate(("전국", "서울", "강서구"))}
rone["unsold_m"] = {"서울": series(months, 900, 3, 40), "강서구": series(months, 100, .2, 6)}
(OUT / "rone.json").write_text(json.dumps(rone, ensure_ascii=False), encoding="utf-8")
(OUT / "hug.json").write_text(json.dumps({"unit": "공급면적 ㎡당 천원", "series": {"모든면적": series(months, 15000, 60, 150)}}, ensure_ascii=False), encoding="utf-8")
subs = [{"name": f"가상 단지 {i + 1} 입주자모집공고", "addr": f"서울 {gu} 가상동 {i + 1}", "gu": gu, "units": random.randint(50, 900),
         "notice": (END - timedelta(days=20 * i)).isoformat(), "start": (END - timedelta(days=20 * i - 10)).isoformat(), "end": (END - timedelta(days=20 * i - 12)).isoformat(),
         "win": (END - timedelta(days=20 * i - 20)).isoformat(), "move": f"{END.year + 2}{random.randint(1, 12):02d}", "url": ""}
        for i, gu in enumerate(["강서구", "양천구", "마포구", "강서구", "영등포구", "구로구", "송파구", "강서구"])]
(OUT / "subscription.json").write_text(json.dumps(subs, ensure_ascii=False), encoding="utf-8")
gogo = [{"id": 90000 + i, "title": f"가상 매물 {i + 1} · 남향 올수리", "type": random.choice(["매매", "전세", "월세"]), "cat": random.choice(["아파트", "아파트", "주택"]),
         "addr": f"서울 강서구 {d}", "price": random.choice([125000, 82000, 150]), "deposit": 20000, "area": 84.9, "supplyPy": 33, "floor": "현재층 :8층 / 총층 :15층",
         "dir": "남향", "move": "즉시입주", "lat": DONGS[d][0], "lon": DONGS[d][1], "img": "assets/logo.png", "thumb": "assets/logo.png", "url": "", "modified": END.isoformat()}
        for i, d in enumerate(list(DONGS) * 2)]
(OUT / "gogo.json").write_text(json.dumps(gogo, ensure_ascii=False), encoding="utf-8")
plans = {"items": [{"name": "가상 개발계획 A", "type": "교통", "status": "추진중", "schedule": "2029년 예정", "lat": 37.545, "lon": 126.842, "source": "가상 데이터"},
                   {"name": "가상 개발계획 B", "type": "정비", "status": "확실하지 않음", "schedule": "미정", "lat": 37.560, "lon": 126.835, "source": "가상 데이터"}]}
(OUT / "plans.json").write_text(json.dumps(plans, ensure_ascii=False), encoding="utf-8")
(OUT / "listings.json").write_text(json.dumps({"items": []}, ensure_ascii=False), encoding="utf-8")
(OUT / "meta.json").write_text(json.dumps({"collected": "가상 데이터", "status": {}}, ensure_ascii=False), encoding="utf-8")
for f in ("site.json", "pois.json", "office.json"):  # 사무소 정보·주변시설은 실제 파일을 그대로 쓴다
    if (ROOT / "data" / f).exists():
        shutil.copy(ROOT / "data" / f, OUT / f)
print("data-demo/ 생성 완료")
