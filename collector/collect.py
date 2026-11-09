"""강서구 주거용 시장 브리핑 데이터 수집기.

공공데이터포털(국토교통부 실거래가·청약홈), 한국부동산원 R-ONE, 주택도시보증공사(HUG) 분양가,
카카오 로컬, GO부동산 홈페이지(gogogogo.kr) 매물을 모아 data/*.json 으로 저장한다.
API 키는 저장소 맨 위 .env 파일(또는 같은 이름의 환경변수)에서 읽는다:
  DATA_GO_KR_KEY=...   RONE_KEY=...   KAKAO_KEY=...

  python collector/collect.py            # 전체 수집 (최근 3개월 실거래만 새로 받고 나머지는 캐시)
  python collector/collect.py --refresh  # 실거래·주변시설 전체 다시 받기
  python collector/collect.py --only gogo,hug   # 일부만 다시 받기

한 소스가 실패해도 그 소스의 기존 data 파일은 덮어쓰지 않고, 결과는 data/meta.json 의 status 에 남긴다.
"""
import csv
import io
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"


def load_env():
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("DATA_GO_KR_KEY", "RONE_KEY", "KAKAO_KEY"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


ENV = load_env()
KST = timezone(timedelta(hours=9))  # GitHub 서버(UTC)에서 돌아도 한국시간으로 기록
LAWD = "11500"  # 서울 강서구
MONTHS_BACK = 36
BBOX = (37.522, 126.762, 37.602, 126.882)  # 강서구 범위 (남, 서, 북, 동)
UA = {"User-Agent": "Mozilla/5.0 (GO-realty briefing collector)"}


def get(url, headers=None, tries=3, raw=False):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
                return b if raw else b.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):  # 키는 있지만 이 서비스는 활용신청이 안 된 경우
                body = e.read().decode("utf-8", "ignore")
                m = re.search(r"<returnAuthMsg>([^<]+)|\"msg\":\"([^\"]+)", body)
                raise ApiError(f"HTTP {e.code} · {(m.group(1) or m.group(2)) if m else '접근 거부'} — 공공데이터포털에서 이 서비스 활용신청이 필요합니다")
            if i == tries - 1:
                raise
            print("  retry:", e)
            time.sleep(2 + i * 3)
        except Exception as e:  # 일시적 오류는 잠시 쉬고 다시 시도
            if i == tries - 1:
                raise
            print("  retry:", e)
            time.sleep(2 + i * 3)


def months():
    t = date.today()
    y, m = t.year, t.month - MONTHS_BACK + 1
    while m < 1:
        y, m = y - 1, m + 12
    while (y, m) <= (t.year, t.month):
        yield f"{y}{m:02d}"
        m += 1
        if m > 12:
            y, m = y + 1, 1


def save(name, obj):
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------- 국토교통부 실거래가
MOLIT = "https://apis.data.go.kr/1613000"
DEALS = {  # 이름: (서비스/오퍼레이션, 유형, 매매 여부)
    "apt_trade": ("RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade", "apt", True),
    "apt_rent": ("RTMSDataSvcAptRent/getRTMSDataSvcAptRent", "apt", False),
    "rh_trade": ("RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade", "rh", True),
    "rh_rent": ("RTMSDataSvcRHRent/getRTMSDataSvcRHRent", "rh", False),
    "sh_trade": ("RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade", "sh", True),
    "sh_rent": ("RTMSDataSvcSHRent/getRTMSDataSvcSHRent", "sh", False),
}


class ApiError(Exception):
    pass


def fetch_month(op, ym):
    items, page = [], 1
    while True:
        q = urllib.parse.urlencode({"LAWD_CD": LAWD, "DEAL_YMD": ym, "pageNo": page, "numOfRows": 1000})
        xml = get(f"{MOLIT}/{op}?serviceKey={ENV['DATA_GO_KR_KEY']}&{q}")
        root = ET.fromstring(xml)
        code = root.findtext(".//resultCode")
        if code not in ("000", "00"):
            msg = root.findtext(".//returnAuthMsg") or root.findtext(".//resultMsg") or root.findtext(".//errMsg") or xml[:200]
            raise ApiError(msg)
        for it in root.iter("item"):
            items.append({c.tag: (c.text or "").strip() for c in it})
        total = int(root.findtext(".//totalCount") or 0)
        if page * 1000 >= total:
            return items
        page += 1


