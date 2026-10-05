import type { DdnsHistoryEntry, HostCommand, HostProfile, HostReport, HostReportResponse, HostSnapshot } from '../observer/host-types';
import { HOST_COMMAND_TTL_MS, parseHostProfiles, snapshotFreshness, validateHostReport } from '../observer/host-validation';
import type { Env } from '../worker/env';

interface PersistedHostState {
  report?: HostReport;
  receivedAt?: string;
  ddnsHistory: DdnsHistoryEntry[];
  command?: HostCommand;
  recentReportIds: string[];
}

const STORAGE_KEY = 'host-state:v1';
const HISTORY_LIMIT = 32;
const REPORT_ID_LIMIT = 64;

/** Per-host ordered heartbeat and a single fixed DDNS refresh request. */
export class HostState implements DurableObject {
  private data: PersistedHostState = { ddnsHistory: [], recentReportIds: [] };
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.ready = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<PersistedHostState>(STORAGE_KEY);
      if (stored) this.data = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    // DO input gates release while awaiting storage; queue the entire decision + write.
    const operation = this.queue.then(() => this.handle(request));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const profiles = parseHostProfiles(this.env.HOST_PROFILES);
    if (!profiles) return error('host profiles are not configured correctly', 503);
    const profile = profiles.find((entry) => entry.hostId === url.searchParams.get('hostId'));
    if (!profile) return error('host not found', 404);
    if (this.data.report && this.data.report.hostId !== profile.hostId) return error('host identity conflict', 409);
    const now = Date.now();
    if (this.expireCommand(now)) await this.persist();

    if (url.pathname === '/' && request.method === 'GET') return Response.json(this.snapshot(profile, now));
    if (url.pathname === '/report' && request.method === 'POST') return this.report(request, profile, now);
    if (url.pathname === '/ddns-refresh' && request.method === 'POST') {
      if (!this.data.command || this.data.command.status !== 'pending') {
        this.data.command = {
          id: crypto.randomUUID(), kind: 'ddns-refresh', status: 'pending',
          requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + HOST_COMMAND_TTL_MS).toISOString(),
        };
        await this.persist();
      }
      return Response.json({ command: this.data.command });
    }
    return error('method not allowed', 405);
  }

  private async report(request: Request, profile: HostProfile, now: number): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { return error('invalid host report', 400); }
    const report = validateHostReport(body, profile.hostId, now);
    if (!report) return error('invalid host report', 400);
    const prior = this.data.report;
    if (this.data.recentReportIds.includes(report.reportId) || prior && prior.bootId === report.bootId && prior.sequence === report.sequence) {
      return Response.json(this.reportResponse(false, true));
    }
    if (prior && (prior.bootId === report.bootId && report.sequence < prior.sequence
      || Date.parse(report.capturedAt) < Date.parse(prior.capturedAt)
      || prior.bootId !== report.bootId && Date.parse(report.capturedAt) <= Date.parse(prior.capturedAt))) {
      return error('out of order host report', 409);
    }

    const ack = report.commandAck;
    const command = this.data.command;
    if (ack && command && ack.id === command.id && command.status === 'pending') {
      const completed = Date.parse(ack.completedAt);
      // Host timestamps may have whole-second precision. Permit only a small clock skew.
      if (completed < Date.parse(command.requestedAt) - 5000 || completed > Date.parse(command.expiresAt)
        || completed > now + 5000 || completed > Date.parse(report.capturedAt) + 5000) return error('invalid command acknowledgement time', 400);
      this.data.command = { ...command, status: ack.status, completedAt: ack.completedAt, ...(ack.errorCode ? { errorCode: ack.errorCode } : {}) };
    }
    // A previously acknowledged command may remain in the collector's retry journal.
    // It never overwrites a newer command, and does not block delivery of that command.
    this.data.report = report;
    this.data.receivedAt = new Date(now).toISOString();
    this.data.recentReportIds = [...this.data.recentReportIds, report.reportId].slice(-REPORT_ID_LIMIT);
    this.data.ddnsHistory = [...this.data.ddnsHistory, { receivedAt: this.data.receivedAt, observation: report.ddns }].slice(-HISTORY_LIMIT);
    await this.persist();
    return Response.json(this.reportResponse(true));
  }

  private expireCommand(now: number): boolean {
    const command = this.data.command;
    if (!command || command.status !== 'pending' || Date.parse(command.expiresAt) > now) return false;
    this.data.command = { ...command, status: 'failed', completedAt: new Date(now).toISOString(), errorCode: 'command_expired' };
    return true;
  }

  private snapshot(profile: HostProfile, now: number): HostSnapshot {
    return { profile, ...this.dataSnapshot(), freshness: snapshotFreshness(this.data.receivedAt, now) };
  }

  private dataSnapshot(): Pick<HostSnapshot, 'report' | 'receivedAt' | 'ddnsHistory' | 'command'> {
    return {
      ...(this.data.report ? { report: this.data.report } : {}),
      ...(this.data.receivedAt ? { receivedAt: this.data.receivedAt } : {}),
      ddnsHistory: this.data.ddnsHistory,
      ...(this.data.command ? { command: this.data.command } : {}),
    };
  }

  private reportResponse(accepted: boolean, duplicate = false): HostReportResponse {
    const command = this.data.command;
    return {
      accepted, ...(duplicate ? { duplicate: true } : {}),
      ...(command?.status === 'pending' ? { command: { id: command.id, kind: command.kind, expiresAt: command.expiresAt } } : {}),
    };
  }

  private persist(): Promise<void> { return this.state.storage.put(STORAGE_KEY, this.data); }
}

function error(message: string, status: number): Response { return Response.json({ error: message }, { status }); }
