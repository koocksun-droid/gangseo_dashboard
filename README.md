# GO부동산 강서구 아파트 브리핑

`index.html` 한 파일이 대시보드입니다. 데이터가 파일 안에 들어 있어 그대로 열거나 웹에 올리면 됩니다 (API 키는 들어 있지 않습니다).

## 데이터 새로 받기

```
python collector/collect.py
python collector/build.py
```

- `collect.py` — 국토교통부 실거래가(공공데이터포털), 한국부동산원 R-ONE, 카카오 로컬 API를 불러 `data/` 에 저장합니다. 지난 3개월 실거래는 매번 다시 받고, 그 이전 달은 `data/raw/` 에 저장된 것을 씁니다.
  - `--refresh` : 실거래·주변시설 전체 다시 받기
  - `--poi` : 주변 시설(지하철·학교·마트 등)만 다시 받기
- `build.py` — `collector/template.html` 에 데이터를 넣어 `index.html` 을 만듭니다.

API 키는 `collector/config.json` 에 있습니다. 이 파일은 공유하거나 깃허브에 올리지 마세요.

## 직접 고치는 내용

`collector/assets/extra.json`
- `office` : 상호·전화번호
- `recs` : 추천 매물 카드 (단지는 `["동", "단지명 일부"]` 로 지정)
- `dev` : 개발계획 목록 (좌표·설명·진행 단계)
- `lines` : 지하철역 노선 표시

`collector/assets/hs_listings.json` : 강서힐스테이트 평형별 매물 (날짜는 `extra.json` 의 `hsAsOf`)

고친 뒤 `python collector/build.py` 만 다시 실행하면 됩니다.