def collect_deals(name, refresh):
    op = DEALS[name][0]
    RAW.mkdir(parents=True, exist_ok=True)
    all_m = list(months())
    recent = set(all_m[-3:])  # 신고 기한(30일) 때문에 최근 3개월은 매번 다시 받음
    rows = []
    for ym in all_m:
        f = RAW / f"{name}_{ym}.json"
        if refresh or ym in recent or not f.exists():
            print(f"  {name} {ym}")
            f.write_text(json.dumps(fetch_month(op, ym), ensure_ascii=False), encoding="utf-8")
            time.sleep(0.15)
        rows += json.loads(f.read_text(encoding="utf-8"))
    return rows


def ymd(r):
    return f"{r['dealYear']}-{int(r['dealMonth']):02d}-{int(r['dealDay']):02d}"


def compact(kind, trades, rents):
    """건물(단지) 목록 + 거래 배열로 줄인다. 해제(취소) 신고된 매매는 뺀다.

    매매: [건물, 계약일, 면적, 층, 거래금액(만원)]
    전월세: [건물, 계약일, 면적, 층, 보증금(만원), 월세(만원), 계약구분(신규/갱신/'')]
    면적: 아파트·연립다세대는 전용면적, 단독다가구는 연면적.
    """
    bld, idx = [], {}

    def bid(r):
        if kind == "apt":
            key = (r.get("umdNm", ""), r.get("aptNm", ""), r.get("jibun", ""))
        elif kind == "rh":
            key = (r.get("umdNm", ""), r.get("mhouseNm", ""), r.get("jibun", ""))
        else:  # 단독다가구는 건물명이 없다
            key = (r.get("umdNm", ""), r.get("houseType", "") or "단독다가구", r.get("jibun", ""))
        if key not in idx:
            idx[key] = len(bld)
            bld.append({"dong": key[0], "name": key[1], "jibun": key[2], "built": int(num(r.get("buildYear")))})
        b = bld[idx[key]]
        if not b["built"] and r.get("buildYear"):
            b["built"] = int(num(r["buildYear"]))
        return idx[key]

    area_f = "totalFloorAr" if kind == "sh" else "excluUseAr"
    t_out, r_out = [], []
    for r in trades:
        if (r.get("cdealType") or "").strip():
            continue
        t_out.append([bid(r), ymd(r), round(num(r.get(area_f)), 2), int(num(r.get("floor"))), int(num(r.get("dealAmount")))])
    for r in rents:
        r_out.append([bid(r), ymd(r), round(num(r.get(area_f)), 2), int(num(r.get("floor"))), int(num(r.get("deposit"))),
                      int(num(r.get("monthlyRent"))), (r.get("contractType") or "").strip()])
    t_out.sort(key=lambda x: x[1])
    r_out.sort(key=lambda x: x[1])
    return bld, t_out, r_out


# ---------------------------------------------------------------- 한국부동산원 R-ONE
RONE = "https://www.reb.or.kr/r-one/openapi"
RONE_TABLES = {  # 이름: (통계표 ID, 주기)
    "sale_w": ("T244183132827305", "WK"),      # (주) 매매가격지수 (아파트)
    "jeonse_w": ("T247713133046872", "WK"),    # (주) 전세가격지수 (아파트)
    "sale_m": ("A_2024_00045", "MM"),          # (월) 매매가격지수_아파트
    "jeonse_m": ("A_2024_00050", "MM"),        # (월) 전세가격지수_아파트
    "ratio_m": ("A_2024_00073", "MM"),         # (월) 중위 매매가격 대비 전세가격_아파트
    "unsold_m": ("T237973129847263", "MM"),    # 미분양주택현황
}
REGIONS = ["전국", "서울", "강서구"]


