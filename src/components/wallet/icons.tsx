"use client";

import type { ComponentType, HTMLAttributes } from "react";
import { ActivityLogIcon } from "@svg-animated-icons/react/activity-log";
import { ArrowTopRightIcon } from "@svg-animated-icons/react/arrow-top-right";
import { FileTextIcon } from "@svg-animated-icons/react/file-text";
import { LayersIcon } from "@svg-animated-icons/react/layers";
import { LockClosedIcon } from "@svg-animated-icons/react/lock-closed";
import { CheckCircledIcon } from "@svg-animated-icons/react/check-circled";
import { CodeIcon } from "@svg-animated-icons/react/code";
import { TokensIcon } from "@svg-animated-icons/react/tokens";
import { Cross2Icon } from "@svg-animated-icons/react/cross-2";
import { LoopIcon } from "@svg-animated-icons/react/loop";
import { DashboardIcon } from "@svg-animated-icons/react/dashboard";
import { MixerHorizontalIcon } from "@svg-animated-icons/react/mixer-horizontal";
import { ReloadIcon } from "@svg-animated-icons/react/reload";
import { ExternalLinkIcon } from "@svg-animated-icons/react/external-link";
import { DownloadIcon } from "@svg-animated-icons/react/download";
import { CheckIcon } from "@svg-animated-icons/react/check";
import { InfoCircledIcon } from "@svg-animated-icons/react/info-circled";
import { PanelLeftIcon } from "@svg-animated-icons/react/panel-left";
import { ExclamationTriangleIcon } from "@svg-animated-icons/react/exclamation-triangle";
import { ClockIcon } from "@svg-animated-icons/react/clock";
import { ChatBubbleIcon } from "@svg-animated-icons/react/chat-bubble";
import { EnterFullScreenIcon } from "@svg-animated-icons/react/enter-full-screen";

type IconProps = HTMLAttributes<HTMLSpanElement> & { size?: number };
export type AppIcon = ComponentType<IconProps>;

// The library sizes SVGs in em. This adapter preserves our accessible labels
// and explicit sizes while using the original animated SVG components.
function icon(Component: ComponentType<{ className?: string }>): AppIcon {
  return function AnimatedIcon({
    size = 20,
    className = "",
    style,
    ...props
  }: IconProps) {
    return (
      <span
        aria-hidden="true"
        {...props}
        className={`app-icon ${className}`}
        style={{ fontSize: size, width: size, height: size, ...style }}
      >
        <Component />
      </span>
    );
  };
}

export const Activity = icon(ActivityLogIcon);
export const ArrowUpRight = icon(ArrowTopRightIcon);
export const FileText = icon(FileTextIcon);
export const Layers = icon(LayersIcon);
export const LockKeyhole = icon(LockClosedIcon);
export const ShieldCheck = icon(CheckCircledIcon);
export const Terminal = icon(CodeIcon);
export const Wallet = icon(TokensIcon);
export const X = icon(Cross2Icon);
export const ArrowDownUp = icon(LoopIcon);
export const ScanLine = icon(DashboardIcon);
export const SlidersHorizontal = icon(MixerHorizontalIcon);
export const RefreshCw = icon(ReloadIcon);
export const ExternalLink = icon(ExternalLinkIcon);
export const Download = icon(DownloadIcon);
export const Check = icon(CheckIcon);
export const Info = icon(InfoCircledIcon);
export const PanelLeft = icon(PanelLeftIcon);
export const AlertTriangle = icon(ExclamationTriangleIcon);
export const Clock = icon(ClockIcon);
export const MessageSquare = icon(ChatBubbleIcon);
export const Expand = icon(EnterFullScreenIcon);
