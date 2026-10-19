"use client";

import type { ComponentType } from "react";
import {
  Activity as ActivityIcon,
  ArrowDownUp as ArrowDownUpIcon,
  ArrowUpRight as ArrowUpRightIcon,
  BotMessageSquare,
  Check as CheckIcon,
  Clock as ClockIcon,
  Download as DownloadIcon,
  ExternalLink as ExternalLinkIcon,
  FileText as FileTextIcon,
  Info as InfoIcon,
  Layers as LayersIcon,
  LockKeyhole as LockKeyholeIcon,
  Maximize2,
  PanelLeft as PanelLeftIcon,
  RefreshCw as RefreshCwIcon,
  ScanLine as ScanLineIcon,
  ScrollText as ScrollTextIcon,
  ShieldAlert as ShieldAlertIcon,
  ShieldCheck as ShieldCheckIcon,
  ShieldOff as ShieldOffIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
  Terminal as TerminalIcon,
  TriangleAlert,
  Wallet as WalletIcon,
  X as XIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export type AppIcon = ComponentType<LucideProps>;

// Lucide is the app's icon set (AGENTS.md). One stroke weight everywhere, and
// icons are decorative: the button or label around them carries the name.
function icon(Component: LucideIcon): AppIcon {
  return function Icon({
    size = 20,
    strokeWidth = 1.75,
    className = "",
    ...props
  }: LucideProps) {
    return (
      <Component
        aria-hidden="true"
        size={size}
        strokeWidth={strokeWidth}
        className={`app-icon ${className}`}
        {...props}
      />
    );
  };
}

export const Activity = icon(ActivityIcon);
export const ArrowUpRight = icon(ArrowUpRightIcon);
export const FileText = icon(FileTextIcon);
export const Layers = icon(LayersIcon);
export const LockKeyhole = icon(LockKeyholeIcon);
export const ShieldCheck = icon(ShieldCheckIcon);
export const ShieldAlert = icon(ShieldAlertIcon);
export const ShieldOff = icon(ShieldOffIcon);
export const Terminal = icon(TerminalIcon);
export const Wallet = icon(WalletIcon);
export const X = icon(XIcon);
export const ArrowDownUp = icon(ArrowDownUpIcon);
export const ScanLine = icon(ScanLineIcon);
export const ScrollText = icon(ScrollTextIcon);
export const SlidersHorizontal = icon(SlidersHorizontalIcon);
export const RefreshCw = icon(RefreshCwIcon);
export const ExternalLink = icon(ExternalLinkIcon);
export const Download = icon(DownloadIcon);
export const Check = icon(CheckIcon);
export const Info = icon(InfoIcon);
export const PanelLeft = icon(PanelLeftIcon);
export const AlertTriangle = icon(TriangleAlert);
export const Clock = icon(ClockIcon);
export const MessageSquare = icon(BotMessageSquare);
export const Expand = icon(Maximize2);
