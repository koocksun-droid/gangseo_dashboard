/* 강서구 주거용 시장 브리핑 — data/*.json 을 읽어 화면을 그린다. ?demo=1 이면 data-demo/ 의 가상 데이터를 쓴다. */
(function () {
"use strict";
const $ = s => document.querySelector(s);
const el = (t, a = {}, ...c) => { const e = document.createElement(t); for (const k in a) { const v = a[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v) } c.flat().forEach(x => x != null && x !== false && e.append(x)); return e };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };

const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const BASE = DEMO ? 'data-demo/' : 'data/';
const C = { red: '#E31E24', ink: '#222831', blue: '#2f6db5', gray: '#9aa1ab', amber: '#d48a12', green: '#1f8a4c', purple: '#7a4fb5' };
const PYC = 3.3058;
const DAY = 864e5;
const TYPES = { apt: { label: '아파트', full: '아파트', unit: '단지' }, rh: { label: '빌라', full: '빌라(연립다세대)', unit: '건물' }, sh: { label: '주택', full: '주택(단독다가구)', unit: '주택' } };

/* ---------- 숫자·날짜 ---------- */
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const won = m => { m = Math.round(m); if (!m) return '-'; const e = Math.floor(m / 10000), r = m % 10000; return e ? e + '억' + (r ? ' ' + r.toLocaleString('ko-KR') : '') : r.toLocaleString('ko-KR') + '만' };
const eok = m => (m / 10000).toFixed(m >= 100000 ? 1 : 2).replace(/\.?0+$/, '') + '억';
const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 };
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = (a, b) => (a && b) ? (a - b) / b * 100 : null;
const delta = (v, txt) => { if (v == null || !isFinite(v)) return el('span', { text: '비교 불가' }); const c = v > 0.05 ? 'up' : v < -0.05 ? 'dn' : ''; return el('span', {}, el('span', { class: c, text: (v > 0.05 ? '▲ ' : v < -0.05 ? '▼ ' : '- ') + Math.abs(v).toFixed(1) + '%' }), txt || '') };
const ppy = (amt, area) => area ? amt / area * PYC : 0;
const toT = s => Date.parse(s + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);
const hav = (a1, o1, a2, o2) => { const R = 6371000, t = Math.PI / 180, dA = (a2 - a1) * t, dO = (o2 - o1) * t; const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(dO / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) };
const fmtD = m => m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km';
const walk = m => Math.max(1, Math.round(m * 1.3 / 75)) + '분';
const pyOf = a => Math.round(a * (a < 50 ? 1.4 : a < 70 ? 1.32 : a < 90 ? 1.28 : a < 110 ? 1.25 : a < 140 ? 1.23 : 1.2) / PYC);
const noData = (msg, sub) => el('div', { class: 'nodata' }, msg || '데이터 없음', sub ? el('small', { text: sub }) : null);

/* ---------- 상태 ---------- */
const saved = store.get('go-gs3-ui', {});
const S = { type: saved.type || 'apt', dong: '전체', period: saved.period || '3m', unit: saved.unit || 'week', area: 'all', d1: null, d2: null, topKind: 't', topSort: 'max', subsTab: 'gs', deal: 't', qDong: '전체', sel: null };
const saveUI = () => store.set('go-gs3-ui', { type: S.type, period: S.period, unit: S.unit });
const G = {};  // 불러온 데이터

async function j(name) { try { const r = await fetch(BASE + name, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json() } catch (e) { return null } }
async function loadType(t) {
  if (G[t]) return G[t];
  const d = await j(t + '.json');
  if (!d) { G[t] = { b: [], t: [], r: [], missing: ['매매', '전월세'], area: '전용면적', last: null }; return G[t] }
  const b = d.buildings.map((x, i) => ({ ...x, id: i, t: [], r: [] }));
  d.trades.forEach(x => b[x[0]].t.push(x));
  d.rents.forEach(x => b[x[0]].r.push(x));
  const last = [d.trades.at(-1)?.[1], d.rents.at(-1)?.[1]].filter(Boolean).sort().at(-1) || null;
  G[t] = { b, t: d.trades, r: d.rents, missing: d.missing || [], area: d.area, last };
  return G[t];
}
const T = () => G[S.type];
const hasTrades = () => T().t.length > 0;

/* ---------- 기간·필터 ---------- */
function period() {
  const last = T().last || iso(Date.now());
  let d2 = toT(last), d1;
  const back = { '1w': 6, '4w': 27, '3m': 89, '6m': 181, '1y': 364 }[S.period];
  if (S.period === 'custom' && S.d1 && S.d2) { d1 = toT(S.d1); d2 = toT(S.d2); if (d1 > d2) [d1, d2] = [d2, d1] }
  else d1 = d2 - (back ?? 89) * DAY;
  const len = d2 - d1;
  return { a: iso(d1), b: iso(d2), pa: iso(d1 - len - DAY), pb: iso(d1 - DAY), days: Math.round(len / DAY) + 1 };
}
const AREA = { all: () => true, s: a => a <= 60, m: a => a > 60 && a <= 85, l: a => a > 85 };
const areaOk = a => AREA[S.area](a);
const dongOk = id => S.dong === '전체' || T().b[id].dong === S.dong;
const isJ = r => r[5] === 0;
function deals(kind, a, b, opt = {}) {
  const src = kind === 't' ? T().t : T().r;
  return src.filter(x => x[1] >= a && x[1] <= b && (opt.allDong || dongOk(x[0])) && areaOk(x[2]) && (kind === 't' || (kind === 'j' ? isJ(x) : !isJ(x))));
}

/* ---------- 차트 공통 ---------- */
const CH = {};
function chart(id, cfg) {
  if (CH[id]) CH[id].destroy();
  Chart.defaults.font.family = 'Pretendard,"Malgun Gothic",sans-serif'; Chart.defaults.color = '#6b7280'; Chart.defaults.borderColor = '#e6e8ec';
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } } } }, cfg.options || {});
  CH[id] = new Chart(document.getElementById(id), cfg);
}
function canvasOr(boxSel, id, ok, msg, sub) {  // 데이터가 없으면 캔버스 대신 안내
  const box = typeof boxSel === 'string' ? $(boxSel) : boxSel;
  if (!ok) { if (CH[id]) { CH[id].destroy(); delete CH[id] } box.replaceChildren(noData(msg, sub)); return false }
  if (!box.querySelector('#' + id)) box.replaceChildren(el('canvas', { id }));
  return true;
}
const line = (label, data, color, ext) => Object.assign({ type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .25, spanGaps: true }, ext || {});

/* ---------- 버킷(주간·월간) ---------- */
const wkKey = d => { const t = toT(d); const wd = (new Date(t).getUTCDay() + 6) % 7; return iso(t - wd * DAY) };
const bKey = d => S.unit === 'month' ? d.slice(0, 7) : wkKey(d);
function bucketsBetween(a, b) {
  const out = [];
  if (S.unit === 'month') { let [y, m] = a.slice(0, 7).split('-').map(Number); const [y2, m2] = b.slice(0, 7).split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { y++; m = 1 } } }
  else { for (let t = toT(wkKey(a)); t <= toT(b); t += 7 * DAY) out.push(iso(t)) }
  return out;
}
const bLabel = k => S.unit === 'month' ? k.slice(2).replace('-', '.') : k.slice(5).replace('-', '.');

