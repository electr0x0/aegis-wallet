"use client";

import type { AppIcon } from "@/components/wallet/icons";
import { SpotlightCard } from "@/components/godui/spotlight-card";
import { NumberTicker } from "@/components/godui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export function MetricCard({
  label,
  value,
  prefix = "",
  suffix,
  description,
  icon: Icon,
  decimals = 0,
  loading,
  progress,
  accent = false,
}: {
  label: string;
  value: number | null;
  prefix?: string;
  suffix: string;
  description: string;
  icon: AppIcon;
  decimals?: number;
  loading: boolean;
  progress?: number;
  accent?: boolean;
}) {
  return (
    <SpotlightCard
      className={`metric-card ${accent ? "metric-accent" : ""}`}
      glowColor="rgba(11, 122, 86, 0.05)"
      border={false}
    >
      <div className="metric-label">
        <span>{label}</span>
        <Icon size={16} aria-hidden="true" />
      </div>
      <div className="metric-value">
        {loading ? (
          <Skeleton className="h-9 w-28" />
        ) : value === null ? (
          <span>—</span>
        ) : (
          <span className="inline-flex items-baseline">
            {prefix}
            <NumberTicker
              value={value}
              decimalPlaces={decimals}
              className="tracking-tight"
            />
          </span>
        )}
        <small>{suffix}</small>
      </div>
      {progress !== undefined && (
        <Progress
          aria-label="Autonomous daily budget used"
          value={Math.min(100, Math.max(0, progress))}
          className="mt-3 h-1"
        />
      )}
      <p>{description}</p>
    </SpotlightCard>
  );
}
