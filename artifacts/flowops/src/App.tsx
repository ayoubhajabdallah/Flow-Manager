import { type ButtonHTMLAttributes, type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Command,
  Filter,
  Inbox,
  Laptop,
  LoaderCircle,
  Menu,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  X,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey,
  getGetRequestQueryKey,
  getHealthCheckQueryKey,
  getListRequestsQueryKey,
  RequestCategory,
  RequestPriority,
  RequestStatus,
  useCreateRequest,
  useGetDashboardSummary,
  useGetRequest,
  useHealthCheck,
  useListRequests,
  useUpdateRequestStatus,
} from '@workspace/api-client-react';
import type { Request } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();

const categoryLabels: Record<string, string> = {
  ACCESS: 'Access',
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
  NETWORK: 'Network',
  SECURITY: 'Security',
  OTHER: 'Other',
};
const statusLabels: Record<string, string> = {
  NEW: 'New',
  CLASSIFIED: 'Classified',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
const priorityLabels: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };
const statusOrder = [RequestStatus.NEW, RequestStatus.CLASSIFIED, RequestStatus.IN_PROGRESS, RequestStatus.RESOLVED, RequestStatus.CLOSED];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
function formatRelative(value?: string) {
  if (!value) return '—';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function Button({ children, className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'outline' | 'danger' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-primary-foreground shadow-[0_5px_0_hsl(193_29%_13%)] hover:-translate-y-0.5 hover:shadow-[0_7px_0_hsl(193_29%_13%)] active:translate-y-0 active:shadow-[0_3px_0_hsl(193_29%_13%)]',
        variant === 'quiet' && 'text-muted-foreground hover:bg-muted hover:text-foreground',
        variant === 'outline' && 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted',
        variant === 'danger' && 'bg-destructive text-destructive-foreground hover:brightness-105',
        className,
      )}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    NEW: 'bg-[#e8f0ee] text-[#27645d]',
    CLASSIFIED: 'bg-[#fff0cc] text-[#8a6214]',
    IN_PROGRESS: 'bg-[#e4edf5] text-[#3d6483]',
    RESOLVED: 'bg-[#dcefe2] text-[#38734d]',
    CLOSED: 'bg-muted text-muted-foreground',
  };
  return <span data-testid={`status-${status.toLowerCase()}`} className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em]', styles[status] || 'bg-muted text-muted-foreground')}>{statusLabels[status] || status}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = { LOW: 'text-muted-foreground', MEDIUM: 'text-[#8a6214]', HIGH: 'text-[#b55733]', CRITICAL: 'text-destructive' };
  return <span data-testid={`priority-${priority.toLowerCase()}`} className={cx('inline-flex items-center gap-1.5 text-xs font-semibold', styles[priority] || 'text-muted-foreground')}><span className={cx('h-1.5 w-1.5 rounded-full', priority === 'CRITICAL' ? 'bg-destructive' : priority === 'HIGH' ? 'bg-[#c76b41]' : priority === 'MEDIUM' ? 'bg-[#d8a931]' : 'bg-[#8ca4a0]')} />{priorityLabels[priority] || priority}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} aria-hidden="true" />;
}