/* ================= 헤더 · 푸터 ================= */
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 11h3v9h6v-6h2v6h6v-9h3z"/></svg>',
  blog: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 3h16v14H8l-4 4z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .6 12a31 31 0 0 0 .4 4.5 3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-4.5 31 31 0 0 0-.4-4.5zM9.8 15V9l5.2 3z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>'
};
function snsLinks() {
  const s = G.site, out = [];
  [['homepage', '홈페이지', 'home'], ['blog', '블로그', 'blog'], ['youtube', '유튜브', 'youtube'], ['instagram', '인스타', 'instagram']].forEach(([k, n, ic]) => {
    if (!s[k]) return;
    const a = el('a', { href: s[k], target: '_blank', rel: 'noopener' }); a.innerHTML = ICON[ic]; a.append(n); out.push(a);
  });
  return out;
}
function renderChrome() {
  const s = G.site;
  $('#hOffice').textContent = s.short; $('#hTel').textContent = s.tel; $('#hCall').href = 'tel:' + s.tel.replace(/-/g, '');
  $('#sns').replaceChildren(...snsLinks());
  $('#pOffice').textContent = s.office; $('#pAddr').textContent = s.addr; $('#pTel').textContent = '☎ ' + s.tel;
  $('#moreLink').href = s.listingsMore || s.homepage;
  const m = G.meta || {};
  $('#asof').textContent = `국토교통부 실거래가 · 한국부동산원 R-ONE 기준 · 데이터 수집 ${m.collected || '-'}` + (DEMO ? ' · 가상 데이터' : '');
  const src = '국토교통부 실거래가(공공데이터포털), 한국부동산원 R-ONE·청약홈, 주택도시보증공사(HUG) 분양가격, 카카오 로컬, GO부동산(gogogogo.kr) 매물, 지도 © OpenStreetMap contributors';
  $('#foot').replaceChildren(
    el('div', { class: 'top' }, el('img', { src: 'assets/logo.png', alt: 'GO부동산 로고' }), el('div', {}, el('div', { class: 'slogan', text: s.slogan }), el('div', {}, el('b', { text: s.office }), ` · ${s.ceo} · ☎ `, el('a', { href: 'tel:' + s.tel.replace(/-/g, ''), text: s.tel })))),
    el('div', {}, s.addr, ' · ', el('a', { href: s.homepage, target: '_blank', rel: 'noopener', text: s.homepage.replace(/^https?:\/\//, '') }), s.email ? ' · ' + s.email : '', ...snsLinks().flatMap(a => [' · ', a])),
    el('div', { text: '데이터 출처: ' + src }),
    el('div', { class: 'disc', text: '본 자료는 고객 상담용 참고자료이며 투자 판단의 책임은 본인에게 있습니다. 실거래가는 계약일 기준이며 신고기한(30일)으로 최근 자료는 늘어날 수 있습니다. 개발계획은 공개 자료를 정리한 것으로 일정·내용이 바뀔 수 있습니다.' }));
}

/* ================= 필터 바 ================= */
function segBind(sel, key, cb) {
  const seg = $(sel); const upd = () => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S[key])));
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S[key] = b.dataset.v; upd(); cb() }); upd(); return upd;
}
let updPeriod;
function initFilters() {
  segBind('#fType', 'type', async () => { saveUI(); await loadType(S.type); S.dong = '전체'; S.qDong = '전체'; S.sel = null; fillDongs(); renderAll(); hideDetail() });
  updPeriod = segBind('#fPeriod', 'period', () => { saveUI(); renderAll() });
  segBind('#fUnit', 'unit', () => { saveUI(); renderTrend(period()); renderIndex() });
  segBind('#topKind', 'topKind', () => renderTop(period()));
  segBind('#topSort', 'topSort', () => renderTop(period()));
  segBind('#subsTab', 'subsTab', renderSubs);
  segBind('#dealTab', 'deal', renderDeals);
  $('#fDong').onchange = e => { S.dong = e.target.value; S.qDong = S.dong; renderAll() };
  $('#fArea').onchange = e => { S.area = e.target.value; renderAll() };
  ['#fD1', '#fD2'].forEach(s => $(s).addEventListener('change', () => { S.d1 = $('#fD1').value; S.d2 = $('#fD2').value; S.period = 'custom'; updPeriod(); renderAll() }));
  $('#q').addEventListener('input', renderSearch);
  $('#qSort').onchange = renderSearch;
  $('#printBrief').onclick = () => doPrint('print-brief');
  $('#printPromo').onclick = () => doPrint('print-promo');
}
function fillDongs() {
  const cnt = {}; T().b.forEach(b => cnt[b.dong] = (cnt[b.dong] || 0) + b.t.length + b.r.length);
  const dongs = Object.keys(cnt).filter(d => cnt[d] > 0).sort((a, b) => cnt[b] - cnt[a]);
  G.dongs = dongs;
  $('#fDong').replaceChildren(el('option', { value: '전체', text: '강서구 전체' }), ...dongs.map(d => el('option', { value: d, text: d })));
  $('#fDong').value = S.dong;
}
function condText(p) {
  const ar = { all: '전체 면적', s: '60㎡ 이하', m: '60~85㎡', l: '85㎡ 초과' }[S.area];
  return `${TYPES[S.type].full} · ${S.dong === '전체' ? '강서구 전체' : S.dong} · ${p.a} ~ ${p.b} (${p.days}일) · ${S.unit === 'month' ? '월간' : '주간'} 집계 · ${ar}`;
}

