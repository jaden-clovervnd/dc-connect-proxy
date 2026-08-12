# dc-connect-proxy

**dc-connect** 안경 앱이 디시인사이드를 읽을 수 있게 해주는 작은 중계 서버입니다.
Node 20+ 만 있으면 되고, 네이티브 의존성이 없어서 어디서든 1분이면 뜹니다.

```bash
git clone https://github.com/jaden-clovervnd/dc-connect-proxy.git
cd dc-connect-proxy
npm install
npm start          # → http://localhost:8787
```

확인:

```bash
curl http://localhost:8787/health
```

`{"ok":true}` 가 나오면 끝입니다. 앱의 **⚙ → 프록시 주소**에 이 서버 주소를 넣고 **테스트 → 저장**하세요.

---

## 왜 필요한가요

안경 앱은 Flutter WebView 안에서 도는 웹페이지라, 브라우저와 똑같은 제약을 받습니다.

| 디시인사이드 쪽 | 앱에서 생기는 문제 |
|---|---|
| CORS 헤더를 안 줌 | 글 목록·본문 `fetch()` 자체가 차단 |
| 이미지 핫링크 차단 | 이미지가 403 (WebView는 `Referer` 위조 불가) |
| 봇/세션 검사 | 댓글이 0으로 내려옴 |

이 서버가 중간에서 ① 자기 응답에 `Access-Control-Allow-Origin: *` 를 붙이고 ② 서버사이드에서 정상 UA/Referer/쿠키로 요청하고 ③ 이미지 원본 바이트를 CORS 허용으로 다시 내보냅니다.

**이미지 변환은 하지 않습니다.** 안경용 톤 변환·양자화는 앱이 WebView canvas에서 직접 합니다. 그래서 이 서버는 `sharp` 같은 네이티브 라이브러리가 필요 없고, 의존성이 `express` + `cheerio` 둘뿐입니다.

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /health` | `{"ok":true}` — 앱의 연결 테스트가 이걸 봅니다 |
| `GET /api/list?id=<갤러리>&page=1&mode=all\|recommend` | 글 목록 (`mode=recommend` = 개념글) |
| `GET /api/post?id=<갤러리>&no=<글번호>` | 제목·본문·이미지 목록·댓글 |
| `GET /img?url=<디시 이미지 URL>` | 원본 이미지 바이트 + CORS (핫링크 우회) |

환경변수: `PORT`(기본 8787), `GALLERY`(기본 `automata`).

라이브 검증:

```bash
npm run smoke      # 실제 갤러리에서 목록·본문·댓글·이미지까지 끝까지 확인
```

---

## 어디에 띄울까

### A. 내 컴퓨터 + Tailscale (권장 — 무료, 비공개)

[Tailscale](https://tailscale.com)로 폰과 컴퓨터를 묶으면, 인터넷에 아무것도 노출하지 않고 폰에서 내 컴퓨터의 프록시에 붙을 수 있습니다.

1. 컴퓨터와 폰 양쪽에 Tailscale 설치 후 같은 계정으로 로그인
2. 컴퓨터에서 `npm start`
3. 컴퓨터의 Tailscale 주소 확인: `tailscale status` → `머신이름.xxxx.ts.net`
4. 앱 **⚙ → 프록시 주소**에 `http://머신이름.xxxx.ts.net:8787` 입력 → 테스트 → 저장

> **컴퓨터가 켜져 있을 때만 동작합니다.** 노트북이 잠들면 앱도 멈춥니다. 항상 쓰려면 아래 B/C를 쓰세요.

**HTTPS로 쓰고 싶다면** (앱이 http를 막는 경우 필요):
Tailscale 관리 콘솔 → **DNS → HTTPS Certificates 활성화** 후

```bash
tailscale serve --bg 8787
```

그러면 `https://머신이름.xxxx.ts.net` (포트 없이)로 붙습니다. HTTPS Certificates를 켜지 않으면 TLS 연결이 그냥 멈추니, 안 될 때 이 설정부터 확인하세요.

### B. 항상 켜져 있는 작은 서버 (Raspberry Pi, 홈서버, VPS)

```bash
npm install
PORT=8787 npm start
```

`systemd`로 상시 실행 (Linux):

```ini
# /etc/systemd/system/dc-connect-proxy.service
[Unit]
Description=dc-connect proxy
After=network-online.target

[Service]
WorkingDirectory=/opt/dc-connect-proxy
ExecStart=/usr/bin/node server.js
Environment=PORT=8787
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now dc-connect-proxy
```

### C. 클라우드 (Fly.io / Render / Railway 등)

네이티브 의존성이 없어서 Node 빌드팩이 있는 곳이면 그대로 올라갑니다. 시작 명령 `node server.js`, 포트는 `PORT` 환경변수를 씁니다. **https 주소를 그냥 주기 때문에 가장 안정적입니다.**

> ⚠️ 공개 주소로 올리면 **주소를 아는 누구나 쓸 수 있는 열린 프록시**가 됩니다. 개인용이면 접근 제한이나 요청 제한을 걸어두세요. 또 모든 요청이 서버 IP 하나로 나가므로, 트래픽이 많으면 디시인사이드가 그 IP를 차단할 수 있습니다.

---

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 앱에서 "연결할 수 없음" | 서버가 떠 있는지 (`curl .../health`), 주소 오타, 폰이 같은 tailnet인지 |
| 목록은 되는데 이미지만 안 뜸 | `/img` 응답 확인 — 디시가 이미지 URL 형식을 바꿨을 수 있음 |
| 갑자기 전부 빈 목록 | 디시 HTML 구조 변경. 셀렉터는 전부 `src/dcinside.js` 한 파일에 있습니다 |
| 댓글이 항상 0 | 모바일 페이지의 JSON-LD 형식 변경 — 같은 파일에서 파싱 |

## 구조

```
server.js          Express + CORS, 4개 라우트
src/client.js      UA/Referer/쿠키 처리 + 쿠키 워밍
src/dcinside.js    m.dcinside.com 목록/본문/댓글 파서 (cheerio) ← HTML 바뀌면 여기만 고치면 됨
src/image.js       이미지 원본 바이트 가져오기 (Referer 우회)
smoke.js           라이브 e2e 검증
```

## 주의

디시인사이드 스크래핑은 서비스 약관상 회색지대입니다. 개인 용도로만 쓰고, 요청량을 과하게 늘리지 마세요. 이 저장소는 학습·개인 사용 목적으로 공개합니다.

## 라이선스

MIT
