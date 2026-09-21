/**
 * 공유 폴더 릴레이 서버의 기본 주소(ADR 0021).
 *
 * Railway `mind-map-relay` 프로젝트의 `mindmap-relay` 서비스(Singapore) 공개 주소 — 2026-09-21 사용자가 이 주소를
 * 앱 기본값으로 승인했다. 이 값을 바꾸려면 앱을 새로 배포해야 한다(렌더러 CSP connect-src가 이 origin만 허용하고,
 * 이미 배포된 옛 버전 앱은 옛 주소로 계속 접속한다). 빈 문자열이면 공유 기능은 "릴레이 미설정"(relay_not_configured).
 * 환경변수 MINDMAP_RELAY_URL이 있으면 이 값보다 우선한다 (개발·E2E 격리용, 패키지 빌드에서는 무시).
 */
export const DEFAULT_RELAY_URL = 'https://mindmap-relay-production.up.railway.app';