def rone_rows(api, root_key, **params):
    rows, page = [], 1
    while True:
        q = urllib.parse.urlencode({"KEY": ENV["RONE_KEY"], "Type": "json", "pIndex": page, "pSize": 1000, **params})
        d = json.loads(get(f"{RONE}/{api}.do?{q}"))
        parts = d.get(root_key)
        if not parts:
            msg = str(d.get("RESULT", d))[:200]
            if "데이터가 없습니다" in msg:
                return rows
            raise ApiError(f"R-ONE {params.get('STATBL_ID')}: {msg}")
        total = parts[0]["head"][0]["list_total_count"]
        rows += [r for p in parts for r in p.get("row", [])]
        if page * 1000 >= total:
            return rows
        page += 1


def region_ids(statbl, cyc):
    """통계표 분류 트리에서 전국·서울·서울 강서구의 CLS_ID와 첫 항목 ID를 찾는다 (부산 강서구와 구분)."""
    all_items = rone_rows("SttsApiTblItm", "SttsApiTblItm", STATBL_ID=statbl)
    cls = [r for r in all_items if r["ITM_TAG"] == "분류"]
    measures = [r for r in all_items if r["ITM_TAG"] == "항목"]
    by = {r["ITM_ID"]: r for r in cls}

    def path(r):
        p = []
        while r:
            p.append(r["ITM_NM"])
            r = by.get(r["PAR_ITM_ID"])
        return ">".join(reversed(p))

    found = {}
    for r in cls:
        p = path(r)
        if p in ("전국", "서울"):
            found[p] = r["ITM_ID"]
        elif p.startswith("서울>") and p.endswith(">강서구") or p == "서울>강서구":
            found["강서구"] = r["ITM_ID"]
    if "강서구" not in found:
        # 상위 지역이 목록에 없는 통계표(미분양 등)는 데이터 행의 전체 경로("서울>강서구")로 구분한다
        for r in (x for x in cls if x["ITM_NM"] == "강서구"):
            rows = rone_rows("SttsApiTblData", "SttsApiTblData", STATBL_ID=statbl, DTACYCLE_CD=cyc, CLS_ID=r["ITM_ID"], pSize=1)
            if rows and rows[0].get("CLS_FULLNM", "").startswith("서울"):
                found["강서구"] = r["ITM_ID"]
                seoul_total = next((x for x in cls if x["PAR_ITM_ID"] == r["PAR_ITM_ID"] and x["ITM_NM"] in ("계", "합계", "서울")), None)
                if seoul_total and "서울" not in found:
                    found["서울"] = seoul_total["ITM_ID"]
                break
    return found, (measures[0]["ITM_ID"], measures[0]["ITM_NM"]) if measures else (None, None)


def collect_rone():
    out, start = {}, f"{date.today().year - 4}01"
    for name, (tbl, cyc) in RONE_TABLES.items():
        ids, (itm, itm_nm) = region_ids(tbl, cyc)
        out[name] = {"table": tbl, "item": itm_nm}
        for reg in REGIONS:
            if reg not in ids:
                continue
            extra = {"ITM_ID": itm} if itm else {}
            rows = rone_rows("SttsApiTblData", "SttsApiTblData", STATBL_ID=tbl, DTACYCLE_CD=cyc, CLS_ID=ids[reg], START_WRTTIME=start, **extra)
            s = {}
            for r in rows:
                if r.get("DTA_VAL") is None:
                    continue
                k = r["WRTTIME_DESC"] if cyc == "WK" else r["WRTTIME_IDTFR_ID"]
                s[k] = round(float(r["DTA_VAL"]), 3)
            out[name][reg] = sorted(s.items())
        print(f"  R-ONE {name} ({itm_nm}): " + ", ".join(f"{k} {len(v)}" for k, v in out[name].items() if isinstance(v, list)))
    return out


