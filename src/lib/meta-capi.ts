/**
 * Meta Conversions API client.
 *
 * Endpoint:
 *   https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pixelId}/events
 *
 * Version is read from env var META_GRAPH_API_VERSION (default v25.0).
 */

const DEFAULT_API_VERSION = 'v25.0';

function getApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION || DEFAULT_API_VERSION;
}

export interface CapiUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  zp?: string[];
  country?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
  external_id?: string[];
}

export interface CapiEvent {
  event_name: string;
  event_time: number; // unix seconds
  event_id: string;
  event_source_url?: string;
  action_source: 'website';
  user_data: CapiUserData;
  custom_data?: Record<string, unknown>;
}

export interface CapiRequest {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  events: CapiEvent[];
}

export interface CapiResponse {
  ok: boolean;
  status: number;
  body: unknown;
  eventsReceived: number | null;
  fbtraceId: string | null;
  errorMessage: string | null;
}

export async function sendToMetaCapi(req: CapiRequest): Promise<CapiResponse> {
  const url = `https://graph.facebook.com/${getApiVersion()}/${req.pixelId}/events?access_token=${encodeURIComponent(req.accessToken)}`;
  const payload: Record<string, unknown> = { data: req.events };
  if (req.testEventCode) payload.test_event_code = req.testEventCode;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body: any = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      body,
      eventsReceived: typeof body?.events_received === 'number' ? body.events_received : null,
      fbtraceId: typeof body?.fbtrace_id === 'string' ? body.fbtrace_id : null,
      errorMessage: !res.ok ? (body?.error?.message ?? `HTTP ${res.status}`) : null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      eventsReceived: null,
      fbtraceId: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sanitises a CapiEvent.user_data object by removing keys whose value is
 * undefined or empty array. Meta accepts missing fields but does not like
 * empty arrays for hashed fields.
 */
export function cleanUserData(ud: CapiUserData): CapiUserData {
  const out: CapiUserData = {};
  for (const [k, v] of Object.entries(ud) as [keyof CapiUserData, unknown][]) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    (out as any)[k] = v;
  }
  return out;
}
