# Weather Ops — 업무용 날씨 통합 대시보드

현장직·드론 운용·비행시험·해상 작업처럼 **날씨가 곧 작업 가능 여부**인 사람들을 위한 웹앱.
기상청·METAR·애플·Google·Open-Meteo 등 **여러 출처를 한 번에 모아** 정규화하고,
업무 유형별 기준으로 **GO / 주의 / NO-GO** 를 한눈에 보여준다.

## 특징
- **업무별 프리셋**: 드론 비행 / 비행시험 / 해상(배) / 현장작업 / 일반 — 지표·임계값이 다름. 최초 실행 시 추천.
- **종합 판정 배지**: 활성 프리셋의 임계값으로 GO/주의/NO-GO + 사유 표시.
- **출처 나란히 비교**: 기상청·METAR·Google·Apple·Open-Meteo 카드를 동일 지표로 비교.
- **대시보드 커스터마이징**: 표시 지표 선택(프리셋별, localStorage 저장).
- **키 없이도 동작**: Open-Meteo(무키)가 기본 백본. 돌풍·가시거리·구름·일출일몰 제공.

## 실행
```bash
npm install
cp .env.example .env   # 키를 넣으면 해당 출처가 켜짐 (안 넣어도 Open-Meteo로 동작)
npm start              # http://localhost:8787  (PORT 환경변수로 변경 가능)
```