# ---------------------------------------------------------------- HUG 민간아파트 분양가격 (공공데이터포털 파일데이터, 키 불필요)
def collect_hug():
    meta = json.loads(get("https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15061057&fileDetailSn=1&dataNm=hug"))
    fid = meta.get("atchFileId") or meta.get("fileDataRegistVO", {}).get("atchFileId")
    b = get(f"https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId={fid}&fileDetailSn=1&dataNm=hug", raw=True)
    try:
        text = b.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = b.decode("cp949")
    rows = list(csv.DictReader(io.StringIO(text)))
    out = {}
    for r in rows:
        if r.get("지역명") != "서울":
            continue
        v = num(r.get("분양가격(제곱미터당 천원)"))
        if not v:
            continue
        out.setdefault(r["규모구분"], []).append([f"{int(r['연도'])}{int(r['월']):02d}", v])
    for k in out:
        out[k].sort()
    last = max((s[-1][0] for s in out.values()), default="")
    print(f"  HUG 서울 분양가: 규모 {len(out)}종 · 마지막 {last}")
    return {"unit": "공급면적 ㎡당 천원", "source": "주택도시보증공사 민간아파트 분양가격 동향 (공공데이터포털 15061057)", "series": out}


# ---------------------------------------------------------------- 청약홈 분양정보 (한국부동산원)
ODCLOUD = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1"
SUBS_KINDS = {  # 구분: (공고 상세, 주택형별)
    "APT": ("getAPTLttotPblancDetail", "getAPTLttotPblancMdl"),
    "무순위·잔여": ("getRemndrLttotPblancDetail", "getRemndrLttotPblancMdl"),
}


def odcloud(op, **cond):
    rows, page = [], 1
    while True:
        q = {"page": page, "perPage": 1000, "serviceKey": ENV["DATA_GO_KR_KEY"]}
        q.update({f"cond[{k}]": v for k, v in cond.items()})
        d = json.loads(get(f"{ODCLOUD}/{op}?{urllib.parse.urlencode(q)}"))
        if "data" not in d:
            raise ApiError(d.get("msg") or str(d)[:200])
        rows += d["data"]
        if page * 1000 >= d.get("matchCount", d.get("totalCount", 0)):
            return rows
        page += 1


def collect_subscription():
    """서울 아파트 모집공고(최근 3년)와 주택형별 분양가. 주택형은 공고마다 바뀌지 않아 캐시한다."""
    since = f"{date.today().year - 3}-{date.today().month:02d}-01"
    cache_f = DATA / "subs_cache.json"
    cache = json.loads(cache_f.read_text(encoding="utf-8")) if cache_f.exists() else {}
    out = []
    for kind, (op_d, op_m) in SUBS_KINDS.items():
        cond = {"RCRIT_PBLANC_DE::GTE": since}
        if kind == "APT":
            cond["SUBSCRPT_AREA_CODE_NM::EQ"] = "서울"
        rows = [r for r in odcloud(op_d, **cond) if (r.get("HSSPLY_ADRES") or "").startswith(("서울", "서울특별시"))]
        for r in rows:
            addr = r.get("HSSPLY_ADRES", "")
            m = re.search(r"서울(?:특별시)?\s*(\S+구)", addr)
            key = f"{kind}|{r.get('HOUSE_MANAGE_NO')}|{r.get('PBLANC_NO')}"
            if key not in cache:
                types = odcloud(op_m, **{"HOUSE_MANAGE_NO::EQ": r.get("HOUSE_MANAGE_NO"), "PBLANC_NO::EQ": r.get("PBLANC_NO")})
                cache[key] = [{"ty": t.get("HOUSE_TY"), "ar": float(t.get("SUPLY_AR") or 0), "amt": int(float(t.get("LTTOT_TOP_AMOUNT") or 0)),
                               "n": int(t.get("SUPLY_HSHLDCO") or 0) + int(t.get("SPSPLY_HSHLDCO") or 0)} for t in types]
                time.sleep(0.05)
            out.append({"kind": kind, "type": r.get("HOUSE_DTL_SECD_NM") or "", "name": r.get("HOUSE_NM"), "addr": addr, "gu": m.group(1) if m else "서울",
                        "units": r.get("TOT_SUPLY_HSHLDCO"), "builder": r.get("CNSTRCT_ENTRPS_NM") or "",
                        "notice": r.get("RCRIT_PBLANC_DE"), "start": r.get("RCEPT_BGNDE") or r.get("SUBSCRPT_RCEPT_BGNDE"),
                        "end": r.get("RCEPT_ENDDE") or r.get("SUBSCRPT_RCEPT_ENDDE"), "win": r.get("PRZWNER_PRESNATN_DE"),
                        "move": r.get("MVN_PREARNGE_YM"), "url": r.get("PBLANC_URL"), "id": r.get("PBLANC_NO"),
                        "house": r.get("HOUSE_MANAGE_NO"), "types": cache[key]})
    cache_f.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    out.sort(key=lambda x: x["notice"] or "", reverse=True)
    from collections import Counter
    print(f"  청약 모집공고(서울, {since}~): {len(out)}건 · 강서구 {sum(1 for x in out if x['gu'] == '강서구')} · {dict(Counter(x['kind'] for x in out))}")
    return out


