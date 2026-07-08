// Notion 외부 저장(선택 기능): 사용 로그를 Notion 데이터베이스에 기록한다.
//   Render 무료 인스턴스는 재시작 때 로컬 파일이 초기화되므로, 오래 남길 로그는 외부에 둔다.
//
// 활성화 방법 (셋 다 필요):
//   1) Notion에서 내부 통합(Internal integration) 생성 → 토큰(secret_...) 발급
//        https://www.notion.so/my-integrations
//   2) 대상 데이터베이스 페이지 → 우상단 ⋯ → 연결(Connections) → 해당 통합 추가(share)
//   3) 환경변수 설정: NOTION_TOKEN=secret_...,  NOTION_LOG_DB=<데이터베이스 ID>
//
// Notion API 레이트리밋(~3 req/s)을 고려해 큐에 담아 천천히 전송(베스트에포트).
// 실패해도 서비스 본체엔 영향 없음.
const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_LOG_DB;
const ENABLED = !!(TOKEN && DB);
const API = 'https://api.notion.com/v1/pages';

const queue = [];
const MAX_QUEUE = 500; // 폭주 시 메모리 보호

export function notionEnabled() { return ENABLED; }

// 이벤트 1건을 큐에 넣는다(비차단). 요청 처리 흐름을 막지 않는다.
export function logToNotion(entry) {
  if (!ENABLED) return;
  if (queue.length >= MAX_QUEUE) return;
  queue.push(entry);
}

function toProps(e) {
  const p = {
    '지역': { title: [{ text: { content: String(e.place || e.region || '(미상)').slice(0, 100) } }] },
    '이벤트': { select: { name: e.type } },
    '시각': { date: { start: e.ts } },
  };
  if (e.via) p['경로'] = { select: { name: e.via } };
  if (e.lat != null) p['위도'] = { number: e.lat };
  if (e.lon != null) p['경도'] = { number: e.lon };
  return p;
}

async function flush() {
  if (!queue.length) return;
  const e = queue.shift();
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: DB }, properties: toProps(e) }),
    });
    // 레이트리밋(429)만 몇 차례 재시도, 그 외 실패는 조용히 버림
    if (res.status === 429 && (e._retry = (e._retry || 0) + 1) < 3) queue.unshift(e);
  } catch { /* 네트워크 실패 무시(베스트에포트) */ }
}

if (ENABLED) {
  setInterval(flush, 400); // ~2.5 req/s (레이트리밋 여유)
  // eslint-disable-next-line no-console
  console.log('[notion] 사용 로그 외부 기록 활성화');
}