function QueryError({ onRetry, message = 'We could not connect to the request service.' }: { onRetry: () => void; message?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-[#fff6f0] px-6 text-center">
      <CircleAlert className="mb-3 text-destructive" size={25} />
      <p className="font-semibold text-foreground">The signal dropped</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry} data-testid="button-retry"><RefreshCw size={15} /> Try again</Button>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-muted text-primary"><Inbox size={22} strokeWidth={1.6} /></div>
      <p className="font-display text-xl text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [{ href: '/', label: 'Overview', icon: BarChart3 }, { href: '/requests', label: 'Request queue', icon: Inbox }];
  return (
    <div className="grain flex min-h-[100dvh] bg-background">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[254px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 md:relative md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-3 px-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-primary"><Command size={19} strokeWidth={2.5} /></div>
          <div><p className="font-display text-[22px] leading-none tracking-tight">FlowOps</p><p className="mt-1 font-mono-ui text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/55">Operations control</p></div>
        </div>
        <div className="mt-12 px-3 font-mono-ui text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/45">Workspace</div>
        <nav className="mt-3 space-y-1">
          {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-${label.toLowerCase().replace(' ', '-')}`} className={cx('group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors', location === href ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground')}><Icon size={17} className={location === href ? 'text-accent' : ''} />{label}{href === '/requests' && <span className="ml-auto rounded-md bg-sidebar-foreground/10 px-1.5 py-0.5 font-mono-ui text-[10px]">LIVE</span>}</Link>)}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/45 p-4">
          <div className="flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-widest text-sidebar-foreground/50">System health</span><HealthDot /></div>
          <p className="mt-3 text-sm text-sidebar-foreground/80">All services operational</p>
          <p className="mt-1 font-mono-ui text-[10px] text-sidebar-foreground/45">Updated just now</p>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-sidebar-border px-3 pt-4">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[#d5e3d6] text-xs font-bold text-primary">OP</div>
          <div><p className="text-xs font-semibold">Operations team</p><p className="font-mono-ui text-[10px] text-sidebar-foreground/45">Internal workspace</p></div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close menu" data-testid="button-close-menu" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-primary/30 md:hidden" />}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur md:px-10">
          <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={20} /></button><div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#4e9c76]" />Morning shift <span className="text-border">/</span> Thursday, 24 October</div></div>
          <div className="flex items-center gap-2"><button className="relative rounded-lg p-2.5 text-muted-foreground hover:bg-muted" aria-label="Notifications" data-testid="button-notifications"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" /></button><Link href="/new" data-testid="link-header-new" className="hidden items-center gap-2 rounded-xl bg-accent px-3.5 py-2.5 text-xs font-bold text-accent-foreground shadow-[0_3px_0_#c28d2c] transition-transform hover:-translate-y-0.5 sm:inline-flex"><Plus size={15} /> New request</Link></div>
        </header>
        <div className="app-scroll mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, body, action }: { eyebrow: string; title: string; body: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[.2em] text-muted-foreground">{eyebrow}</p><h1 className="mt-2 font-display text-4xl leading-tight tracking-[-.03em] text-foreground md:text-5xl">{title}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p></div>{action}</div>;
}

function HealthDot() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 30000 } });
  return <span data-testid="status-health" className={cx('h-2 w-2 rounded-full', health.isLoading ? 'bg-muted-foreground/50' : health.isError ? 'bg-destructive' : 'bg-[#6fb780]')} />;
}

function Dashboard() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const requests = useListRequests({}, { query: { queryKey: getListRequestsQueryKey({}), staleTime: 30000 } });
  const latest = useMemo(() => (requests.data || []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5), [requests.data]);
  return (
    <div className="animate-rise-in">
      <PageHeading eyebrow="Thursday · 09:42 local" title="Good morning, operators." body="A clear view of what needs attention, what is moving, and where the team is spending time." action={<Link href="/new" data-testid="link-dashboard-new" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_5px_0_hsl(193_29%_13%)] transition-all hover:-translate-y-0.5 hover:shadow-[0_7px_0_hsl(193_29%_13%)]"><Plus size={16} /> Submit request</Link>} />
      {summary.isError ? <QueryError onRetry={() => summary.refetch()} /> : <><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.isLoading ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[144px]" />) : <><MetricCard label="Total requests" value={summary.data?.total ?? 0} note="Across all time" icon={<Inbox size={17} />} /><MetricCard label="Open now" value={summary.data?.open ?? 0} note="Needs a next step" icon={<Activity size={17} />} tone="amber" /><MetricCard label="Urgent attention" value={summary.data?.urgent ?? 0} note="High or critical priority" icon={<CircleAlert size={17} />} tone="red" /><MetricCard label="Resolved this week" value={summary.data?.resolvedThisWeek ?? 0} note={`First response · ${summary.data?.averageFirstResponseHours ?? 0}h avg`} icon={<CircleCheck size={17} />} tone="green" /></>}
      </section><section className="mt-8 grid gap-5 xl:grid-cols-[1.4fr_.9fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-2xl">Recent requests</h2><p className="mt-0.5 text-xs text-muted-foreground">The latest signals from around the business</p></div><Link href="/requests" data-testid="link-view-all-requests" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-[#b27a15]">View queue <ArrowUpRight size={14} /></Link></div>{requests.isError ? <div className="p-5"><QueryError onRetry={() => requests.refetch()} /></div> : requests.isLoading ? <div className="space-y-4 p-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div> : latest.length === 0 ? <div className="p-5"><EmptyState title="A quiet queue" body="No requests have arrived yet. Start the flow with a new request." action={<Link href="/new" className="text-sm font-bold text-primary">Submit the first request</Link>} /></div> : <div className="divide-y divide-border">{latest.map((request) => <RequestRow key={request.id} request={request} />)}</div>}</div>
        <CategoryActivity categories={summary.data?.categories} loading={summary.isLoading} />
      </section><section className="mt-5 grid gap-5 md:grid-cols-2"><ResponseCard average={summary.data?.averageFirstResponseHours} loading={summary.isLoading} /><ProcessCard /></section></>}
    </div>
  );
}

function MetricCard({ label, value, note, icon, tone = 'default' }: { label: string; value: number; note: string; icon: ReactNode; tone?: string }) {
  return <div className="group rounded-2xl border border-border bg-card p-5 transition-transform duration-300 hover:-translate-y-1"><div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{label}</span><span className={cx('grid h-8 w-8 place-items-center rounded-lg bg-muted text-primary', tone === 'amber' && 'bg-[#fff0cc] text-[#8a6214]', tone === 'red' && 'bg-[#fbe4db] text-destructive', tone === 'green' && 'bg-[#dcefe2] text-[#38734d]')}>{icon}</span></div><div className="mt-5 flex items-end gap-2"><span data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="font-mono-ui text-3xl font-medium tracking-[-.08em]">{value}</span><span className="mb-1 text-[11px] text-muted-foreground">{note}</span></div></div>;
}

function RequestRow({ request }: { request: Request }) {
  return <Link href={`/requests/${request.id}`} data-testid={`link-request-${request.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/55"><div className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-primary sm:grid">{request.category === 'NETWORK' ? <Network size={16} /> : request.category === 'HARDWARE' ? <Laptop size={16} /> : request.category === 'SECURITY' ? <ShieldCheck size={16} /> : <Tag size={16} />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold group-hover:text-primary">{request.title}</p><PriorityBadge priority={request.priority} /></div><p className="mt-1 truncate text-xs text-muted-foreground">{request.requester} <span className="mx-1 text-border">·</span> {categoryLabels[request.category]}</p></div><div className="hidden shrink-0 text-right sm:block"><StatusBadge status={request.status} /><p className="mt-1 text-[10px] text-muted-foreground">{formatRelative(request.createdAt)}</p></div><ArrowUpRight size={16} className="shrink-0 text-border transition-transform group-hover:translate-x-0.5 group-hover:text-primary" /></Link>;
}

function CategoryActivity({ categories, loading }: { categories?: Array<{ category: string; count: number }>; loading: boolean }) {
  const max = Math.max(...(categories || []).map((item) => item.count), 1);
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between"><div><h2 className="font-display text-2xl">Where work lands</h2><p className="mt-0.5 text-xs text-muted-foreground">Request volume by category</p></div><BarChart3 size={18} className="text-muted-foreground" /></div>{loading ? <div className="mt-7 space-y-5">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6" />)}</div> : <div className="mt-7 space-y-5">{(categories || []).map((item) => <div key={item.category}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold">{categoryLabels[item.category]}</span><span className="font-mono-ui text-muted-foreground">{item.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.max(8, item.count / max * 100)}%` }} /></div></div>)}</div>}</div>;
}

function ResponseCard({ average, loading }: { average?: number; loading: boolean }) {
  return <div className="relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground"><div className="absolute -right-8 -top-10 h-36 w-36 rounded-full border-[18px] border-accent/20" /><div className="relative"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary-foreground/55">Response rhythm</p><div className="mt-4 flex items-baseline gap-2">{loading ? <Skeleton className="h-10 w-24 bg-primary-foreground/10" /> : <><span className="font-mono-ui text-4xl tracking-[-.08em]">{average ?? 0}h</span><span className="text-xs text-primary-foreground/65">average first response</span></>}</div><div className="mt-6 flex items-center gap-2 text-xs text-primary-foreground/65"><Clock3 size={14} className="text-accent" /> Measured across resolved requests</div></div></div>;
}

function ProcessCard() {
  return <div className="rounded-2xl border border-border bg-card p-6"><div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">How FlowOps works</p><h2 className="mt-2 font-display text-2xl">From messy to moving.</h2></div><SlidersHorizontal size={18} className="text-muted-foreground" /></div><div className="mt-5 flex items-center gap-2 text-xs font-semibold"><span className="grid h-7 w-7 place-items-center rounded-lg bg-muted font-mono-ui">01</span><span className="h-px flex-1 bg-border" /><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fff0cc] font-mono-ui text-[#8a6214]">02</span><span className="h-px flex-1 bg-border" /><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#dcefe2] font-mono-ui text-[#38734d]">03</span></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>Capture</span><span>Classify</span><span>Resolve</span></div></div>;
}

function RequestsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const params = useMemo(() => ({ ...(search ? { search } : {}), ...(status ? { status: status as typeof RequestStatus.NEW } : {}), ...(category ? { category: category as typeof RequestCategory.ACCESS } : {}), ...(priority ? { priority: priority as typeof RequestPriority.LOW } : {}) }), [search, status, category, priority]);
  const requests = useListRequests(params, { query: { queryKey: getListRequestsQueryKey(params), placeholderData: (previous) => previous } });
  const hasFilters = Boolean(search || status || category || priority);
  return <div className="animate-rise-in"><PageHeading eyebrow="Operations / Queue" title="Request queue" body="Every incoming signal, with enough context to decide what happens next." action={<Link href="/new" data-testid="link-queue-new" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_5px_0_hsl(193_29%_13%)] transition-all hover:-translate-y-0.5"><Plus size={16} /> New request</Link>} /><div className="mb-5 rounded-2xl border border-border bg-card p-3"><div className="flex flex-col gap-3 lg:flex-row"><label className="relative flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-requests" placeholder="Search requests, people, or systems" className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-accent/30" /></label><FilterSelect label="Status" value={status} onChange={setStatus} options={statusLabels} testId="select-filter-status" /><FilterSelect label="Category" value={category} onChange={setCategory} options={categoryLabels} testId="select-filter-category" /><FilterSelect label="Priority" value={priority} onChange={setPriority} options={priorityLabels} testId="select-filter-priority" />{hasFilters && <Button variant="quiet" className="h-11" onClick={() => { setSearch(''); setStatus(''); setCategory(''); setPriority(''); }} data-testid="button-clear-filters"><X size={15} /> Clear</Button>}</div></div>{requests.isError ? <QueryError onRetry={() => requests.refetch()} /> : requests.isLoading ? <div className="rounded-2xl border border-border bg-card p-5"><div className="space-y-4">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16" />)}</div></div> : requests.data?.length ? <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="hidden grid-cols-[1fr_140px_120px_120px_95px] gap-4 border-b border-border bg-muted/35 px-5 py-3 font-mono-ui text-[10px] uppercase tracking-[.15em] text-muted-foreground md:grid"><span>Request</span><span>Requester</span><span>Category</span><span>Status</span><span>Priority</span></div><div className="divide-y divide-border">{requests.data.map((request) => <QueueRow request={request} key={request.id} />)}</div></div> : <EmptyState title={hasFilters ? 'No matching requests' : 'The queue is clear'} body={hasFilters ? 'Try widening your search or removing a filter.' : 'When teammates need a hand, their requests will appear here.'} action={hasFilters ? <Button variant="outline" onClick={() => { setSearch(''); setStatus(''); setCategory(''); setPriority(''); }} data-testid="button-empty-clear">Clear filters</Button> : <Link href="/new" data-testid="link-empty-new" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><Plus size={16} /> Submit a request</Link>} />}</div>;
}

function FilterSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (value: string) => void; options: Record<string, string>; testId: string }) {
  return <label className="relative"><select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="h-11 min-w-[130px] appearance-none rounded-xl border border-border bg-background px-3 pr-8 text-xs font-semibold outline-none focus:border-primary/50"><option value="">All {label.toLowerCase()}s</option>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /></label>;
}

function QueueRow({ request }: { request: Request }) {
  return <Link href={`/requests/${request.id}`} data-testid={`link-queue-request-${request.id}`} className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-muted/55 md:grid-cols-[1fr_140px_120px_120px_95px] md:items-center md:gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{request.title}</p><span className="font-mono-ui text-[10px] text-muted-foreground">#{String(request.id).padStart(4, '0')}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{request.summary || request.description}</p></div><span className="text-xs text-muted-foreground md:block">{request.requester}</span><span className="text-xs font-medium text-muted-foreground md:block">{categoryLabels[request.category]}</span><span><StatusBadge status={request.status} /></span><span><PriorityBadge priority={request.priority} /></span></Link>;
}

function NewRequestPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const create = useCreateRequest();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requester, setRequester] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const valid = title.trim().length >= 2 && description.trim().length >= 5 && requester.trim().length >= 2;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!valid) return; setError(''); create.mutate({ data: { title: title.trim(), description: description.trim(), requester: requester.trim() } }, { onSuccess: (request) => { qc.invalidateQueries({ queryKey: getListRequestsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setSubmitted(true); setTimeout(() => setLocation(`/requests/${request.id}`), 700); }, onError: () => setError('We could not submit this request. Check your connection and try again.') }); };
  if (submitted) return <div className="mx-auto flex max-w-xl animate-rise-in flex-col items-center py-20 text-center"><div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#dcefe2] text-[#38734d]"><Check size={29} strokeWidth={2.5} /></div><p className="mt-6 font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Request received</p><h1 className="mt-2 font-display text-4xl">The signal is in motion.</h1><p className="mt-3 text-sm text-muted-foreground">We classified your request and are taking you to its work view.</p></div>;
  return <div className="mx-auto max-w-3xl animate-rise-in"><Link href="/" data-testid="link-new-back" className="mb-8 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary"><ArrowLeft size={15} /> Back to overview</Link><div className="mb-8"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">New signal</p><h1 className="mt-2 font-display text-4xl tracking-[-.03em] md:text-5xl">What needs to move?</h1><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Give the team the unfiltered version. FlowOps will turn the context into a clear work item.</p></div><form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 shadow-[0_12px_35px_rgba(29,57,62,.05)] md:p-8"><div className="grid gap-6"><Field label="Short title" hint="A few words that name the thing" value={title} onChange={setTitle} placeholder="e.g. New starter needs laptop and access" testId="input-request-title" /><Field label="Your name" hint="Who should the team come back to?" value={requester} onChange={setRequester} placeholder="e.g. Morgan Lee" testId="input-requester" /><label className="grid gap-2"><span className="flex items-center justify-between text-sm font-semibold"><span>What is going on?</span><span className="text-xs font-normal text-muted-foreground">At least 5 characters</span></span><textarea value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-request-description" placeholder="Share the useful context: what happened, what you need, and when it matters." rows={7} className="resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-primary/50 focus:ring-2 focus:ring-accent/30" /></label></div>{error && <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#fff0eb] px-4 py-3 text-sm text-destructive"><CircleAlert size={16} />{error}</div>}<div className="mt-8 flex flex-col-reverse justify-end gap-3 border-t border-border pt-6 sm:flex-row"><Link href="/" data-testid="link-new-cancel" className="inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted">Cancel</Link><Button type="submit" disabled={!valid || create.isPending} data-testid="button-submit-request">{create.isPending ? <><LoaderCircle size={16} className="animate-spin" /> Sending signal...</> : <><ArrowUpRight size={16} /> Submit request</>}</Button></div></form></div>;
}

function Field({ label, hint, value, onChange, placeholder, testId }: { label: string; hint: string; value: string; onChange: (value: string) => void; placeholder: string; testId: string }) {
  return <label className="grid gap-2"><span className="flex items-center justify-between text-sm font-semibold"><span>{label}</span><span className="text-xs font-normal text-muted-foreground">{hint}</span></span><input value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} placeholder={placeholder} className="h-12 rounded-xl border border-border bg-background px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-primary/50 focus:ring-2 focus:ring-accent/30" /></label>;
}

