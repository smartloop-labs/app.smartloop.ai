'use client';

/**
 * GPU Boxes: the credits the account's box can spend, its box, what it has
 * spent and the GPUs it can run.
 *
 * gpushed (https://gpushed.dev) gives each smartloop account a
 * personal NVIDIA GPU machine, created and managed from a Mac with the
 * `gpushed` CLI. It spends the account's credits (the plan's monthly ones,
 * then any added), the same wallet as cloud models and web search, so
 * credits are added on the Billing page, not here. Its API lives at
 * gpushed-api.smartloop.ai and accepts the same session token as the rest
 * of the app, so this page reads it directly:
 *
 *   GET  /me                  credits available and the current box
 *   GET  /usage?days=30       spend per day (UTC)
 *   GET  /plans               GPUs and their hourly price
 *
 * Boxes are created, stopped and deleted from the CLI, not here: the page
 * shows the box and the commands rather than duplicating them.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { userService } from '@/app/services/user.service';
import { GPUSHED_ENDPOINT } from '@/app/constants';
import { CodeBlock, Row, Section } from '@/app/components/rows';

const INSTALL = 'curl -fsSL gpushed.dev/install.sh | bash';
const DAYS = 30;

interface GpuBox {
  id: string;
  plan: string;
  status: string;
  zone: string | null;
  ip: string | null;
  ssh_user: string;
  hourly_usd: string;
  stopped_hourly_usd: string;
  error: string | null;
  created_at: number;
}

interface Me {
  email: string;
  balance_usd: string;
  balance_micros: number;
  low_balance: boolean;
  min_topup_usd: number;
  box: GpuBox | null;
}

interface Usage {
  daily: { date: string; usage_usd: string; topup_usd: string }[];
  total_usage_usd: string;
  total_topup_usd: string;
}

interface Plan {
  id: string;
  label: string;
  hourly_usd: string;
  stopped_hourly_usd: string;
}

interface Plans {
  default: string;
  region: string;
  plans: Plan[];
}

/** undefined while loading, null if the request failed. */
type Loaded<T> = T | null | undefined;

