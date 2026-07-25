import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function IconBase({
  size = 20,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

const strokeProps = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
};

export function DocumentIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 3.75h6.8L18 7.95v12.3H7z" {...strokeProps} />
      <path d="M13.5 3.75v4.5H18M9.75 12h5.5M9.75 15.5h5.5" {...strokeProps} />
    </IconBase>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 7.5h6l1.6 2h9.4v9.25H3.5z" {...strokeProps} />
      <path d="M3.5 7.5V5.25h6l1.6 2.25" {...strokeProps} />
    </IconBase>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 19 6v5.25c0 4.3-2.65 7.75-7 9.25-4.35-1.5-7-4.95-7-9.25V6z" {...strokeProps} />
      <path d="m8.8 12.1 2.05 2.05 4.45-4.45" {...strokeProps} />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" {...strokeProps} />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" {...strokeProps} />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 15V4.5M8.25 8.25 12 4.5l3.75 3.75M5 14.5v5h14v-5" {...strokeProps} />
    </IconBase>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4.5V15M8.25 11.25 12 15l3.75-3.75M5 19.5h14" {...strokeProps} />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12.25 4.15 4.15L19 6.75" {...strokeProps} />
    </IconBase>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14M14 7l5 5-5 5" {...strokeProps} />
    </IconBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6.5 9 5.5 5.5L17.5 9" {...strokeProps} />
    </IconBase>
  );
}

export function QuoteIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 6.5h6v6H7.5c0 2-1 3.4-3 4.5M14 6.5h6v6h-3.5c0 2-1 3.4-3 4.5" {...strokeProps} />
    </IconBase>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="10" rx="3" width="6" x="9" y="3.5" {...strokeProps} />
      <path d="M5.75 11.5a6.25 6.25 0 0 0 12.5 0M12 17.75v2.75M9 20.5h6" {...strokeProps} />
    </IconBase>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 9.5h4l4-3.5v12l-4-3.5H4zM16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" {...strokeProps} />
    </IconBase>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7.1 4.5 4.75 6.85c-.6.6-.25 2.55.95 4.75 1.85 3.35 4.95 6.45 8.3 8.3 2.2 1.2 4.15 1.55 4.75.95l2.35-2.35-4.25-3.15-1.75 1.75c-1.5-.85-2.95-2.05-4.2-3.3-1.25-1.25-2.45-2.7-3.3-4.2l1.75-1.75z" {...strokeProps} />
    </IconBase>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13 5h6v6M19 5l-8 8M18 14v5H5V6h5" {...strokeProps} />
    </IconBase>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 12s3.25-5 8.5-5 8.5 5 8.5 5-3.25 5-8.5 5-8.5-5-8.5-5Z" {...strokeProps} />
      <circle cx="12" cy="12" r="2.25" {...strokeProps} />
    </IconBase>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 4 16 16M9.9 7.25A9.6 9.6 0 0 1 12 7c5.25 0 8.5 5 8.5 5a13 13 0 0 1-2.1 2.55M14.2 14.2A3.1 3.1 0 0 1 9.8 9.8M6.35 8.55A13.25 13.25 0 0 0 3.5 12s3.25 5 8.5 5c.75 0 1.45-.1 2.1-.28" {...strokeProps} />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" {...strokeProps} />
    </IconBase>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <path d="M12 10.5v6M12 7.4h.01" {...strokeProps} />
    </IconBase>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" {...strokeProps} />
      <path d="M12 7v5l3.5 2" {...strokeProps} />
    </IconBase>
  );
}
