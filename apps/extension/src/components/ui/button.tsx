import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  ghost: "bg-bg-elevated text-text-primary border border-border-subtle hover:bg-bg-elevated-hover",
};

export function Button({
  variant = "ghost",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50",
        // instant press feedback — the button should feel like it heard the tap
        "transition-[transform,opacity,background-color,border-color] duration-fast ease-out-strong",
        "active:scale-[0.97] disabled:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        styles[variant],
        className,
      )}
    />
  );
}
