import { FileIcon } from "@untitledui/file-icons";
import { Input } from "./ui/input";
import { getOrderedFormats } from "@/lib/formats";
import type { FormatId } from "../types";

interface TargetSettingsProps {
  getTargetSize: (formatId: FormatId) => number;
  updateTargetSize: (formatId: FormatId, size: number) => void;
  disabled?: boolean;
}

export function TargetSettings({
  getTargetSize,
  updateTargetSize,
  disabled,
}: TargetSettingsProps) {
  const formats = getOrderedFormats();

  return (
    <div className="flex gap-4 flex-wrap">
      {formats.map((format) => {
        const currentValue = getTargetSize(format.id);

        return (
          <div key={format.id} className="flex-1 min-w-[120px]">
            <label className="flex items-center gap-2 text-sm font-medium mb-2">
              <FileIcon type={format.iconType} variant="solid" size={16} />
              {format.name} Target
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={format.sizeMin}
                max={format.sizeMax}
                step={format.sizeIncrement}
                value={currentValue}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || format.sizeMin;
                  updateTargetSize(format.id, Math.max(format.sizeMin, Math.min(format.sizeMax, value)));
                }}
                disabled={disabled}
                className="w-20 text-center"
              />
              <span className="text-sm text-muted-foreground">MB</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
