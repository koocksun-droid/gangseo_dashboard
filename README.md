# GO부동산 강서구 주거용 시장 브리핑

공인중개사 상담·홍보용 정적 대시보드입니다. `index.html` 이 `data/*.json` 을 읽어 화면을 그립니다.

- 공개 주소: https://koocksun-droid.github.io/gangseo_dashboard/
- 가상 데이터로 화면만 볼 때: 주소 뒤에 `?demo=1` (빨간 "가상 데이터" 띠가 표시됨)

## 폴더

| 경로 | 내용 |
|---|---|
| `index.html`, `assets/` | 화면 (app.js · app.css · logo.png) |
| `data/` | 수집된 데이터. `site.json`(상호·연락처·SNS), `listings.json`(직접 입력 매물), `plans.json`(개발계획)은 직접 고치는 파일 |
| `data-demo/` | 화면 확인용 가상 데이터 (`python collector/make_demo.py` 로 다시 만듦) |
| `collector/collect.py` | 데이터 수집기 |
| `.github/workflows/update.yml` | 매주 월요일 06:00 자동 수집·배포 |
| `데이터갱신_업로드.bat` | PC에서 수집해 바로 올리는 대안 |

## API 키

저장소 맨 위에 `.env` 파일을 만들어 넣습니다 (GitHub에는 올라가지 않음).

```
DATA_GO_KR_KEY=공공데이터포털 인증키(Decoding)
RONE_KEY=한국부동산원 R-ONE 인증키
KAKAO_KEY=카카오 REST API 키
```

GitHub 자동 수집용으로는 저장소 Settings → Secrets and variables → Actions 에 같은 이름으로 넣습니다.

공공데이터포털에서 아래 서비스를 각각 **활용신청**해야 해당 자료가 채워집니다. 신청 전에는 화면에 "데이터 없음"으로 나옵니다.
- 국토교통부_아파트 매매 실거래가 자료 / 아파트 전월세 실거래가 자료
- 국토교통부_연립다세대 매매 실거래가 자료 / 연립다세대 전월세 실거래가 자료
- 국토교통부_단독/다가구 매매 실거래가 자료 / 단독/다가구 전월세 실거래가 자료
- 한국부동산원_청약홈 분양정보 조회 서비스

HUG 신규 분양가는 공공데이터포털 파일데이터(15061057)를 키 없이 받습니다.

## 수동 갱신

```
python collector/collect.py                 # 전체 (최근 3개월 실거래만 새로 받고 나머지는 캐시)
python collector/collect.py --refresh       # 실거래·주변시설 모두 다시 받기
python collector/collect.py --only gogo     # 일부만: apt, rh, sh, rone, hug, subs, poi, gogo, office
```

수집 결과(성공·실패, 오류 내용)는 `data/meta.json` 의 `status` 에 남습니다. 실패한 자료는 이전 파일을 덮어쓰지 않습니다.

올리기: `git add data && git commit -m "데이터 갱신" && git push` — 또는 `데이터갱신_업로드.bat` 더블클릭.
GitHub 자동 수집이 국내 API 차단 등으로 실패하면 Actions 탭에 빨간 표시가 뜨고, 사이트는 이전 데이터로 유지됩니다. 이때 bat 파일을 쓰세요.

## 지역 바꾸기

`collector/collect.py` 맨 위의 `LAWD = "11500"` 을 다른 시군구 법정동 코드 앞 5자리로 바꾸고(예: 양천구 `11470`),
`BBOX`(지도 범위), R-ONE 지역 이름(`"강서구"`가 들어간 곳), `data/site.json` 의 `region` 을 맞춘 뒤 `--refresh` 로 다시 수집합니다.
화면 문구의 "강서구"는 `index.html`·`assets/app.js` 에서 바꿉니다.

## 매물 추가

1. 기본: GO부동산 홈페이지(gogogogo.kr)에 올린 강서구 주거용 매물을 자동으로 가져옵니다 (사이트맵 기준, 사진 포함).
2. 직접 추가: `data/listings.json` 의 `items` 에 `_예시` 형식대로 넣습니다. 사진은 `assets/listings/` 에 넣고 `"photo": "assets/listings/파일명.jpg"`.

## 개발계획 입력

`data/plans.json` 의 `items` 에 추가합니다. `status` 는 `확정` / `추진중` / `계획` / `확실하지 않음` 중 하나이고, 좌표는 카카오맵에서 위치를 찍어 확인합니다.
단지 상세의 입지분석에 거리순으로 상태 배지와 함께 표시됩니다.

## 연락처·SNS

`data/site.json` 에서 전화·주소·홈페이지·이메일·슬로건을 고칩니다. `blog`, `youtube`, `instagram` 에 주소를 넣으면 헤더·푸터에 아이콘이 나타나고, 비어 있으면 숨겨집니다.

## 데이터 출처

국토교통부 실거래가(공공데이터포털), 한국부동산원 R-ONE·청약홈, 주택도시보증공사 민간아파트 분양가격, 카카오 로컬, GO부동산 홈페이지, 지도 © OpenStreetMap contributors.
