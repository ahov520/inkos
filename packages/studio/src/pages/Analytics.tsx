import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface CostEstimate {
  readonly amount: number;
  readonly promptCost: number;
  readonly completionCost: number;
  readonly currency: string;
}

interface TokenStats {
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly avgTokensPerChapter: number;
  readonly recentTrend: ReadonlyArray<{ readonly chapter: number; readonly totalTokens: number }>;
  readonly estimatedCost?: CostEstimate;
}

interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly statusDistribution: Record<string, number>;
  readonly tokenStats?: TokenStats;
}

export function formatCostAmount(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function Analytics({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<AnalyticsData>(`/books/${bookId}/analytics`);

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-red-400">{t("common.error")}: {error}</div>;
  if (!data) return null;

  const statuses = Object.entries(data.statusDistribution);
  const totalFromDist = statuses.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span>/</span>
        <span className={c.subtle}>{t("analytics.title")}</span>
      </div>

      <h1 className="text-2xl font-semibold">{t("analytics.title")}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t("analytics.totalChapters")} value={data.totalChapters.toString()} c={c} />
        <StatCard label={t("analytics.totalWords")} value={data.totalWords.toLocaleString()} c={c} />
        <StatCard label={t("analytics.avgWords")} value={data.avgWordsPerChapter.toLocaleString()} c={c} />
      </div>

      {data.tokenStats && <TokenUsagePanel stats={data.tokenStats} c={c} t={t} />}

      {statuses.length > 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.statusDist")}</h2>
          <div className="space-y-3">
            {statuses.map(([status, count]) => (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={c.subtle}>{status}</span>
                  <span className={c.muted}>{count}</span>
                </div>
                <div className={`h-2 ${c.btnSecondary} rounded-full overflow-hidden`}>
                  <div
                    className="h-full bg-zinc-500 rounded-full transition-all"
                    style={{ width: `${totalFromDist > 0 ? (count / totalFromDist) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, c }: { label: string; value: string; c: ReturnType<typeof useColors> }) {
  return (
    <div className={`border ${c.cardStatic} rounded-lg p-5`}>
      <div className={`text-sm ${c.muted} mb-1`}>{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function TokenUsagePanel({ stats, c, t }: { stats: TokenStats; c: ReturnType<typeof useColors>; t: TFunction }) {
  const maxTrendTokens = Math.max(...stats.recentTrend.map((p) => p.totalTokens), 1);
  return (
    <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
      <h2 className={`text-sm font-medium ${c.subtle}`}>{t("analytics.tokenUsage")}</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.totalTokens")}</div>
          <div className="text-xl font-semibold tabular-nums">{stats.totalTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.promptTokens")}</div>
          <div className="text-xl font-semibold tabular-nums">{stats.totalPromptTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.completionTokens")}</div>
          <div className="text-xl font-semibold tabular-nums">{stats.totalCompletionTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.avgTokens")}</div>
          <div className="text-xl font-semibold tabular-nums">{stats.avgTokensPerChapter.toLocaleString()}</div>
        </div>
      </div>

      {stats.estimatedCost ? (
        <div className="flex items-baseline gap-2">
          <span className={`text-xs ${c.muted}`}>{t("analytics.estimatedCost")}</span>
          <span className="text-lg font-semibold tabular-nums">
            {stats.estimatedCost.currency}{formatCostAmount(stats.estimatedCost.amount)}
          </span>
          <span className={`text-xs ${c.muted}`}>
            ({t("analytics.promptTokens")} {stats.estimatedCost.currency}{formatCostAmount(stats.estimatedCost.promptCost)}
            {" · "}
            {t("analytics.completionTokens")} {stats.estimatedCost.currency}{formatCostAmount(stats.estimatedCost.completionCost)})
          </span>
        </div>
      ) : (
        <p className={`text-xs ${c.muted}`}>{t("analytics.pricingHint")}</p>
      )}

      {stats.recentTrend.length > 0 && (
        <div>
          <div className={`text-xs ${c.muted} mb-2`}>{t("analytics.recentTrend")}</div>
          <div className="space-y-2">
            {stats.recentTrend.map(({ chapter, totalTokens }) => (
              <div key={chapter} className="flex items-center gap-3">
                <span className={`text-xs ${c.subtle} w-14 shrink-0 tabular-nums`}>
                  {t("analytics.chapterPrefix")}{chapter}{t("analytics.chapterSuffix")}
                </span>
                <div className={`h-2 flex-1 ${c.btnSecondary} rounded-full overflow-hidden`}>
                  <div
                    className="h-full bg-zinc-500 rounded-full transition-all"
                    style={{ width: `${(totalTokens / maxTrendTokens) * 100}%` }}
                  />
                </div>
                <span className={`text-xs ${c.muted} w-20 text-right tabular-nums`}>
                  {totalTokens.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