# ---------------------------------------------------------------- 카카오
KAKAO = "https://dapi.kakao.com/v2/local"


def kakao(path, **params):
    return json.loads(get(f"{KAKAO}/{path}?{urllib.parse.urlencode(params)}", {"Authorization": f"KakaoAK {ENV['KAKAO_KEY']}"}))


def geocode(blds, prefix):
    cache_f = DATA / "geocode_cache.json"
    cache = json.loads(cache_f.read_text(encoding="utf-8")) if cache_f.exists() else {}
    n_new = 0
    for a in blds:
        key = f"{a['dong']}|{a['name']}|{a['jibun']}"
        if key not in cache:
            hit = None
            if a["jibun"] and "*" not in a["jibun"]:
                d = kakao("search/address.json", query=f"서울 강서구 {a['dong']} {a['jibun']}", size=1)
                if d["documents"]:
                    hit = [float(d["documents"][0]["y"]), float(d["documents"][0]["x"])]
            if not hit and prefix == "apt":
                d = kakao("search/keyword.json", query=f"강서구 {a['dong']} {a['name']}", size=1)
                if d["documents"]:
                    hit = [float(d["documents"][0]["y"]), float(d["documents"][0]["x"])]
            cache[key] = hit
            n_new += 1
            time.sleep(0.04)
        g = cache[key]
        a["lat"], a["lon"] = (round(g[0], 5), round(g[1], 5)) if g else (None, None)
    cache_f.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"  좌표 {prefix}: {sum(1 for a in blds if a.get('lat'))}/{len(blds)} (새로 찾음 {n_new})")


POI_CATS = {"SW8": "st", "SC4": "sc", "MT1": "mt", "HP8": "hp", "PO3": "po"}
MART_OK = ("이마트", "홈플러스", "롯데마트", "코스트코", "킴스클럽", "트레이더스", "하나로마트", "노브랜드")
OFFICE_OK = ("주민센터", "행정복지센터", "구청", "우체국", "경찰서", "지구대", "파출소", "소방서", "119안전센터", "도서관", "세무서", "등기소")
HOSPITAL_NAMES = ("미즈메디", "이대서울", "부민병원", "서남병원", "메디힐", "힘찬병원", "대학교", "세브란스", "성모병원", "홍익병원", "강서송도병원")


def grid(rows=6, cols=6, pad=0.01):
    s, w, n, e = BBOX
    s, w, n, e = s - pad, w - pad * 1.2, n + pad, e + pad * 1.2
    for i in range(rows):
        for j in range(cols):
            yield f"{w + (e - w) * j / cols},{s + (n - s) * i / rows},{w + (e - w) * (j + 1) / cols},{s + (n - s) * (i + 1) / rows}"


