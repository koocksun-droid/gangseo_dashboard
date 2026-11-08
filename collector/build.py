"""data/dataset.json + data/pois.json 을 template.html 에 넣어 index.html 을 만든다.

  python collector/build.py
"""
import base64
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data"

MALL_NAMES = ("원그로브", "LEWEST", "르웨스트", "롯데몰", "타임스퀘어", "이랜드", "NC", "엔씨", "스타필드", "현대아울렛", "현대프리미엄아울렛", "마곡나루 보타닉")
HOSPITAL_NAMES = ("미즈메디", "이대서울", "부민병원", "서남병원", "메디힐", "힘찬병원", "대학교", "세브란스", "성모병원", "홍익병원", "강서송도병원")


def keep_poi(p):
    """카카오 검색 결과 중 브리핑에 쓸 만한 시설만 남긴다."""
    tag, name, _, _, cat = p
    if tag in ("dp", "hp") and any(name.endswith(k) for k in ("별관", "A동", "B동", "존", "센터", "본관")) and not name.endswith("병원 본관"):
        return False
    if tag == "dp":
        return cat != "인터넷쇼핑몰" and (any(k in cat for k in ("백화점", "아울렛", "복합쇼핑")) or any(k in name for k in MALL_NAMES))
    if tag == "mt":
        return not any(k in name for k in ("익스프레스", "에브리데이", "슈퍼"))
    if tag == "hp":
        if any(k in cat for k in ("동물", "한방", "요양", "정신", "치과")):
            return False
        return cat in ("종합병원", "대학병원") or any(k in name for k in HOSPITAL_NAMES)
    if tag == "pk":
        return name.endswith("공원") and "녹지" not in name
    return True


ds = json.loads((DATA / "dataset.json").read_text(encoding="utf-8"))
ds["pois"] = [p for p in json.loads((DATA / "pois.json").read_text(encoding="utf-8")) if keep_poi(p)]
ds["hs"] = json.loads((HERE / "assets" / "hs_listings.json").read_text(encoding="utf-8"))
ds["extra"] = json.loads((HERE / "assets" / "extra.json").read_text(encoding="utf-8"))

# 지도에 못 올리는 단지(좌표 없음)도 목록에는 남긴다. 숫자는 소수 넷째 자리까지면 충분
for a in ds["apts"]:
    for k in ("lat", "lon"):
        if a.get(k) is not None:
            a[k] = round(a[k], 5)
for t in ds["trades"]:
    t[2] = round(t[2], 2)
for r in ds["rents"]:
    r[2] = round(r[2], 2)

logo = base64.b64encode((HERE / "assets" / "logo.png").read_bytes()).decode()
html = (HERE / "template.html").read_text(encoding="utf-8")
html = html.replace("__LOGO__", "data:image/png;base64," + logo)
html = html.replace("/*__DATA__*/", "const D=" + json.dumps(ds, ensure_ascii=False, separators=(",", ":")) + ";")

out = ROOT / "index.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