/* ================= 1. 추천매물 ================= */
function listingsAll() {
  const g = (G.gogo || []).map(x => ({ ...x, src: 'gogo', dong: (x.addr.match(/강서구\s+(\S+동)/) || [])[1] || '' }));
  const manual = ((G.listings && G.listings.items) || []).map((x, i) => ({ id: 'm' + i, src: 'manual', title: x.title, type: x.type, cat: x.cat, dong: x.dong, addr: `서울 강서구 ${x.dong || ''}`, price: x.price, deposit: x.deposit || 0, area: x.area, supplyPy: x.supplyPy, floor: x.floor, dir: '', move: '', point: x.point, thumb: x.photo, img: x.photo, url: x.url, lat: x.lat, lon: x.lon, complex: x.complex }));
  return manual.concat(g);
}
const CAT_OF = { apt: ['아파트'], rh: ['빌라', '주택', '오피스텔'], sh: ['주택'] };
const floorTxt = f => { if (!f) return ''; const m = f.match(/현재층\s*:?\s*(\S+?)층.*총층\s*:?\s*(\d+)층/); if (m) return `${m[1]}층/${m[2]}층`; const t = f.match(/전체층\s*:?\s*(\d+)층/); return t ? `총 ${t[1]}층` : f };
const priceTxt = l => l.type === '월세' ? `월 ${l.deposit ? eok(l.deposit) : '-'} / ${fmt(l.price)}만` : `${l.type === '전세' ? '전' : '매'} ${won(l.price)}`;
function matchListing(l) {
  if (l.bid !== undefined || !G.apt) return;
  l.bid = null;
  if (l.lat == null) return;
  const comp = s => (s || '').replace(/[\s()·,]/g, '');
  const title = comp(l.complex || l.title);
  const cands = G.apt.b.filter(b => b.lat != null && (!l.dong || b.dong === l.dong)).map(b => ({ b, d: hav(l.lat, l.lon, b.lat, b.lon) })).filter(o => o.d < 250).sort((x, y) => x.d - y.d);
  const byName = cands.find(o => { const n = comp(o.b.name).replace(/아파트$/, ''); return n.length >= 2 && (title.includes(n) || n.includes(title.slice(0, 6))) });
  const hit = byName || (cands[0] && cands[0].d < 90 ? cands[0] : null);
  if (hit) l.bid = hit.b.id;
}
function renderListings() {
  const all = listingsAll();
  let list = all.filter(l => CAT_OF[S.type].includes(l.cat) && (S.dong === '전체' || l.dong === S.dong));
  let note = `GO부동산 홈페이지(gogogogo.kr) 등록 매물 ${all.length}건 중 ${TYPES[S.type].label}${S.dong !== '전체' ? ' · ' + S.dong : ''} ${list.length}건`;
  if (!list.length && all.length) { list = all; note = `조건에 맞는 매물이 없어 강서구 전체 매물을 보여드립니다 (${all.length}건)` }
  const box = $('#listings');
  if (!all.length) { box.replaceChildren(noData('등록된 추천매물이 없습니다', 'gogogogo.kr 매물을 가져오지 못하면 data/listings.json 에 직접 입력하세요')); $('#listNote').textContent = ''; return }
  box.replaceChildren(...list.slice(0, 8).map(l => {
    matchListing(l);
    const tcls = { 매매: 't', 전세: 'j', 월세: 'w' }[l.type] || '';
    const img = el('img', { src: l.thumb || l.img, alt: l.title, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => { e.target.replaceWith(el('div', { style: 'width:100%;height:100%;background:#eceef1 url(assets/logo.png) center/40% no-repeat' })) } });
    const py = l.supplyPy || (l.area ? pyOf(l.area) : 0);
    const point = l.point || [l.dir, l.move && l.move.length < 16 ? l.move : ''].filter(Boolean).join(' · ');
    return el('button', { type: 'button', class: 'lc', title: '누르면 아래에 입지분석이 열립니다', onclick: () => openListing(l) },
      el('div', { class: 'ph' }, img, el('div', { class: 'badge' }, el('span', { class: 'tag ' + tcls, text: l.type }), el('span', { class: 'tag', text: l.cat }))),
      el('div', { class: 'bd' }, el('div', { class: 'pr num', text: priceTxt(l) }), el('div', { class: 'nm', text: l.title }),
        el('div', { class: 'mt', text: [l.dong, l.area ? `전용 ${(+l.area).toFixed(1)}㎡${py ? ` (${py}평)` : ''}` : '', floorTxt(l.floor)].filter(Boolean).join(' · ') }),
        point ? el('div', { class: 'pt', text: point }) : null));
  }));
  $('#listNote').textContent = note + ' · 사진·가격은 홈페이지 기준이며 거래 완료 여부는 상담으로 확인해 주세요.';
}
async function openListing(l) {
  if (l.bid != null) { if (S.type !== 'apt') { S.type = 'apt'; document.querySelectorAll('#fType button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === 'apt'))); await loadType('apt'); fillDongs(); renderAll() } selectBuilding(l.bid, l) }
  else selectPoint({ name: l.title, dong: l.dong, lat: l.lat, lon: l.lon, listing: l });
}

/* ================= 시장 요약 (KPI) ================= */
function newHighs(p) {
  // 신고가 = 수집 기간 안에서 같은 건물·같은 면적(㎡ 반올림)의 이전 최고가를 넘긴 매매
  const best = new Map(); let n = 0;
  for (const x of T().t) {
    if (!areaOk(x[2])) continue;
    const k = x[0] + '|' + Math.round(x[2]);
    const prev = best.get(k);
    if (x[1] >= p.a && x[1] <= p.b && dongOk(x[0]) && prev != null && x[4] > prev) n++;
    if (prev == null || x[4] > prev) best.set(k, x[4]);
  }
  return n;
}
function kpi(k, v, d, np) { return el('div', { class: 'card kpi' + (np ? ' np' : '') }, el('div', { class: 'k', text: k }), v, el('div', { class: 'd num' }, d)) }
function renderKPI(p) {
  $('#kpiLabel').textContent = condText(p);
  const t = deals('t', p.a, p.b), tq = deals('t', p.pa, p.pb), j = deals('j', p.a, p.b), jq = deals('j', p.pa, p.pb), w = deals('w', p.a, p.b);
  const has = hasTrades();
  const tp = t.map(x => ppy(x[4], x[2])), tpq = tq.map(x => ppy(x[4], x[2]));
  const jp = j.map(x => ppy(x[4], x[2])), jpq = jq.map(x => ppy(x[4], x[2]));
  const ratio = has && tp.length && jp.length ? med(jp) / med(tp) * 100 : null, ratioQ = tpq.length && jpq.length ? med(jpq) / med(tpq) * 100 : null;
  const ND = el('div', { class: 'v', text: '데이터 없음' });
  const nd = '매매 실거래 API 미신청';
  $('#kpis').replaceChildren(
    kpi('매매 거래량', has ? el('div', { class: 'v num' }, fmt(t.length), el('small', { text: '건' })) : ND.cloneNode(true), has ? delta(pct(t.length, tq.length), ` 직전 동기간 ${fmt(tq.length)}건`) : nd),
    kpi('매매 평균가', has && t.length ? el('div', { class: 'v num', text: won(avg(t.map(x => x[4]))) }) : ND.cloneNode(true), has ? delta(pct(avg(t.map(x => x[4])), avg(tq.map(x => x[4]))), ' 직전 동기간 대비') : nd, true),
    kpi(`매매 평당가 (${T().area === '연면적' ? '연면적' : '전용'})`, has && t.length ? el('div', { class: 'v num' }, fmt(med(tp)), el('small', { text: '만/3.3㎡' })) : ND.cloneNode(true), has ? delta(pct(med(tp), med(tpq)), ' 중위값 · 직전 대비') : nd),
    kpi('전세 거래 · 평균보증금', el('div', { class: 'v num' }, fmt(j.length), el('small', { text: '건 · ' }), j.length ? eok(avg(j.map(x => x[4]))) : '-'), delta(pct(avg(j.map(x => x[4])), avg(jq.map(x => x[4]))), ' 보증금 · 직전 대비'), true),
    kpi('전세가율 (중위)', ratio ? el('div', { class: 'v num' }, ratio.toFixed(1), el('small', { text: '%' })) : ND.cloneNode(true), ratio ? (ratioQ ? `직전 ${ratioQ.toFixed(1)}% · 평당 중위 기준` : '평당 중위 기준') : (has ? '거래 부족' : nd)),
    kpi('월세 거래 · 신고가', el('div', { class: 'v num' }, fmt(w.length), el('small', { text: '건 · ' }), has ? fmt(newHighs(p)) : '-', el('small', { text: has ? '건' : '' })), has ? '신고가 = 수집기간 내 같은 면적 이전 최고가 경신' : '신고가는 매매 자료 필요', true));
}

/* ================= 2. 거래량·평당가 추이 ================= */
function renderTrend(p) {
  // 기간이 짧으면 추이가 안 보이므로 최소 12구간(주/월)은 보여준다
  const minBack = S.unit === 'month' ? 365 : 12 * 7;
  const a = iso(Math.min(toT(p.a), toT(p.b) - minBack * DAY));
  const ks = bucketsBetween(a, p.b);
  const grp = rows => { const m = {}; rows.forEach(x => { const k = bKey(x[1]); (m[k] = m[k] || []).push(x) }); return m };
  const T_ = grp(deals('t', a, p.b)), J_ = grp(deals('j', a, p.b)), W_ = grp(deals('w', a, p.b));
  const cnt = m => ks.map(k => (m[k] || []).length);
  const mp = m => ks.map(k => m[k] && m[k].length ? Math.round(med(m[k].map(x => ppy(x[4], x[2])))) : null);
  $('#trendLabel').textContent = `${TYPES[S.type].label} · ${S.dong === '전체' ? '강서구' : S.dong} · ${S.unit === 'month' ? '월간' : '주간(월요일 시작)'}`;
  const ds = [];
  if (hasTrades()) ds.push({ type: 'bar', label: '매매 건수', data: cnt(T_), backgroundColor: C.red, stack: 'c', yAxisID: 'y' });
  ds.push({ type: 'bar', label: '전세 건수', data: cnt(J_), backgroundColor: C.blue, stack: 'c', yAxisID: 'y' }, { type: 'bar', label: '월세 건수', data: cnt(W_), backgroundColor: C.amber, stack: 'c', yAxisID: 'y' });
  if (hasTrades()) ds.push(line('매매 평당 중위가', mp(T_), C.ink, { yAxisID: 'y2', pointRadius: 2 }));
  ds.push(line('전세 평당 중위가', mp(J_), C.green, { yAxisID: 'y2', pointRadius: 2, borderDash: [5, 4] }));
  chart('cTrend', { data: { labels: ks.map(bLabel), datasets: ds }, options: { scales: { y: { stacked: true, title: { display: true, text: '건수' } }, y2: { position: 'right', grid: { display: false }, title: { display: true, text: '만원/3.3㎡' }, ticks: { callback: v => fmt(v) } }, x: { stacked: true } } } });
  $('#trendNote').textContent = (hasTrades() ? '' : '매매 실거래 API 활용신청 전이라 매매는 표시하지 않습니다. ') + `평당가 = 거래금액 ÷ ${T().area} × 3.3058. 선택 기간이 짧으면 최근 ${S.unit === 'month' ? '12개월' : '12주'}를 함께 보여줍니다.`;
}

/* ================= 3. 지역별 평당가 ================= */
function renderRegion(p) {
  const rows = deals('t', p.a, p.b, { allDong: true });
  const by = {}; rows.forEach(x => { const d = T().b[x[0]].dong; (by[d] = by[d] || []).push(ppy(x[4], x[2])) });
  const list = Object.entries(by).map(([d, v]) => ({ d, v: avg(v), n: v.length })).sort((a, b) => b.v - a.v);
  if (!canvasOr('#regionBox', 'cRegion', list.length, hasTrades() ? '선택 기간에 매매 거래가 없습니다' : '데이터 없음', hasTrades() ? '' : '빌라·주택 매매 실거래는 공공데이터포털 활용신청 후 표시됩니다')) return;
  $('#regionBox').style.height = Math.max(240, list.length * 26 + 50) + 'px';
  chart('cRegion', { type: 'bar', data: { labels: list.map(o => o.d), datasets: [{ label: '평균 평당가(만원/3.3㎡)', data: list.map(o => Math.round(o.v)), backgroundColor: list.map(o => o.d === S.dong ? C.red : '#c9ced6'), borderRadius: 4 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmt(c.raw)}만 · ${list[c.dataIndex].n}건` } } }, scales: { x: { ticks: { callback: v => fmt(v) } } },
      onClick: (e, els) => { if (!els.length) return; const d = list[els[0].index].d; S.dong = S.dong === d ? '전체' : d; S.qDong = S.dong; $('#fDong').value = S.dong; renderAll() } } });
}

/* ================= 4. 가격지수·전세가율 ================= */
function renderIndex() {
  const r = G.rone || {};
  const wk = S.unit === 'week';
  const sk = wk ? 'sale_w' : 'sale_m', jk = wk ? 'jeonse_w' : 'jeonse_m';
  const base = (r[sk] || {})['강서구'] || [];
  $('#idxLabel').textContent = `아파트 · ${wk ? '주간 최근 1년' : '월간 최근 3년'}`;
  if (!base.length) { $('#cIndex').parentElement.replaceChildren(noData()); return }
  const keys = base.slice(wk ? -52 : -36).map(x => x[0]);
  const ser = (k, reg) => { const m = new Map(((r[k] || {})[reg]) || []); return keys.map(x => m.has(x) ? m.get(x) : null) };
  const lab = keys.map(k => wk ? k.slice(2).replace(/-/g, '.') : k.slice(2, 4) + '.' + k.slice(4));
  const ds = [line('강서구 매매', ser(sk, '강서구'), C.red), line('서울 매매', ser(sk, '서울'), C.blue), line('전국 매매', ser(sk, '전국'), C.gray),
    line('강서구 전세', ser(jk, '강서구'), C.red, { borderDash: [5, 4] }), line('서울 전세', ser(jk, '서울'), C.blue, { borderDash: [5, 4] })];
  if (!wk) ds.push(line('강서구 전세가율(%)', ser('ratio_m', '강서구'), C.amber, { yAxisID: 'y2', borderWidth: 2.5 }));
  chart('cIndex', { data: { labels: lab, datasets: ds }, options: { scales: { y: { title: { display: true, text: '지수' } }, ...(wk ? {} : { y2: { position: 'right', grid: { display: false }, title: { display: true, text: '전세가율 %' } } }) } } });
}

/* ================= 5. 면적대별 ================= */
function renderArea(p) {
  const sh = T().area === '연면적';
  const bins = sh ? [['100㎡ 이하', 0, 100], ['100~200㎡', 100, 200], ['200~300㎡', 200, 300], ['300~500㎡', 300, 500], ['500㎡ 초과', 500, 1e9]]
    : [['40㎡ 이하', 0, 40], ['40~60㎡', 40, 60], ['60~85㎡', 60, 85], ['85~102㎡', 85, 102], ['102~135㎡', 102, 135], ['135㎡ 초과', 135, 1e9]];
  const has = hasTrades();
  const rows = has ? deals('t', p.a, p.b) : [...deals('j', p.a, p.b), ...deals('w', p.a, p.b)];
  const inB = (x, b) => x[2] > b[1] && x[2] <= b[2];
  const cnt = bins.map(b => rows.filter(x => inB(x, b)).length);
  $('#areaLabel').textContent = `${has ? '매매' : '전월세(매매 자료 없음)'} ${fmt(rows.length)}건 · ${p.a} ~ ${p.b} · ${sh ? '연면적' : '전용면적'} 기준`;
  const pal = [C.gray, C.amber, C.red, C.blue, C.green, C.purple];
  const shareBox = $('#cAreaShare') ? $('#cAreaShare').parentElement : null;
  if (shareBox && canvasOr(shareBox, 'cAreaShare', rows.length, '선택 기간에 거래가 없습니다'))
    chart('cAreaShare', { type: 'doughnut', data: { labels: bins.map(b => b[0]), datasets: [{ data: cnt, backgroundColor: pal, borderColor: '#fff', borderWidth: 2 }] }, options: { interaction: { mode: 'nearest' }, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label}: ${c.raw}건 (${rows.length ? Math.round(c.raw / rows.length * 100) : 0}%)` } } } } });
  const avgBox = $('#cAreaAvg') ? $('#cAreaAvg').parentElement : null;
  if (avgBox && canvasOr(avgBox, 'cAreaAvg', has && rows.length, has ? '선택 기간에 거래가 없습니다' : '데이터 없음', has ? '' : '매매 실거래 API 활용신청 후 표시됩니다'))
    chart('cAreaAvg', { type: 'bar', data: { labels: bins.map(b => b[0]), datasets: [{ label: '평균 매매가', data: bins.map(b => { const v = rows.filter(x => inB(x, b)).map(x => x[4]); return v.length ? Math.round(avg(v)) : null }), backgroundColor: pal, borderRadius: 4 }] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => won(c.raw) } } }, scales: { y: { ticks: { callback: v => eok(v) } } } } });
}