## 출처별 자격증명
| 출처 | 필요한 것 | 비고 |
|------|-----------|------|
| **Open-Meteo** | 없음 | 항상 동작. 기본 백본 |
| **기상청** | `KMA_SERVICE_KEY` (무료) | [data.go.kr 단기예보](https://www.data.go.kr/data/15084084/openapi.do) 활용신청. 브라우저 직접호출 CORS 차단 → 서버 프록시로 해결. 가시거리/운고/돌풍 미제공 |
| **METAR(공항)** | `KMA_METAR_KEY` (무료) | [KMA API허브](https://apihub.kma.go.kr) authKey (**AmmIwxxmService 활용신청** 필요). **가장 가까운 공항 ICAO 실측**으로 단기예보가 못 주는 **가시거리·운고·돌풍**을 보완(비행/드론용). IWXXM 구조화 XML을 직접 파싱하며, 원문 METAR 텍스트도 지원 |
| **Google** | `GOOGLE_WEATHER_KEY` | Google Maps Platform Weather API (월 1만콜 무료) |
| **Apple** | `APPLE_TEAM_ID/KEY_ID/SERVICE_ID/PRIVATE_KEY` | Apple Developer 계정 필요. 서버에서 ES256 JWT 서명 |

키/접근이 없는 출처는 카드에 **"키 필요"/"사용 불가"** 로 표시되고 앱은 정상 동작한다.

## 📱 앱처럼 설치 (PWA)
배포된 주소를 열면 **홈 화면에 설치**해 네이티브 앱처럼 쓸 수 있다 (스토어 심사 불필요).
- **iPhone(Safari)**: 공유 버튼 → "홈 화면에 추가"
- **Android(Chrome)**: 메뉴 → "앱 설치" (또는 주소창의 설치 아이콘)
- **데스크톱 Chrome/Edge**: 주소창 오른쪽 설치 아이콘
- 오프라인이면 **마지막으로 받은 날씨**를 보여준다(서비스워커 캐시). 인증·팀 API는 캐시하지 않음.
- 구성: `public/manifest.webmanifest`(설치 메타), `public/sw.js`(오프라인 캐시), `public/icons/`(아이콘). 새 배포 반영이 안 보이면 `sw.js`의 `CACHE_VERSION`을 올릴 것.

## 팀 위치 공유 (동의·로그인 기반)
드론팀·현장팀이 **각자 동의하고 로그인**해서 자기 위치를 공유하는 "팀 현황" 기능. (`/team.html`)

**프라이버시 원칙**
- **동의 우선**: "내 위치 공유" 토글을 켜고 브라우저 위치 권한을 허용하기 전까지 위치는 기기를 떠나지 않음.
- **인증 필수**: 로그인한 **같은 팀 멤버만** 서로의 위치를 조회. 비로그인·타 팀은 차단(401/403).
- **즉시 옵트아웃**: 토글 OFF 시 서버의 내 위치 즉시 삭제. 계정·데이터 삭제 버튼 제공.
- **데이터 최소화**: 멤버당 **최신 위치 1건만** 저장 — 이동 경로(동선)는 기록하지 않음. IP 기반 위치추적 없음.

> ⚠️ 본 기능은 **본인 동의 기반 팀 공유 전용**입니다. 타인의 위치·IP를 동의 없이 수집/추적하는
> 용도로 쓰는 것은 위치정보보호법 등 위반 소지가 있어 지원하지 않습니다.

흐름: 가입/로그인 → 팀 생성(초대 코드 발급) 또는 코드로 참여 → 공유 토글 ON(동의) →
같은 팀이 서로의 위치·갱신시각·해당 지점 GO/주의/NO-GO 판정을 확인.

저장소는 데모용 JSON 파일(`data.json`). **운영 배포 시 실제 DB·세션 스토어·HTTPS로 교체 권장.**

## 호스팅 / 배포
이 앱은 Node 백엔드가 필요해 GitHub Pages(정적)로는 못 돌립니다. egress가 열린 호스트가 필요합니다.

**가장 쉬운 길 — Render (무료, 외부망 열림):**
1. Render 대시보드 → New → **Blueprint** → 이 저장소 연결 (`weather-ops/render.yaml` 자동 인식)
2. 배포 후 대시보드 Environment에서 `KMA_SERVICE_KEY` 등 원하는 출처 키 입력 (안 넣으면 해당 출처만 비활성)
3. `SESSION_SECRET`은 자동 생성됨. 완료되면 `https://<your-app>.onrender.com` 으로 접속

**Docker로 어디서나:**
```bash
cd weather-ops
docker build -t weather-ops .
docker run -p 8787:8787 --env-file .env weather-ops
```

> 참고: 키를 넣어도 Open-Meteo만으로 기본 동작합니다. Apple/Google/기상청은 정식 API 키가 필요합니다.

## 구조
```
server/
  index.js        Express: 정적 서빙 + /api/weather, /api/sources + auth/team 라우트, 세션
  config.js       env 로드 + 출처 가용성
  aggregate.js    활성 어댑터 병렬 호출 → 정규화 병합 + 일출/일몰 보완
  store.js        팀/계정/위치 JSON 영속 저장소 (데모용)
  auth.js         가입/로그인/세션/계정삭제 + requireAuth
  team.js         팀 생성·참여·동의 기반 위치 공유·팀 현황
  metrics.js      사용량 로그/집계 (쿼리·가입 건수, 비식별)
  sources/        openmeteo, kma, kma_metar(공항METAR), google, apple 어댑터
  util/           grid(격자변환), sun(일출일몰), normalize(공통모델), metar(원문파서·공항선택)
public/
  index.html, app.js        대시보드
  team.html, team.js        팀 현황(로그인·위치 공유)
  presets.js                프리셋 + 공유 판정 로직(evalVerdict/valueFor)
  styles.css
Dockerfile, render.yaml     배포용
```

## API
- `GET /api/sources` → 출처별 자격증명 보유 여부
- `GET /api/weather?lat=&lon=&region=&sources=` → 정규화된 통합 날씨 JSON
- `POST /api/auth/{register,login,logout}` · `GET /api/auth/me` · `DELETE /api/auth/me`
- `GET/POST /api/team` · `POST /api/team/join` · `POST/DELETE /api/team/location` · `GET /api/team/status` (모두 로그인·같은 팀 스코프)
- `GET /api/stats` → 사용량 통계(쿼리·가입·로그인 건수, 최근 7일). `STATS_TOKEN` 설정 시 `?token=` 필요

## 사용량 통계 (몇 건의 쿼리·가입이 들어오는지)
서버가 요청을 받을 때마다 **비식별 이벤트**를 `metrics.log`(JSONL)에 남기고 집계한다.
- 기록 이벤트: `weather_query`(날씨 조회), `register`(가입), `login`(로그인)
- **프라이버시**: IP·정밀좌표·개인정보는 저장하지 않음. 조회는 지역명 + 약 1km로 라운딩한 좌표만.
- 보기: `GET /api/stats` (JSON). 운영에서 공개를 막으려면 `STATS_TOKEN` 설정 후 `?token=<값>`.
- 원본 로그: `metrics.log` 줄단위 JSON — `wc -l metrics.log` 로 총 건수, `grep '"register"' metrics.log | wc -l` 로 가입 수 등 즉석 집계 가능.

```bash
curl -s localhost:8787/api/stats | jq      # 예: { weatherQueries, registrations, logins, last7days }
```

## 주의
- 기상청 단기예보는 가시거리/운고/돌풍을 제공하지 않아 해당 값은 다른 출처(METAR·Open-Meteo/Google/Apple)로 보완 표시됩니다. METAR는 공항 실측이라 위치가 공항과 멀면 참고용으로 보세요(카드에 공항·거리 표시).
