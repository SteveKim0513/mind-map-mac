// 테스트 전용 자식 프로세스: 실제 프로세스에서 crash 핸들러가 로그를 남기고 종료 코드 1로 끝나는지 본다.
import { installCrashHandlers } from '../../src/crash.js';

installCrashHandlers();
if (process.argv[2] === 'reject') {
  void Promise.reject(new Error('child-reject'));
} else {
  setTimeout(() => {
    throw new Error('child-boom');
  }, 5);
}
// 핸들러가 종료시키지 못하면 테스트가 멈추지 않게 자체 타임아웃.
setTimeout(() => process.exit(99), 5000).unref();