/* ================= 6. 미분양 ================= */
function renderUnsold() {
  const u = (G.rone || {}).unsold_m || {};
  const gs = u['강서구'] || [], se = u['서울'] || [];
  if (!gs.length) { $('#cUnsold').parentElement.replaceChildren(noData('미분양 데이터 없음')); $('#tUnsold').replaceChildren(); return }
  const last = gs.slice(-24), seM = new Map(se);
  const lab = last.map(x => x[0].slice(2, 4) + '.' + x[0].slice(4));
  chart('cUnsold', { data: { labels: lab, datasets: [{ type: 'bar', label: '강서구 (호)', data: last.map(x => x[1]), backgroundColor: C.red, borderRadius: 3, yAxisID: 'y' }, line('서울 (호, 오른쪽)', last.map(x => seM.get(x[0]) ?? null), C.ink, { yAxisID: 'y2' })] },
    options: { scales: { y: { beginAtZero: true }, y2: { position: 'right', grid: { display: false }, beginAtZero: true } } } });
  const rows = gs.slice(-6).reverse();
  $('#tUnsold').replaceChildren(el('thead', {}, el('tr', {}, el('th', { class: 'l', text: '기준월' }), el('th', { text: '강서구' }), el('th', { text: '전월 대비' }), el('th', { text: '서울' }))),
    el('tbody', {}, ...rows.map((x, i) => { const prev = gs[gs.length - 1 - i - 1]; const dv = prev ? x[1] - prev[1] : null; return el('tr', {}, el('td', { class: 'l', text: `${x[0].slice(0, 4)}년 ${+x[0].slice(4)}월` }), el('td', { class: 'num', text: fmt(x[1]) + '호' }), el('td', { class: 'num ' + (dv > 0 ? 'up' : dv < 0 ? 'dn' : ''), text: dv == null ? '-' : (dv > 0 ? '+' : '') + fmt(dv) }), el('td', { class: 'num', text: seM.has(x[0]) ? fmt(seM.get(x[0])) + '호' : '-' })) })));
}

