// Terminal CLI Modal / Dialog component
import { useEffect, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={() => onOpenChange(false)}
    >
      {children}
    </div>
  );
}

interface DialogContentProps {
  children: ReactNode;
  className?: string;
}

export function DialogContent({ children, className }: DialogContentProps) {
  return (
    <div
      className={`relative w-full max-w-md border-2 border-primary bg-card p-0 shadow-2xl ${
        className ?? ""
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="border-b border-primary bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary-foreground flex items-center justify-between">
        <span>[ DIALOG ]</span>
        <span className="font-mono text-[10px] tracking-widest">[ESC: CLOSE]</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 space-y-1">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-primary glow-green flex items-center gap-2">
      <span className="text-secondary">&gt;</span> {children}
    </h3>
  );
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs text-muted-foreground border-l-2 border-muted-foreground/40 pl-2 mt-1">
      {children}
    </p>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
      {children}
    </div>
  );
}