async function get<T>(path: string): Promise<T | null> {
  const r: Response | undefined = await userService.makeAuthenticatedRequest(`${GPUSHED_ENDPOINT}${path}`, {
    method: 'GET',
  });
  if (!r || !r.ok) return null;
  return r.json();
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  pending: { label: 'Creating', tone: 'warn' },
  starting: { label: 'Starting', tone: 'warn' },
  running: { label: 'Running', tone: 'ok' },
  stopping: { label: 'Stopping', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'muted' },
  destroying: { label: 'Deleting', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
};

const TONE_CLASS = {
  ok: 'text-ok',
  warn: 'text-warn border-warn-border bg-warn-soft',
  danger: 'text-danger border-danger-border bg-danger-soft',
  muted: 'text-muted',
};

const LINK_CLASS = 'text-accent-text hover:opacity-80 hover:underline font-medium transition-colors';

const dateTime = (sec: number) =>
  new Date(sec * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const shortDate = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function Pending() {
  return <CircularProgress size={12} sx={{ color: 'var(--muted)' }} />;
}

function Badge({ label, tone }: { label: string; tone: keyof typeof TONE_CLASS }) {
  return (
    <span
      className={`inline-block whitespace-nowrap text-[11px] font-medium px-2 py-0.5 rounded-md border border-border bg-surface-2 ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box className="flex-1 min-w-[7rem] rounded-lg border border-border px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="text-base font-semibold text-content tabular-nums mt-0.5">{value}</div>
    </Box>
  );
}

/** The last DAYS days, oldest first, with zero for days without usage. */
function lastDays(usage: Usage): { date: string; usd: number }[] {
  const byDay = new Map(usage.daily.map((d) => [d.date, Number(d.usage_usd)]));
  const out: { date: string; usd: number }[] = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, usd: byDay.get(key) ?? 0 });
  }
  return out;
}

/**
 * Daily spend: one series, so no legend (the row label names it). Bars because
 * each day is a discrete total and most days may be empty; 4px rounded tops on
 * a shared baseline, a 2px gap between bars, and a hover tooltip per day with a
 * hit target the full height of the plot.
 */
function SpendChart({ usage }: { usage: Usage }) {
  const days = lastDays(usage);
  const max = Math.max(...days.map((d) => d.usd));
  const [hover, setHover] = useState<number | null>(null);

  if (max <= 0) {
    return <p className="text-xs text-faint">No GPU usage in the last {DAYS} days.</p>;
  }

  const h = days[hover ?? -1];
  return (
    <Box className="flex flex-col gap-1.5">
      <Box className="relative h-28 mt-8 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <Box
            key={d.date}
            className="relative flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setHover(i)}
            aria-label={`${shortDate(d.date)}: $${d.usd.toFixed(2)}`}
          >
            <Box
              className="w-full rounded-t-[4px] transition-opacity"
              sx={{
                height: d.usd > 0 ? `max(2px, ${(d.usd / max) * 100}%)` : 0,
                bgcolor: 'var(--accent-strong)',
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </Box>
        ))}
        {h && (
          <Box
            className="absolute -top-2 px-2 py-1 rounded-md border border-border bg-surface text-xs shadow-sm whitespace-nowrap pointer-events-none"
            sx={{
              left: `${((hover! + 0.5) / DAYS) * 100}%`,
              transform: `translate(${hover! < DAYS / 2 ? '-10%' : '-90%'}, -100%)`,
            }}
          >
            <span className="text-faint">{shortDate(h.date)}</span>{' '}
            <span className="text-content font-medium tabular-nums">${h.usd.toFixed(2)}</span>
          </Box>
        )}
      </Box>
      <Box className="flex justify-between text-[11px] text-faint tabular-nums" sx={{ borderTop: '1px solid var(--border)', pt: 0.75 }}>
        <span>{shortDate(days[0].date)}</span>
        <span>Today</span>
      </Box>
    </Box>
  );
}

function BoxRow({ box, plans }: { box: GpuBox; plans: Loaded<Plans> }) {
  const status = STATUS[box.status] ?? { label: box.status, tone: 'muted' as const };
  const plan = plans?.plans.find((p) => p.id === box.plan);
  const price = box.status === 'stopped' ? `$${box.stopped_hourly_usd}/h while stopped (disk only)` : `$${box.hourly_usd}/h`;
  return (
    <Row label="Your box" stacked>
      <Box className="flex flex-col gap-3">
        <Box className="rounded-lg border border-border px-3 py-2.5 flex flex-col gap-1">
          <Box className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-content">{plan?.label ?? box.plan}</span>
            <Badge label={status.label} tone={status.tone} />
          </Box>
          <div className="text-xs text-muted tabular-nums">
            {price}
            {box.zone ? ` · ${box.zone}` : ''}
            {box.ip ? ` · ${box.ip}` : ''}
            {` · created ${dateTime(box.created_at)}`}
          </div>
          {box.error && <div className="text-xs text-danger">{box.error}</div>}
        </Box>
        <div className="text-xs text-faint leading-relaxed">
          <p className="m-0 mb-1">Manage it from your Mac:</p>
          <ul className="m-0 pl-4 [&>li]:list-disc space-y-0.5">
            <li>
              <span className="text-content">gpushed ssh</span> — open a shell on the box
            </li>
            <li>
              <span className="text-content">gpushed stop</span> — stop it; only the disk is billed while stopped
            </li>
            <li>
              <span className="text-content">gpushed start</span> — start a stopped box again
            </li>
            <li>
              <span className="text-content">gpushed down</span> — delete the box
            </li>
          </ul>
        </div>
      </Box>
    </Row>
  );
}

function NoBoxRow() {
  const [copied, setCopied] = useState(false);
  return (
    <Row
      label="Your box"
      description="You have no GPU box. Install gpushed on a Mac with Apple silicon (macOS 26 or later), sign in with this account, and run gpushed up."
      stacked
    >
      <CodeBlock
        code={`${INSTALL}\ngpushed up`}
        copied={copied}
        onCopy={() => {
          navigator.clipboard?.writeText(INSTALL).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      />
    </Row>
  );
}

export default function GpushedSection({ user }: { user: any }) {
  const [me, setMe] = useState<Loaded<Me>>(undefined);
  const [usage, setUsage] = useState<Loaded<Usage>>(undefined);
  const [plans, setPlans] = useState<Loaded<Plans>>(undefined);

  const loadMe = useCallback(() => get<Me>('/me').then(setMe).catch(() => setMe(null)), []);

  useEffect(() => {
    if (!user) return;
    loadMe();
    get<Usage>(`/usage?days=${DAYS}`).then(setUsage).catch(() => setUsage(null));
    get<Plans>('/plans').then(setPlans).catch(() => setPlans(null));
  }, [user, loadMe]);

  const failed = me === null || usage === null || plans === null;
  const empty = me && me.balance_micros <= 0;

  return (
    <Section
      title="GPU Boxes"
      description="Your own NVIDIA GPU machine for research, created and managed from your Mac with gpushed. It's billed by the second at the plan's hourly price, from the same credits as cloud models and web search."
    >
      <Row
        label="Credits available"
        description={
          me
            ? "Your plan's credits this month plus any you've added, shared with cloud models and web search. We email you when they run low; a running box is stopped before they run out."
            : 'Checking your credits…'
        }
        stacked
      >
        <Box className="flex flex-col gap-3">
          <Box className="flex items-center gap-2">
            {me ? (
              <span className={`text-lg font-semibold tabular-nums ${empty ? 'text-danger' : 'text-content'}`}>
                ${me.balance_usd}
              </span>
            ) : (
              <>
                <span className="text-lg font-semibold text-faint">$—</span>
                {me === undefined && <Pending />}
              </>
            )}
            {me?.low_balance && <Badge label="Low" tone="warn" />}
            {empty && <Badge label="No credit" tone="danger" />}
          </Box>
          <a
            href="/settings/billing"
            className="self-start inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-accent-border hover:bg-accent-soft text-accent-text whitespace-nowrap"
          >
            Add credits in Billing
          </a>
        </Box>
      </Row>

      {me === undefined && (
        <Row label="Your box" stacked>
          <Box className="flex items-center gap-2">
            <Pending />
            <span className="text-sm text-faint">Loading…</span>
          </Box>
        </Row>
      )}
      {me && (me.box ? <BoxRow box={me.box} plans={plans} /> : <NoBoxRow />)}

      {usage !== null && (
        <Row label="Spending" description={`Last ${DAYS} days, by day (UTC).`} stacked>
          <Box className="flex flex-col gap-4">
            <Box className="flex flex-wrap gap-2">
              <Stat label="Spent" value={usage ? `$${usage.total_usage_usd}` : '—'} />
              <Stat label="Available" value={me ? `$${me.balance_usd}` : '—'} />
            </Box>
            {usage ? (
              <SpendChart usage={usage} />
            ) : (
              <Box className="flex items-center gap-2">
                <Pending />
                <span className="text-sm text-faint">Loading…</span>
              </Box>
            )}
          </Box>
        </Row>
      )}

      {plans !== null && (
        <Row
          label="GPUs"
          description={
            <>
              Hourly prices while running; a stopped box costs only its disk. Details on{' '}
              <a href="https://gpushed.dev" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                gpushed.dev
              </a>
              .
            </>
          }
          stacked
        >
          {plans === undefined ? (
            <Box className="flex items-center gap-2">
              <Pending />
              <span className="text-sm text-faint">Loading…</span>
            </Box>
          ) : (
            <Box className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {plans.plans.map((p) => (
                <Box key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Box className="min-w-0 flex-1">
                    <div className="text-sm text-content">
                      {p.label}
                      {p.id === plans.default && (
                        <span className="ml-2 align-middle">
                          <Badge label="Default" tone="muted" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-faint mt-0.5">
                      <code className="font-mono">gpushed up {p.id}</code>
                    </div>
                  </Box>
                  <span className="text-sm text-content tabular-nums whitespace-nowrap">${p.hourly_usd}/h</span>
                </Box>
              ))}
            </Box>
          )}
        </Row>
      )}

      {failed && (
        <Row stacked>
          <Box className="p-3 rounded-lg border border-danger-border bg-danger-soft">
            <p className="text-sm text-danger">Could not load your GPU box details. Try again in a moment.</p>
          </Box>
        </Row>
      )}
    </Section>
  );
}