/* ================= 7. HUG 분양가 vs 실거래 ================= */
function renderHug() {
  const h = G.hug && G.hug.series && G.hug.series['모든면적'];
  const box = $('#cHug').parentElement;
  if (!h || !h.length || !G.apt || !G.apt.t.length) { box.replaceChildren(noData('분양가 또는 실거래 데이터 없음')); return }
  const start = G.apt.t[0][1].slice(0, 7).replace('-', '');
  const hm = new Map(h.map(([k, v]) => [k, Math.round(v * PYC / 10)]));  // 천원/㎡ → 만원/3.3㎡
  const tm = {}; G.apt.t.forEach(x => { const k = x[1].slice(0, 7).replace('-', ''); (tm[k] = tm[k] || []).push(ppy(x[4], x[2])) });
  const keys = [...new Set([...h.map(x => x[0]).filter(k => k >= start), ...Object.keys(tm)])].sort();
  chart('cHug', { type: 'line', data: { labels: keys.map(k => k.slice(2, 4) + '.' + k.slice(4)), datasets: [line('서울 신규 분양가 (HUG)', keys.map(k => hm.get(k) ?? null), C.red, { pointRadius: 2 }), line('강서구 아파트 실거래 중위', keys.map(k => tm[k] ? Math.round(med(tm[k])) : null), C.ink, { pointRadius: 2 })] },
    options: { scales: { y: { ticks: { callback: v => fmt(v) } } } } });
}

/* ================= 8. 분양 일정 ================= */
function renderSubs() {
  const box = $('#subsBox');
  const st = ((G.meta || {}).status || {}).subscription;
  if (!G.subs) { box.replaceChildren(el('div', { class: 'pad' }, noData('데이터 없음', st && !st.ok ? `청약홈 분양정보 API: ${st.error}` : '청약홈 분양정보를 아직 수집하지 않았습니다'))); return }
  const NEAR = ['양천구', '마포구', '영등포구', '구로구'];
  const rows = G.subs.filter(r => S.subsTab === 'all' || (S.subsTab === 'gs' ? r.gu === '강서구' : NEAR.includes(r.gu)));
  if (!rows.length) { box.replaceChildren(el('div', { class: 'pad' }, noData('해당 지역 모집공고가 없습니다'))); return }
  const d = s => s ? s.slice(2).replace(/-/g, '.') : '-';
  box.replaceChildren(el('div', { class: 'tbl' }, el('table', {}, el('thead', {}, el('tr', {}, ...['단지 · 위치', '구', '모집공고', '청약 접수', '당첨 발표', '입주 예정', '세대'].map((h, i) => el('th', { class: i < 2 ? 'l' : '', text: h })))),
    el('tbody', {}, ...rows.slice(0, 60).map(r => el('tr', {}, el('td', { class: 'l' }, r.url ? el('a', { href: r.url, target: '_blank', rel: 'noopener', text: r.name }) : r.name, el('span', { class: 'sub', text: r.addr })), el('td', { class: 'l', text: r.gu }),
      el('td', { class: 'num', text: d(r.notice) }), el('td', { class: 'num', text: `${d(r.start)}~${d(r.end).slice(3)}` }), el('td', { class: 'num', text: d(r.win) }), el('td', { class: 'num', text: r.move ? r.move.slice(2, 4) + '.' + r.move.slice(4) : '-' }), el('td', { class: 'num', text: r.units ? fmt(r.units) : '-' })))))));
}

/* ================= 9. 단지 검색 ================= */
function bName(b) { return S.type === 'sh' ? `${b.dong} ${b.jibun || ''} ${b.name}`.trim() : b.name || `${b.dong} ${b.jibun}` }
function renderSearch() {
  const ty = TYPES[S.type];
  $('#searchTitle').textContent = `${ty.label} ${ty.unit} 검색`;
  const dongs = ['전체', ...(G.dongs || [])];
  $('#qDong').replaceChildren(...dongs.map(d => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.qDong === d), onclick: () => { S.qDong = d; renderSearch() } }, d)));
  const q = $('#q').value.trim().replace(/\s/g, '');
  let list = T().b.filter(b => (b.t.length + b.r.length) > 0 && (S.qDong === '전체' || b.dong === S.qDong) && (!q || (bName(b) + b.dong).replace(/\s/g, '').includes(q)));
  const lastT = b => b.t.at(-1), lastJ = b => { for (let i = b.r.length - 1; i >= 0; i--) if (isJ(b.r[i])) return b.r[i]; return null };
  const lastAny = b => [lastT(b)?.[1], b.r.at(-1)?.[1]].filter(Boolean).sort().at(-1) || '';
  const sorts = { recent: (a, b) => lastAny(b).localeCompare(lastAny(a)), name: (a, b) => bName(a).localeCompare(bName(b)), price: (a, b) => (lastT(b)?.[4] || 0) - (lastT(a)?.[4] || 0), cnt: (a, b) => (b.t.length + b.r.length) - (a.t.length + a.r.length), new: (a, b) => (b.built || 0) - (a.built || 0) };
  list.sort(sorts[$('#qSort').value]);
  const total = list.length; list = list.slice(0, 200);
  const cell = x => x ? el('td', { class: 'num' }, won(x[4]), el('span', { class: 'sub', text: `${x[2]}㎡ · ${x[1].slice(2).replace(/-/g, '.')}` })) : el('td', { class: 'num', text: '-' });
  $('#tSearch').replaceChildren(el('caption', { class: 'src', style: 'text-align:left;padding:6px 10px', text: `${fmt(total)}개 ${ty.unit}` + (total > 200 ? ' · 상위 200개 표시' : '') }),
    el('thead', {}, el('tr', {}, el('th', { class: 'l', text: ty.unit + '명' }), el('th', { class: 'l', text: '위치' }), el('th', { text: '준공' }), el('th', { text: '최근 매매' }), el('th', { text: '최근 전세' }), el('th', { text: '거래' }))),
    el('tbody', {}, ...list.map(b => el('tr', { class: 'click' + (S.sel && S.sel.bid === b.id ? ' on' : ''), onclick: () => selectBuilding(b.id) }, el('td', { class: 'l' }, el('b', { text: bName(b) })), el('td', { class: 'l', text: b.dong }), el('td', { class: 'num', text: b.built || '-' }), cell(lastT(b)), cell(lastJ(b)), el('td', { class: 'num', text: fmt(b.t.length + b.r.length) })))));
}

