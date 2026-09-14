/**
 * Standalone smoke test for push routes only. For production, merge `dispatchPushRoutes`
 * from `./push-all-devices` into your main Worker (e.g. rootrecord-primary) before the 404 handler.
 */
import type { PushWorkerEnv } from './bindings';
import { dispatchPushRoutes } from './push-all-devices';

export default {
  async fetch(request: Request, env: PushWorkerEnv): Promise<Response> {
    const r = await dispatchPushRoutes(request, env);
    if (r) return r;
    return new Response(
      JSON.stringify({
        name: 'rr-weather-manager-api (push-only dev entry)',
        hint: 'Merge dispatchPushRoutes from src/push-all-devices.ts into your primary Worker.',
      }),
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  },
};