def keep_poi(tag, name, cat):
    if tag == "mt":
        return any(k in name for k in MART_OK) and not any(k in name for k in ("익스프레스", "에브리데이", "슈퍼"))
    if tag == "hp":
        if any(k in cat for k in ("동물", "한방", "요양", "정신", "치과")) or name.endswith(("센터", "별관")):
            return False
        return cat in ("종합병원", "대학병원") or any(k in name for k in HOSPITAL_NAMES)
    if tag == "po":
        return any(k in name for k in OFFICE_OK)
    if tag == "pk":
        return name.endswith("공원") and "녹지" not in name
    return True


def collect_pois():
    seen, pois = set(), []
    for code, tag in POI_CATS.items():
        for rect in grid():
            for page in (1, 2, 3):
                d = kakao("search/category.json", category_group_code=code, rect=rect, page=page, size=15)
                for p in d["documents"]:
                    if p["id"] in seen:
                        continue
                    seen.add(p["id"])
                    name, cat = p["place_name"], p["category_name"].split(" > ")[-1]
                    t = tag
                    if tag == "sc":
                        t = "e" if "초등학교" in name else "m" if "중학교" in name else "h" if "고등학교" in name else None
                        if not t:
                            continue
                    if not keep_poi(t, name, cat):
                        continue
                    pois.append([t, name, round(float(p["y"]), 6), round(float(p["x"]), 6), cat])
                if d["meta"]["is_end"]:
                    break
                time.sleep(0.03)
    for rect in grid():
        for page in (1, 2, 3):
            d = kakao("search/keyword.json", query="공원", rect=rect, page=page, size=15)
            for p in d["documents"]:
                if p["id"] in seen or not keep_poi("pk", p["place_name"], p["category_name"]):
                    continue
                seen.add(p["id"])
                pois.append(["pk", p["place_name"], round(float(p["y"]), 6), round(float(p["x"]), 6), p["category_name"].split(" > ")[-1]])
            if d["meta"]["is_end"]:
                break
    from collections import Counter
    print("  주변시설:", dict(Counter(p[0] for p in pois)))
    return pois


# ---------------------------------------------------------------- GO부동산 매물 (gogogogo.kr)
GOGO = "https://gogogogo.kr"