/* ================= 10. 위치 안내 ================= */
let officeMap;
function baseMap(id, center, zoom) {
  const m = L.map(id, { scrollWheelZoom: false }).setView(center, zoom);
  // CARTO 타일은 2026년 기준 API 키가 있어야 해서(키 없으면 'API KEY REQUIRED' 표시) OpenStreetMap 기본 타일을 쓴다
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
  return m;
}
function renderOffice() {
  const s = G.site, o = G.office;
  const tel = s.tel.replace(/-/g, '');
  const kmap = o ? `https://map.kakao.com/link/to/${encodeURIComponent(s.short)},${o.lat},${o.lon}` : `https://map.kakao.com/?q=${encodeURIComponent(s.addr)}`;
  $('#officeInfo').replaceChildren(el('img', { src: 'assets/logo.png', alt: 'GO부동산 로고' }), el('div', { style: 'font-size:20px;font-weight:900', text: s.office }), el('div', { class: 'src', text: s.ceo }),
    el('div', { text: s.addr }), el('a', { class: 'tel num', href: 'tel:' + tel, text: '☎ ' + s.tel }),
    el('div', { class: 'btns noprint' }, el('a', { class: 'more', href: kmap, target: '_blank', rel: 'noopener', text: '카카오맵 길찾기' }), el('a', { class: 'more', style: 'background:var(--red)', href: s.homepage, target: '_blank', rel: 'noopener', text: '홈페이지' })));
  if (!o) { $('#officeMap').replaceChildren(noData('사무소 좌표 없음')); return }
  if (!officeMap) {
    officeMap = baseMap('officeMap', [o.lat, o.lon], 16);
    L.marker([o.lat, o.lon], { icon: L.divIcon({ className: '', html: '<div class="mk big">GO</div>', iconSize: [34, 34], iconAnchor: [17, 17] }), title: s.office }).bindPopup(`<b>${s.office}</b><br>${s.addr}<br>☎ ${s.tel}`).addTo(officeMap).openPopup();
  }
}