function RequestDetailPage() {
  const params = useParams<{ id?: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const detail = useGetRequest(id, { query: { queryKey: getGetRequestQueryKey(id), enabled: Number.isFinite(id) } });
  const update = useUpdateRequestStatus();
  const [notice, setNotice] = useState('');
  if (detail.isLoading) return <div className="mx-auto max-w-4xl animate-rise-in"><Skeleton className="mb-8 h-5 w-28" /><Skeleton className="h-12 w-3/4" /><Skeleton className="mt-3 h-5 w-1/2" /><div className="mt-10 grid gap-5 md:grid-cols-[1fr_280px]"><Skeleton className="h-80" /><Skeleton className="h-80" /></div></div>;
  if (detail.isError || !detail.data) return <QueryError onRetry={() => detail.refetch()} message="This request may have moved, or the request service is unavailable." />;
  const request = detail.data;
  const current = statusOrder.indexOf(request.status);
  const moveStatus = (next: RequestStatus) => { setNotice(''); update.mutate({ id, data: { status: next } }, { onSuccess: (updated) => { qc.setQueryData(getGetRequestQueryKey(id), updated); qc.invalidateQueries({ queryKey: getListRequestsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setNotice(`Marked ${statusLabels[updated.status].toLowerCase()}.`); }, onError: () => setNotice('Status update failed. Please try again.') }); };
  return <div className="animate-rise-in"><Link href="/requests" data-testid="link-detail-back" className="mb-8 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary"><ArrowLeft size={15} /> Back to request queue</Link><div className="flex flex-col justify-between gap-5 md:flex-row md:items-start"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Request #{String(request.id).padStart(4, '0')}</span><StatusBadge status={request.status} /><PriorityBadge priority={request.priority} /></div><h1 data-testid="text-request-title" className="mt-3 max-w-3xl font-display text-4xl leading-[1.08] tracking-[-.035em] md:text-5xl">{request.title}</h1><p className="mt-3 text-sm text-muted-foreground">Submitted by <span className="font-semibold text-foreground">{request.requester}</span> on {formatDate(request.createdAt)}</p></div><Button variant="outline" onClick={() => setLocation('/new')} data-testid="button-detail-new"><Plus size={15} /> New request</Button></div>{notice && <div className={cx('mt-6 flex items-center gap-2 rounded-xl px-4 py-3 text-sm', notice.includes('failed') ? 'bg-[#fff0eb] text-destructive' : 'bg-[#dcefe2] text-[#38734d]')}><Check size={16} />{notice}</div>}<div className="mt-10 grid gap-5 lg:grid-cols-[1fr_300px]"><div className="space-y-5"><section className="rounded-2xl border border-border bg-card p-6 md:p-8"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Request context</p><p data-testid="text-request-description" className="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">{request.description}</p><div className="mt-7 grid gap-4 border-t border-border pt-6 sm:grid-cols-2"><Info label="System" value={request.system || 'Not assigned'} /><Info label="Category" value={categoryLabels[request.category]} /><Info label="FlowOps summary" value={request.summary || 'Classification is in progress.'} wide /></div></section><section className="rounded-2xl border border-border bg-card p-6 md:p-8"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Work timeline</p><div className="mt-6 space-y-0">{statusOrder.map((status, index) => <div key={status} className="relative flex gap-4 pb-6 last:pb-0"><div className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 bg-card" style={{ borderColor: index <= current ? 'hsl(155 32% 43%)' : 'hsl(39 23% 86%)' }}>{index < current ? <Check size={13} className="text-[#38734d]" /> : <span className={cx('h-2 w-2 rounded-full', index === current ? 'bg-[#d5a632]' : 'bg-border')} />}</div>{index < statusOrder.length - 1 && <span className={cx('absolute left-[13px] top-7 h-full w-px', index < current ? 'bg-[#77a889]' : 'bg-border')} />}<div><p className={cx('text-sm font-semibold', index > current && 'text-muted-foreground')}>{statusLabels[status]}</p><p className="mt-1 text-xs text-muted-foreground">{index < current ? 'Completed' : index === current ? 'Current stage' : 'Up next'}</p></div></div>)}</div></section></div><aside className="h-fit rounded-2xl border border-border bg-card p-5"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Move this request</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Keep the queue honest. Update the stage as work changes hands.</p><div className="mt-5 grid gap-2">{statusOrder.map((status, index) => <button key={status} type="button" disabled={status === request.status || update.isPending} onClick={() => moveStatus(status)} data-testid={`button-status-${status.toLowerCase()}`} className={cx('flex items-center justify-between rounded-xl border px-3 py-3 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60', status === request.status ? 'border-[#77a889] bg-[#eff7ed] text-[#38734d]' : 'border-border hover:border-primary/35 hover:bg-muted')}><span>{statusLabels[status]}</span>{status === request.status ? <CircleCheck size={15} /> : index < current ? <Check size={15} className="text-muted-foreground" /> : null}</button>)}</div></aside></div></div>;
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? 'sm:col-span-2' : ''}><p className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">{label}</p><p className="mt-1.5 text-sm font-semibold">{value}</p></div>;
}

function Router() {
  return <ErrorBoundary><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/requests" component={RequestsPage} /><Route path="/requests/:id" component={RequestDetailPage} /><Route path="/new" component={NewRequestPage} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;