def gogo_item(item_id):
    """매물 페이지 앞부분의 구조화 데이터(JSON-LD)만 읽는다. 페이지 전체는 2MB가 넘어서 앞 60KB만 받는다."""
    req = urllib.request.Request(f"{GOGO}/item/view/{item_id}", headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        s = r.read(60000).decode("utf-8", "ignore")
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', s, re.S)
    if not m:
        return None
    graph = json.loads(m.group(1)).get("@graph", [])
    prod = next((x for x in graph if "Product" in (x.get("@type") if isinstance(x.get("@type"), list) else [x.get("@type")])), None)
    page = next((x for x in graph if x.get("@type") == "WebPage"), {})
    if not prod:
        return None
    props = {p["name"]: p["value"] for p in prod.get("additionalProperty", [])}
    area = props.get("area", "")
    ex = re.search(r"전용\s*([\d.]+)㎡", area)
    sup = re.search(r"공급\s*([\d.]+)㎡\s*(\d+)평", area)
    desc = page.get("description") or prod.get("description") or ""
    dm = re.search(r"보증금\s*(\d+)억(?:\s*([\d,]+)만?)?|보증금\s*([\d,]+)만", desc)
    deposit = 0
    if dm:
        deposit = int(dm.group(1)) * 10000 + int((dm.group(2) or "0").replace(",", "")) if dm.group(1) else int(dm.group(3).replace(",", ""))
    geo = prod.get("geo") or {}
    title = re.sub(r"\s+", " ", prod.get("name", "")).strip()
    return {
        "id": int(item_id),
        "title": title,
        "type": props.get("transactionType", ""),
        "cat": props.get("propertyCategory", ""),
        "addr": prod.get("address", {}).get("streetAddress", ""),
        "price": round(float(prod.get("offers", {}).get("price") or 0) / 10000),  # 만원 (월세는 월 임대료)
        "deposit": deposit,  # 월세 보증금, 만원
        "area": float(ex.group(1)) if ex else 0,
        "supplyPy": int(sup.group(2)) if sup and sup.group(2) != "0" else 0,
        "floor": props.get("floor", ""),
        "rooms": props.get("roomsAndBaths", ""),
        "dir": props.get("direction", "").replace(" (거실 기준)", ""),
        "move": props.get("availableFrom", ""),
        "lat": geo.get("latitude"), "lon": geo.get("longitude"),
        "img": prod.get("image", ""),
        "thumb": f"{GOGO}/gallery/view_thumb/{item_id}",
        "url": f"{GOGO}/item/view/{item_id}",
        "modified": (page.get("dateModified") or "")[:10],
    }


def collect_gogo():
    """사이트맵의 현재 매물 중 서울 강서구 주거용(아파트·빌라·주택·오피스텔)만 모은다. 바뀌지 않은 매물은 캐시를 쓴다."""
    sm = get(f"{GOGO}/sitemap.xml")
    live = dict(re.findall(r"<loc>https://gogogogo\.kr/item/view/(\d+)</loc>\s*<lastmod>([\d-]+)</lastmod>", sm))
    if not live:
        raise ApiError("사이트맵에서 매물을 찾지 못함")
    cache_f = DATA / "gogo_cache.json"
    cache = json.loads(cache_f.read_text(encoding="utf-8")) if cache_f.exists() else {}
    for item_id, lastmod in live.items():
        c = cache.get(item_id)
        if c and c.get("lastmod") == lastmod and c.get("rec") and "thumb" in c["rec"]:
            continue
        try:
            cache[item_id] = {"lastmod": lastmod, "rec": gogo_item(item_id)}
        except Exception as e:
            print("  gogo", item_id, "건너뜀:", e)
        time.sleep(0.15)
    cache = {k: v for k, v in cache.items() if k in live}  # 내려간 매물은 지운다
    cache_f.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    items = [v["rec"] for v in cache.values() if v.get("rec")]
    out = [r for r in items if r["addr"].startswith("서울 강서구") and r["cat"] in ("아파트", "주택", "빌라", "오피스텔", "주거")]
    out.sort(key=lambda r: (r["modified"], r["id"]), reverse=True)
    from collections import Counter
    print(f"  GO부동산 매물: 사이트 전체 {len(items)} · 강서구 주거용 {len(out)} {dict(Counter(r['cat'] for r in out))}")
    return out


# ---------------------------------------------------------------- 직접 입력 양식
LISTINGS_TEMPLATE = {
    "_안내": "gogogogo.kr 에서 매물을 못 가져올 때 쓰는 직접 입력 양식입니다. items 에 매물을 추가하세요. 사진은 assets/listings/ 에 넣고 파일명을 적습니다.",
    "items": [],
    "_예시": {"title": "강서힐스테이트 33평 남향", "type": "매매|전세|월세", "cat": "아파트|빌라|주택", "dong": "화곡동", "complex": "강서힐스테이트",
              "area": 84.99, "supplyPy": 33, "floor": "12층/21층", "price": 157000, "deposit": 0, "photo": "assets/listings/10947.jpg",
              "point": "남향 · 확장 · 집구경 가능", "url": "https://gogogogo.kr/item/view/10947"},
}
PLANS_TEMPLATE = {
    "_안내": "주변 개발계획 입력 양식입니다. status 는 확정/추진중/계획/확실하지 않음 중 하나. 좌표는 카카오맵에서 확인해 넣습니다.",
    "items": [],
    "_예시": {"name": "대장홍대선 화곡역", "type": "교통", "status": "계획", "schedule": "착공·개통 시점 미정",
              "lat": 37.5417, "lon": 126.8403, "source": "국토교통부 보도자료 (URL)", "memo": ""},
}


# ---------------------------------------------------------------- main
def run(status, name, fn):
    t0 = time.time()
    try:
        res = fn()
        status[name] = {"ok": True, "at": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "sec": round(time.time() - t0)}
        return res
    except Exception as e:
        msg = str(e) if isinstance(e, ApiError) else f"{type(e).__name__}: {e}"
        print(f"  ✗ {name} 실패: {msg}")
        if not isinstance(e, ApiError):
            traceback.print_exc(limit=1)
        old = status.get(name, {})
        status[name] = {"ok": False, "error": msg, "at": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "last_ok": old.get("at") if old.get("ok") else old.get("last_ok")}
        return None


def main():
    args = sys.argv[1:]
    refresh = "--refresh" in args
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    want = lambda k: only is None or k in only
    missing = [k for k in ("DATA_GO_KR_KEY", "RONE_KEY", "KAKAO_KEY") if not ENV.get(k)]
    if missing:
        sys.exit(f".env 에 키가 없습니다: {', '.join(missing)}")
    DATA.mkdir(exist_ok=True)
    meta_f = DATA / "meta.json"
    meta = json.loads(meta_f.read_text(encoding="utf-8")) if meta_f.exists() else {}
    status = meta.get("status", {})

    for kind in ("apt", "rh", "sh"):
        if not want(kind):
            continue
        print(f"[실거래 {kind}]")
        tr = run(status, f"{kind}_trade", lambda: collect_deals(f"{kind}_trade", refresh))
        rt = run(status, f"{kind}_rent", lambda: collect_deals(f"{kind}_rent", refresh))
        if tr is None and rt is None:
            continue
        bld, t, r = compact(kind, tr or [], rt or [])
        if kind == "apt":
            run(status, "geocode", lambda: geocode(bld, "apt"))
        # 한쪽이 실패하면 그 거래는 비워 두고 missing·status 로 화면에 "데이터 없음"을 알린다
        save(f"{kind}.json", {"buildings": bld, "trades": t, "rents": r, "area": "연면적" if kind == "sh" else "전용면적",
                              "missing": [x for x, v in (("매매", tr), ("전월세", rt)) if v is None]})
        print(f"  → {kind}: 건물 {len(bld)} · 매매 {len(t)} · 전월세 {len(r)}")

    if want("rone"):
        print("[R-ONE]")
        res = run(status, "rone", collect_rone)
        if res:
            save("rone.json", res)
    if want("hug"):
        print("[HUG 분양가]")
        res = run(status, "hug", collect_hug)
        if res:
            save("hug.json", res)
    if want("subs"):
        print("[청약홈 모집공고]")
        res = run(status, "subscription", collect_subscription)
        if res is not None:
            save("subscription.json", res)
    if want("poi") and (refresh or not (DATA / "pois.json").exists() or (only and "poi" in only)):
        print("[주변시설]")
        res = run(status, "pois", collect_pois)
        if res:
            save("pois.json", res)
    if want("gogo"):
        print("[GO부동산 매물]")
        res = run(status, "gogo", collect_gogo)
        if res is not None:
            save("gogo.json", res)
    if want("office"):
        def office():
            d = kakao("search/address.json", query="서울 강서구 강서로 242", size=1)["documents"][0]
            return {"name": "GO부동산 공인중개사사무소", "addr": "서울 강서구 강서로 242 강서힐스테이트 상가동 1층 132호", "lat": float(d["y"]), "lon": float(d["x"])}
        res = run(status, "office", office)
        if res:
            save("office.json", res)

    for name, tpl in (("listings.json", LISTINGS_TEMPLATE), ("plans.json", PLANS_TEMPLATE)):
        if not (DATA / name).exists():
            (DATA / name).write_text(json.dumps(tpl, ensure_ascii=False, indent=2), encoding="utf-8")

    meta.update({"collected": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "months": [min(months()), max(months())], "status": status})
    meta_f.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n[결과]")
    for k, v in status.items():
        print(f"  {'✓' if v.get('ok') else '✗'} {k}" + ("" if v.get("ok") else f" — {v.get('error')}"))


if __name__ == "__main__":
    main()
