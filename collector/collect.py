"""강서구 아파트 브리핑 데이터 수집기.

국토교통부 실거래가(공공데이터포털) · 한국부동산원 R-ONE · 카카오 로컬 API를 불러
data/ 폴더에 JSON으로 저장한다. API 키는 collector/config.json 에서 읽는다.

  python collector/collect.py            # 전체 수집 (지난달·이번달 실거래만 새로 받음)
  python collector/collect.py --refresh  # 실거래 전체 기간 다시 받기
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
CFG = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))

LAWD = "11500"  # 서울 강서구
START = (2024, 1)
BBOX = (37.522, 126.762, 37.602, 126.882)  # 강서구 범위 (남, 서, 북, 동)


def get(url, headers=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # 일시적 오류는 잠시 쉬고 다시 시도
            if i == tries - 1:
                raise
            print("  retry:", e)
            time.sleep(2 + i * 3)


def months():
    y, m = START
    today = date.today()
    while (y, m) <= (today.year, today.month):
        yield f"{y}{m:02d}"
        m += 1
        if m > 12:
            y, m = y + 1, 1


# ---------------------------------------------------------------- 실거래가
MOLIT = {
    "trade": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    "rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
}


def fetch_month(kind, ym):
    items, page = [], 1
    while True:
        q = urllib.parse.urlencode({"LAWD_CD": LAWD, "DEAL_YMD": ym, "pageNo": page, "numOfRows": 1000})
        xml = get(f"{MOLIT[kind]}?serviceKey={CFG['data_go_kr_key']}&{q}")
        root = ET.fromstring(xml)
        code = root.findtext(".//resultCode")
        if code not in ("000", "00"):
            raise RuntimeError(f"{kind} {ym}: {root.findtext('.//resultMsg') or xml[:200]}")
        for it in root.iter("item"):
            items.append({c.tag: (c.text or "").strip() for c in it})
        total = int(root.findtext(".//totalCount") or 0)
        if page * 1000 >= total:
            return items
        page += 1


def collect_deals(refresh):
    RAW.mkdir(parents=True, exist_ok=True)
    all_months = list(months())
    recent = set(all_months[-3:])  # 신고 기한(30일) 때문에 최근 3개월은 매번 다시 받음
    out = {}
    for kind in MOLIT:
        rows = []
        for ym in all_months:
            f = RAW / f"{kind}_{ym}.json"
            if refresh or ym in recent or not f.exists():
                print(f"MOLIT {kind} {ym}")
                f.write_text(json.dumps(fetch_month(kind, ym), ensure_ascii=False), encoding="utf-8")
                time.sleep(0.2)
            rows += json.loads(f.read_text(encoding="utf-8"))
        out[kind] = rows
    return out


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def compact_deals(raw):
    """단지 목록과 거래 배열로 정리한다. 해제(취소)된 매매는 뺀다."""
    apts, aidx = [], {}

    def apt_id(r):
        key = (r.get("umdNm", ""), r.get("aptNm", ""), r.get("jibun", ""))
        if key not in aidx:
            aidx[key] = len(apts)
            apts.append({"dong": key[0], "name": key[1], "jibun": key[2], "built": int(num(r.get("buildYear")) or 0)})
        a = apts[aidx[key]]
        if not a["built"] and r.get("buildYear"):
            a["built"] = int(num(r["buildYear"]))
        return aidx[key]

    trades, rents = [], []
    for r in raw["trade"]:
        if (r.get("cdealType") or "").strip():  # 해제 신고된 거래
            continue
        d = f"{r['dealYear']}-{int(r['dealMonth']):02d}-{int(r['dealDay']):02d}"
        trades.append([apt_id(r), d, num(r["excluUseAr"]), int(num(r.get("floor"))), int(num(r["dealAmount"]))])
    for r in raw["rent"]:
        d = f"{r['dealYear']}-{int(r['dealMonth']):02d}-{int(r['dealDay']):02d}"
        rents.append([apt_id(r), d, num(r["excluUseAr"]), int(num(r.get("floor"))), int(num(r["deposit"])), int(num(r.get("monthlyRent")))])
    trades.sort(key=lambda x: x[1])
    rents.sort(key=lambda x: x[1])
    return apts, trades, rents


# ---------------------------------------------------------------- R-ONE
RONE = "https://www.reb.or.kr/r-one/openapi"
RONE_TABLES = {  # 이름: (통계표 ID, 주기)
    "sale_w": ("T244183132827305", "WK"),
    "jeonse_w": ("T247713133046872", "WK"),
    "sale_m": ("A_2024_00045", "MM"),
    "jeonse_m": ("A_2024_00050", "MM"),
    "rent_m": ("A_2024_00055", "MM"),
    "ratio_m": ("A_2024_00073", "MM"),
    "supply_m": ("A_2024_00076", "MM"),
}
REGIONS = ["전국", "서울", "서남권", "강서구"]


def rone_rows(api, root_key, **params):
    rows, page = [], 1
    while True:
        q = urllib.parse.urlencode({"KEY": CFG["rone_key"], "Type": "json", "pIndex": page, "pSize": 1000, **params})
        d = json.loads(get(f"{RONE}/{api}.do?{q}"))
        parts = d.get(root_key)
        if not parts:
            msg = d.get("RESULT", {}).get("MESSAGE") if isinstance(d.get("RESULT"), dict) else str(d)[:200]
            if "해당하는 데이터가 없습니다" in str(msg):
                return rows
            raise RuntimeError(f"R-ONE {params}: {msg}")
        total = parts[0]["head"][0]["list_total_count"]
        rows += [r for p in parts for r in p.get("row", [])]
        if page * 1000 >= total:
            return rows
        page += 1


def region_ids(statbl):
    """통계표의 분류 트리에서 전국·서울·서울 강서구의 CLS_ID를 찾는다."""
    all_items = rone_rows("SttsApiTblItm", "SttsApiTblItm", STATBL_ID=statbl)
    items = [r for r in all_items if r["ITM_TAG"] == "분류"]
    measures = [r for r in all_items if r["ITM_TAG"] == "항목"]
    by = {r["ITM_ID"]: r for r in items}

    def path(r):
        p = []
        while r:
            p.append(r["ITM_NM"])
            r = by.get(r["PAR_ITM_ID"])
        return ">".join(reversed(p))

    found = {}
    for r in items:
        p = path(r)
        if p == "전국":
            found["전국"] = r["ITM_ID"]
        elif p == "서울":
            found["서울"] = r["ITM_ID"]
        elif p.startswith("서울>") and p.endswith(">서남권"):
            found["서남권"] = r["ITM_ID"]
        elif p.startswith("서울>") and p.endswith(">강서구"):
            found["강서구"] = r["ITM_ID"]
    return found, (measures[0]["ITM_ID"], measures[0]["ITM_NM"]) if measures else (None, None)


def collect_rone():
    out = {}
    start_m = f"{START[0] - 1}{START[1]:02d}"
    for name, (tbl, cyc) in RONE_TABLES.items():
        ids, (itm, itm_nm) = region_ids(tbl)
        print(f"R-ONE {name}: 항목 {itm_nm}, 지역 {list(ids)}")
        out[name] = {}
        for reg in REGIONS:
            if reg not in ids:
                print(f"R-ONE {name}: {reg} 없음")
                continue
            start = start_m if cyc == "MM" else f"{START[0] - 1}01"
            extra = {"ITM_ID": itm} if itm else {}
            rows = rone_rows("SttsApiTblData", "SttsApiTblData", STATBL_ID=tbl, DTACYCLE_CD=cyc, CLS_ID=ids[reg], START_WRTTIME=start, **extra)
            series = {}
            for r in rows:
                if r.get("DTA_VAL") is None:
                    continue
                # 주간은 기준일(WRTTIME_DESC = YYYY-MM-DD), 월간은 YYYYMM
                k = r["WRTTIME_DESC"] if cyc == "WK" else r["WRTTIME_IDTFR_ID"]
                series[k] = round(float(r["DTA_VAL"]), 3)
            out[name][reg] = sorted(series.items())
            print(f"R-ONE {name} {reg}: {len(series)}")
    return out


# ---------------------------------------------------------------- 카카오
KAKAO = "https://dapi.kakao.com/v2/local"


def kakao(path, **params):
    q = urllib.parse.urlencode(params)
    return json.loads(get(f"{KAKAO}/{path}?{q}", {"Authorization": f"KakaoAK {CFG['kakao_rest_key']}"}))


def geocode_apts(apts):
    cache_f = DATA / "geocode_cache.json"
    cache = json.loads(cache_f.read_text(encoding="utf-8")) if cache_f.exists() else {}
    for a in apts:
        key = f"{a['dong']}|{a['name']}|{a['jibun']}"
        if key not in cache:
            hit = None
            # 지번 주소가 가장 정확하고, 없으면 단지명 키워드로 찾는다
            if a["jibun"]:
                d = kakao("search/address.json", query=f"서울 강서구 {a['dong']} {a['jibun']}", size=1)
                if d["documents"]:
                    hit = [float(d["documents"][0]["y"]), float(d["documents"][0]["x"])]
            if not hit:
                d = kakao("search/keyword.json", query=f"강서구 {a['dong']} {a['name']}", size=1)
                if d["documents"]:
                    hit = [float(d["documents"][0]["y"]), float(d["documents"][0]["x"])]
            cache[key] = hit
            time.sleep(0.05)
        a["lat"], a["lon"] = (cache[key] or [None, None])
    cache_f.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print("geocoded:", sum(1 for a in apts if a.get("lat")), "/", len(apts))


POI_CATS = {"SW8": "st", "SC4": "sc", "MT1": "mt", "HP8": "hp", "PO3": "po", "CE7": "cf"}
CAFE_BRANDS = ["스타벅스", "투썸플레이스", "이디야", "메가MGC", "메가커피", "컴포즈", "빽다방", "폴바셋", "할리스", "커피빈", "파스쿠찌", "블루보틀", "엔제리너스", "탐앤탐스", "더벤티", "매머드"]


def collect_pois():
    s, w, n, e = BBOX
    # 바깥쪽 여유 0.01도 포함, 6x6 격자로 나눠 카테고리별 45건 한도를 피한다
    s, w, n, e = s - 0.01, w - 0.012, n + 0.01, e + 0.012
    rows, cols = 6, 6
    seen, pois = set(), []
    for code, tag in POI_CATS.items():
        for i in range(rows):
            for j in range(cols):
                rect = f"{w + (e - w) * j / cols},{s + (n - s) * i / rows},{w + (e - w) * (j + 1) / cols},{s + (n - s) * (i + 1) / rows}"
                for page in (1, 2, 3):
                    d = kakao("search/category.json", category_group_code=code, rect=rect, page=page, size=15)
                    for p in d["documents"]:
                        if p["id"] in seen:
                            continue
                        seen.add(p["id"])
                        name, cat = p["place_name"], p["category_name"]
                        t = tag
                        if tag == "cf":
                            if not any(b in name for b in CAFE_BRANDS):
                                t = "cafe"
                        if tag == "sc":
                            if "초등학교" in name or cat.endswith("초등학교"):
                                t = "e"
                            elif "중학교" in name or cat.endswith("중학교"):
                                t = "m"
                            elif "고등학교" in name or cat.endswith("고등학교"):
                                t = "h"
                            else:
                                continue
                        if tag == "mt" and not any(k in name for k in ("이마트", "홈플러스", "롯데마트", "코스트코", "킴스클럽", "트레이더스", "농협하나로", "하나로마트", "노브랜드")):
                            continue
                        if tag == "hp" and not any(k in cat for k in ("종합병원", "대학병원")) and "병원" not in name:
                            continue
                        if tag == "hp" and any(k in name for k in ("의원", "치과", "한의원", "요양")):
                            continue
                        if tag == "po" and not any(k in name for k in ("주민센터", "구청", "우체국", "경찰서", "지구대", "파출소", "치안센터", "소방서", "119안전센터", "도서관", "세무서", "등기소")):
                            continue
                        pois.append([t, name, round(float(p["y"]), 6), round(float(p["x"]), 6), cat.split(" > ")[-1]])
                    if d["meta"]["is_end"]:
                        break
                    time.sleep(0.03)
        print("POI", code, len(pois))
    # 공원·백화점·쇼핑몰은 키워드로
    for kw, tag in (("공원", "pk"), ("백화점", "dp"), ("쇼핑몰", "dp"), ("아울렛", "dp")):
        for i in range(rows):
            for j in range(cols):
                rect = f"{w + (e - w) * j / cols},{s + (n - s) * i / rows},{w + (e - w) * (j + 1) / cols},{s + (n - s) * (i + 1) / rows}"
                for page in (1, 2, 3):
                    d = kakao("search/keyword.json", query=kw, rect=rect, page=page, size=15)
                    for p in d["documents"]:
                        if p["id"] in seen:
                            continue
                        cat = p["category_name"]
                        if tag == "pk" and not ("공원" in cat or "공원" in p["place_name"]) or "주차장" in p["place_name"] or "관리" in p["place_name"]:
                            continue
                        if tag == "dp" and not any(k in cat for k in ("백화점", "쇼핑몰", "아울렛", "복합쇼핑")):
                            continue
                        seen.add(p["id"])
                        pois.append([tag, p["place_name"], round(float(p["y"]), 6), round(float(p["x"]), 6), cat.split(" > ")[-1]])
                    if d["meta"]["is_end"]:
                        break
        print("POI", kw, len(pois))
    return pois


# ---------------------------------------------------------------- main
def main():
    refresh = "--refresh" in sys.argv
    DATA.mkdir(exist_ok=True)
    raw = collect_deals(refresh)
    apts, trades, rents = compact_deals(raw)
    geocode_apts(apts)
    rone = collect_rone()
    poi_f = DATA / "pois.json"
    if refresh or not poi_f.exists() or "--poi" in sys.argv:
        poi_f.write_text(json.dumps(collect_pois(), ensure_ascii=False), encoding="utf-8")
    out = {
        "collected": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "apts": apts,
        "trades": trades,
        "rents": rents,
        "rone": rone,
    }
    (DATA / "dataset.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"done: 단지 {len(apts)} · 매매 {len(trades)} · 전월세 {len(rents)}")


if __name__ == "__main__":
    main()