/* ================= 11. TOP 10 ================= */
let topMap, topLayer, TOP = [];
function renderTop(p) {
  const ty = TYPES[S.type];
  $('#topTitle').textContent = `${ty.label} TOP 10`;
  const kn = { t: '매매', j: '전세', w: '월세' }[S.topKind];
  $('#topLabel').textContent = `${kn} · ${S.topSort === 'max' ? '최고가순' : '거래량순'} · ${p.a} ~ ${p.b}`;
  const rows = deals(S.topKind, p.a, p.b);
  const m = new Map();
  rows.forEach(x => { let o = m.get(x[0]); if (!o) { o = { id: x[0], n: 0, max: null }; m.set(x[0], o) } o.n++; const v = S.topKind === 'w' ? x[5] : x[4]; if (!o.max || v > (S.topKind === 'w' ? o.max[5] : o.max[4])) o.max = x });
  const val = o => S.topKind === 'w' ? o.max[5] : o.max[4];
  TOP = [...m.values()].sort((a, b) => S.topSort === 'cnt' ? b.n - a.n || val(b) - val(a) : val(b) - val(a)).slice(0, 10);
  const tb = $('#tTop');
  if (S.topKind === 't' && !hasTrades()) { tb.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'l' }, noData('데이터 없음', '매매 실거래 API 활용신청 후 표시됩니다'))))); renderTopMap(); return }
  if (!TOP.length) { tb.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'l' }, noData('선택 기간에 거래가 없습니다'))))); renderTopMap(); return }
  const priceCell = x => S.topKind === 'w' ? `${eok(x[4])} / ${fmt(x[5])}만` : won(x[4]);
  tb.replaceChildren(el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { class: 'l', text: ty.unit }), el('th', { text: S.topKind === 'w' ? '최고 월세' : '최고가' }), el('th', { text: '면적 · 층' }), el('th', { text: '거래' }))),
    el('tbody', {}, ...TOP.map((o, i) => { const b = T().b[o.id]; return el('tr', { class: 'click', onclick: () => selectBuilding(o.id) }, el('td', {}, el('span', { class: 'mk' + (i < 3 ? ' r' : ''), style: 'display:inline-grid;width:24px;height:24px;font-size:11px', text: i + 1 })),
      el('td', { class: 'l' }, el('b', { text: bName(b) }), el('span', { class: 'sub', text: `${b.dong}${b.built ? ' · ' + b.built + '년' : ''}` })), el('td', { class: 'num' }, el('b', { text: priceCell(o.max) }), el('span', { class: 'sub', text: o.max[1] })), el('td', { class: 'num', text: `${o.max[2]}㎡ · ${o.max[3] || '-'}층` }), el('td', { class: 'num', text: o.n + '건' })) })));
  renderTopMap();
}
function renderTopMap() {
  if (!topMap) { topMap = baseMap('topMap', [37.556, 126.838], 13); topLayer = L.layerGroup().addTo(topMap) }
  topLayer.clearLayers();
  const pts = [];
  TOP.forEach((o, i) => { const b = T().b[o.id]; if (b.lat == null) return; pts.push([b.lat, b.lon]);
    L.marker([b.lat, b.lon], { icon: L.divIcon({ className: '', html: `<div class="mk ${i < 3 ? 'r' : ''}">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), title: bName(b), zIndexOffset: 100 - i }).on('click', () => selectBuilding(o.id)).bindTooltip(bName(b)).addTo(topLayer) });
  if (pts.length) topMap.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  else if (TOP.length) topLayer.addLayer(L.marker([37.556, 126.838], { opacity: 0 }).bindTooltip(`${TYPES[S.type].label}는 위치 좌표를 수집하지 않아 지도에 표시하지 않습니다`, { permanent: true, direction: 'center' }));
}

/* ================= 12. 단지 상세 ================= */
function hideDetail() { $('#s-detail').classList.add('hidden') }
function selectBuilding(bid, listing) {
  const b = T().b[bid];
  S.sel = { bid, type: S.type, name: bName(b), dong: b.dong, lat: b.lat, lon: b.lon, listing };
  showDetail();
}
function selectPoint(pt) { S.sel = { bid: null, ...pt }; showDetail() }
function showDetail() {
  const s = S.sel; const sec = $('#s-detail'); sec.classList.remove('hidden');
  const b = s.bid != null ? G[s.type].b[s.bid] : null;
  $('#detailLabel').textContent = b ? `${TYPES[s.type].full} · 수집 기간 전체 실거래` : 'GO부동산 매물 위치 기준';
  $('#dAddr').textContent = b ? `서울 강서구 ${b.dong} ${b.jibun || ''}` : (s.listing ? s.listing.addr : '');
  $('#dName').textContent = s.name;
  const st = (k, v, sub) => el('div', {}, el('div', { class: 'k', text: k }), el('div', { class: 'v num', text: v }), el('div', { class: 's', text: sub || '' }));
  if (b) {
    const y = iso(toT(G[s.type].last) - 365 * DAY);
    const t1 = b.t.filter(x => x[1] >= y), j1 = b.r.filter(x => isJ(x) && x[1] >= y), lt = b.t.at(-1), lr = b.r.at(-1);
    $('#dStats').replaceChildren(st('준공', b.built ? b.built + '년' : '-', b.built ? `${new Date().getFullYear() - b.built + 1}년차 (실거래 기준)` : ''),
      st('최근 매매', lt ? won(lt[4]) : (G[s.type].missing.includes('매매') ? '데이터 없음' : '-'), lt ? `${lt[1]} · ${lt[2]}㎡ · ${lt[3]}층` : ''),
      st('1년 매매 평당가', t1.length ? fmt(med(t1.map(x => ppy(x[4], x[2])))) + '만' : '-', `중위 · ${t1.length}건`),
      st('1년 전세 평당가', j1.length ? fmt(med(j1.map(x => ppy(x[4], x[2])))) + '만' : '-', `중위 · ${j1.length}건`),
      st('최근 전월세', lr ? (isJ(lr) ? '전세 ' + won(lr[4]) : `${eok(lr[4])} / ${fmt(lr[5])}만`) : '-', lr ? `${lr[1]} · ${lr[2]}㎡ ${lr[6] ? '· ' + lr[6] : ''}` : ''));
    $('#dDeals').classList.remove('hidden');
    renderDetailChart(b, s.type); renderDeals();
  } else {
    const l = s.listing;
    $('#dStats').replaceChildren(st('매물 가격', l ? priceTxt(l) : '-', l ? l.type : ''), st('전용면적', l && l.area ? (+l.area).toFixed(1) + '㎡' : '-', l && l.supplyPy ? l.supplyPy + '평형' : ''), st('층', l ? floorTxt(l.floor) || '-' : '-'), st('향', l && l.dir || '-'), st('입주', l && l.move || '-'));
    $('#dDeals').classList.add('hidden');
  }
  if (s.listing && s.listing.url) $('#dStats').append(el('div', {}, el('div', { class: 'k', text: 'GO부동산 매물' }), el('a', { href: s.listing.url, target: '_blank', rel: 'noopener', class: 'v', style: 'color:var(--red);font-size:15px', text: `매물번호 ${s.listing.id} 보기 →` })));
  renderLoc();
  renderSearch();
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderDetailChart(b, type) {
  const groups = {}; b.t.forEach(x => { const k = type === 'sh' ? '전체' : pyOf(x[2]) + '평형'; (groups[k] = groups[k] || []).push(x) });
  const pal = [C.red, C.blue, C.green, C.amber, C.purple, C.gray];
  const box = $('#cDetail').parentElement;
  if (!canvasOr(box, 'cDetail', b.t.length, G[type].missing.includes('매매') ? '데이터 없음' : '수집 기간에 매매 거래가 없습니다', G[type].missing.includes('매매') ? '매매 실거래 API 활용신청 후 표시됩니다' : '')) return;
  const mon = {}; b.t.forEach(x => { const k = x[1].slice(0, 7); (mon[k] = mon[k] || []).push(x[4]) });
  const medLine = Object.keys(mon).sort().map(k => ({ x: toT(k + '-15'), y: med(mon[k]) }));
  const ds = Object.entries(groups).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([k, v], i) => ({ type: 'scatter', label: k, data: v.map(x => ({ x: toT(x[1]), y: x[4], f: x[3], a: x[2] })), backgroundColor: pal[i % pal.length] + 'cc', pointRadius: 4 }));
  ds.push({ type: 'line', label: '월별 중위가', data: medLine, borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2, pointRadius: 0, tension: .25 });
  chart('cDetail', { data: { datasets: ds }, options: { interaction: { mode: 'nearest', intersect: true }, plugins: { tooltip: { callbacks: { label: c => c.raw.f != null ? `${iso(c.raw.x)} · ${c.raw.a}㎡ · ${c.raw.f}층 · ${won(c.raw.y)}` : `${iso(c.raw.x).slice(0, 7)} 중위 ${won(c.raw.y)}` } } },
    scales: { x: { type: 'linear', ticks: { callback: v => iso(v).slice(2, 7).replace('-', '.'), maxTicksLimit: 8 } }, y: { ticks: { callback: v => eok(v) } } } } });
}
function renderDeals() {
  const s = S.sel; if (!s || s.bid == null) return;
  const b = G[s.type].b[s.bid], tb = $('#tDeals');
  if (S.deal === 't') {
    const rows = b.t.slice().reverse().slice(0, 80);
    tb.replaceChildren(el('thead', {}, el('tr', {}, ...['계약일', '면적', '층', '거래금액', '평당가'].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))),
      el('tbody', {}, ...(rows.length ? rows.map(x => el('tr', {}, el('td', { class: 'l num', text: x[1] }), el('td', { class: 'num', text: x[2] + '㎡' }), el('td', { class: 'num', text: x[3] || '-' }), el('td', { class: 'num', text: won(x[4]) }), el('td', { class: 'num', text: fmt(ppy(x[4], x[2])) + '만' })))
        : [el('tr', {}, el('td', { class: 'l', colspan: 5, text: G[s.type].missing.includes('매매') ? '데이터 없음 (매매 실거래 API 활용신청 필요)' : '매매 거래가 없습니다' }))])));
  } else {
    const rows = b.r.slice().reverse().slice(0, 120);
    tb.replaceChildren(el('thead', {}, el('tr', {}, ...['계약일', '구분', '면적', '층', '보증금', '월세', '신규/갱신'].map((h, i) => el('th', { class: i < 2 ? 'l' : '', text: h })))),
      el('tbody', {}, ...(rows.length ? rows.map(x => el('tr', {}, el('td', { class: 'l num', text: x[1] }), el('td', { class: 'l', text: isJ(x) ? '전세' : '월세' }), el('td', { class: 'num', text: x[2] + '㎡' }), el('td', { class: 'num', text: x[3] || '-' }), el('td', { class: 'num', text: won(x[4]) }), el('td', { class: 'num', text: x[5] ? fmt(x[5]) + '만' : '-' }), el('td', { class: 'num', text: x[6] || '-' })))
        : [el('tr', {}, el('td', { class: 'l', colspan: 7, text: '전월세 거래가 없습니다' }))])));
  }
}

/* ---------- 입지분석 ---------- */
const LAY = [['st', '지하철', '#2f6db5', 'M'], ['e', '초등학교', '#1f8a4c', '초'], ['m', '중학교', '#1f8a4c', '중'], ['h', '고등학교', '#1f8a4c', '고'], ['mt', '대형마트', '#d48a12', '마'], ['hp', '병원', '#E31E24', '병'], ['pk', '공원', '#3f9a3a', 'P'], ['po', '관공서', '#5b6770', '관'], ['plan', '개발계획', '#7a4fb5', '개'], ['apt', '주변 단지', '#222831', '₩']];
const LAYC = Object.fromEntries(LAY.map(l => [l[0], l]));
let locMap, locGroups = {};
const lay = store.get('go-gs3-layers', Object.fromEntries(LAY.map(l => [l[0], true])));
const poisNear = (tag, a, r) => (G.pois || []).filter(p => p[0] === tag).map(p => ({ p, d: hav(a.lat, a.lon, p[2], p[3]) })).filter(o => o.d <= r).sort((x, y) => x.d - y.d);
function stations(a, r) { const m = new Map(); (G.pois || []).filter(p => p[0] === 'st').forEach(p => { const base = p[1].split(' ')[0]; const line = p[1].split(' ').slice(1).join(' ').replace('수도권', ''); const d = hav(a.lat, a.lon, p[2], p[3]); const o = m.get(base); if (!o) m.set(base, { name: base, d, lines: new Set([line || p[4].replace('수도권', '')]), p }); else { o.lines.add(line || p[4]); if (d < o.d) { o.d = d; o.p = p } } }); return [...m.values()].filter(o => o.d <= r).sort((x, y) => x.d - y.d) }
const STATUS = { '확정': 's1', '추진중': 's2', '계획': 's3', '확실하지 않음': 's4' };
function renderLoc() {
  const s = S.sel; const cards = $('#locCards');
  if (s.lat == null) { cards.replaceChildren(el('div', { class: 'card lcard wide' }, noData('위치 좌표가 없습니다', TYPES[s.type || S.type].label + '는 좌표를 수집하지 않아 입지분석을 표시하지 않습니다'))); if (locMap) locMap.remove(), locMap = null; $('#locMap').replaceChildren(); return }
  if (!locMap) { locMap = baseMap('locMap', [s.lat, s.lon], 15); renderLayerBtns() }
  Object.values(locGroups).forEach(g => g.remove()); locGroups = {};
  const grp = k => (locGroups[k] = locGroups[k] || L.layerGroup());
  const base = grp('_base');
  L.circle([s.lat, s.lon], { radius: 1000, color: C.red, weight: 1.5, fillOpacity: .03, dashArray: '6 6' }).addTo(base);
  L.circle([s.lat, s.lon], { radius: 500, color: C.red, weight: 1.5, fillOpacity: .06 }).addTo(base);
  L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="mk big">★</div>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000, title: s.name }).bindTooltip(s.name).addTo(base);
  const pin = (k, lat, lon, tip) => L.marker([lat, lon], { icon: L.divIcon({ className: '', html: `<div class="pmk" style="background:${LAYC[k][2]}">${LAYC[k][3]}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }), title: tip }).bindTooltip(tip).addTo(grp(k));
  const sts = stations(s, 2500);
  sts.slice(0, 5).forEach(o => pin('st', o.p[2], o.p[3], `${o.name} · ${fmtD(o.d)}`));
  const sch = { e: poisNear('e', s, 2000).slice(0, 3), m: poisNear('m', s, 2500).slice(0, 3), h: poisNear('h', s, 3000).slice(0, 3) };
  Object.entries(sch).forEach(([k, v]) => v.forEach(o => pin(k, o.p[2], o.p[3], `${o.p[1]} · ${fmtD(o.d)}`)));
  const life = { mt: poisNear('mt', s, 3000).slice(0, 3), hp: poisNear('hp', s, 3000).slice(0, 3), pk: poisNear('pk', s, 1500).slice(0, 4), po: poisNear('po', s, 1500).slice(0, 4) };
  Object.entries(life).forEach(([k, v]) => v.forEach(o => pin(k, o.p[2], o.p[3], `${o.p[1]} · ${fmtD(o.d)}`)));
  const plans = ((G.plans && G.plans.items) || []).filter(p => p.lat && p.lon).map(p => ({ p, d: hav(s.lat, s.lon, p.lat, p.lon) })).sort((x, y) => x.d - y.d);
  plans.forEach(o => pin('plan', o.p.lat, o.p.lon, `${o.p.name} (${o.p.status || '-'})`));
  if (G.apt) G.apt.b.filter(b => b.lat != null && b.t.length >= 3).map(b => ({ b, d: hav(s.lat, s.lon, b.lat, b.lon) })).filter(o => o.d <= 1000 && o.d > 20).sort((x, y) => y.b.t.length - x.b.t.length).slice(0, 12).forEach(o => {
    const y = iso(toT(G.apt.last) - 365 * DAY); const t1 = o.b.t.filter(x => x[1] >= y); if (!t1.length) return;
    L.marker([o.b.lat, o.b.lon], { icon: L.divIcon({ className: '', html: `<div style="background:#fff;border:1px solid #c9ced6;border-radius:6px;padding:1px 5px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.15)">${o.b.name.slice(0, 8)} ${fmt(med(t1.map(x => ppy(x[4], x[2]))))}</div>`, iconSize: null, iconAnchor: [0, 8] }), title: o.b.name }).addTo(grp('apt'));
  });
  applyLayers(); locMap.setView([s.lat, s.lon], 15); setTimeout(() => locMap.invalidateSize(), 80);
  const li = (n, v, extra) => el('li', {}, el('span', {}, n, extra || ''), el('span', { class: 'num', text: v }));
  const card = (k, title, items, cls) => el('div', { class: 'card lcard' + (cls ? ' ' + cls : '') }, el('h4', {}, el('i', { style: `background:${LAYC[k][2]}`, text: LAYC[k][3] }), title), el('ul', {}, ...(items.length ? items : [li('반경 안에 없음', '')])));
  const wl = o => `${fmtD(o.d)} · 도보 ${walk(o.d)}`;
  cards.replaceChildren(
    card('st', '교통 · 지하철', sts.slice(0, 4).map(o => li(o.name, wl(o), el('span', { class: 'src', text: ' ' + [...o.lines].filter(Boolean).join('·') })))),
    card('e', '학군 · 초/중/고 최단거리', ['e', 'm', 'h'].map(k => sch[k][0] ? li(sch[k][0].p[1], wl(sch[k][0])) : li({ e: '초등학교', m: '중학교', h: '고등학교' }[k] + ' 없음', ''))),
    card('mt', '생활 · 마트·병원', [...life.mt.slice(0, 2), ...life.hp.slice(0, 2)].map(o => li(o.p[1], fmtD(o.d)))),
    card('pk', '공원 · 관공서', [...life.pk.slice(0, 2), ...life.po.slice(0, 3)].map(o => li(o.p[1], fmtD(o.d)))),
    el('div', { class: 'card lcard wide' }, el('h4', {}, el('i', { style: `background:${LAYC.plan[2]}`, text: '개' }), '주변 개발계획'),
      plans.length ? el('ul', {}, ...plans.slice(0, 6).map(o => el('li', { style: 'display:block;padding:5px 0;border-bottom:1px dashed #e6e8ec' }, el('b', { text: o.p.name }), el('span', { class: 'st ' + (STATUS[o.p.status] || 's4'), text: o.p.status || '확실하지 않음' }), el('span', { class: 'src', text: ` ${fmtD(o.d)}${o.p.schedule ? ' · ' + o.p.schedule : ''}` }), o.p.source ? el('div', { class: 'src', text: '출처: ' + o.p.source }) : null)))
        : el('div', { class: 'src', text: '등록된 개발계획이 없습니다. data/plans.json 에 입력하면 거리순으로 표시됩니다.' })),
    el('div', { class: 'src lcard wide', style: 'padding:0 4px', text: '도보 시간은 직선거리 기준 추정치입니다 (직선거리 × 1.3 ÷ 분당 75m).' }));
}
function renderLayerBtns() {
  $('#layers').replaceChildren(...LAY.map(l => el('button', { type: 'button', 'aria-pressed': String(lay[l[0]] !== false), onclick: () => { lay[l[0]] = lay[l[0]] === false; store.set('go-gs3-layers', lay); renderLayerBtns(); applyLayers() } }, el('i', { style: `background:${l[2]}` }), l[1])));
}
function applyLayers() { for (const k in locGroups) { if (k === '_base' || lay[k] !== false) locGroups[k].addTo(locMap); else locGroups[k].remove() } }

/* ================= 인쇄 ================= */
function doPrint(cls) {
  $('#pCond').textContent = condText(period()) + ' · 출력 ' + new Date().toLocaleDateString('ko-KR');
  document.body.classList.add(cls);
  setTimeout(() => { Object.values(CH).forEach(c => c.resize()); window.print() }, 150);
}
window.addEventListener('afterprint', () => { document.body.classList.remove('print-brief', 'print-promo'); Object.values(CH).forEach(c => c.resize()) });

/* ================= 렌더 ================= */
function renderAll() {
  const p = period();
  $('#fD1').value = p.a; $('#fD2').value = p.b;
  if (T().last) { $('#fD1').max = $('#fD2').max = T().last }
  $('#cond').textContent = '조회 조건: ' + condText(p) + (T().missing.length ? ` · ${TYPES[S.type].label} ${T().missing.join('·')} 실거래는 데이터 없음(API 활용신청 필요)` : '');
  renderListings(); renderKPI(p); renderTrend(p); renderRegion(p); renderIndex(); renderArea(p); renderTop(p); renderSearch();
}

async function init() {
  if (DEMO) $('#demoBand').classList.remove('hidden');
  const [site, meta, rone, hug, subs, pois, gogo, listings, plans, office] = await Promise.all(['site.json', 'meta.json', 'rone.json', 'hug.json', 'subscription.json', 'pois.json', 'gogo.json', 'listings.json', 'plans.json', 'office.json'].map(j));
  Object.assign(G, { site: site || await (await fetch('data/site.json')).json(), meta, rone, hug, subs, pois, gogo, listings, plans, office });
  await loadType('apt'); if (S.type !== 'apt') await loadType(S.type);
  renderChrome(); fillDongs(); initFilters();
  renderUnsold(); renderHug(); renderSubs(); renderOffice();
  renderAll();
}
init().catch(e => { console.error(e); $('#asof').textContent = '데이터를 불러오지 못했습니다: ' + e.message });
})();
