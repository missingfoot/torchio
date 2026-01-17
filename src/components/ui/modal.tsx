import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  fullScreen?: boolean;
}

export function Modal({ open, onOpenChange, children, fullScreen = false }: ModalProps) {
  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      {/* Modal content - centered */}
      <div className="fixed inset-4 flex items-center justify-center z-50 pointer-events-none">
        <div
          className="bg-background border rounded-xl w-full max-w-2xl max-h-full overflow-auto pointer-events-auto animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function ModalHeader({
  children,
  className,
  onClose,
}: {
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div>{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="p-2 rounded hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

export function ModalTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("text-lg font-semibold", className)}>{children}</h2>
  );
}
