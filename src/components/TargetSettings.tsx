import { FileVideo, Image } from "lucide-react";
import { Input } from "./ui/input";
import type { ConversionSettings } from "../types";

interface TargetSettingsProps {
  settings: ConversionSettings;
  onChange: (settings: Partial<ConversionSettings>) => void;
  disabled?: boolean;
}

export function TargetSettings({
  settings,
  onChange,
  disabled,
}: TargetSettingsProps) {
  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <label className="flex items-center gap-2 text-sm font-medium mb-2">
          <FileVideo className="h-4 w-4 text-blue-400" />
          Video Target
        </label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={500}
            value={settings.videoTargetMB}
            onChange={(e) =>
              onChange({ videoTargetMB: parseInt(e.target.value) || 1 })
            }
            disabled={disabled}
            className="w-20 text-center"
          />
          <span className="text-sm text-muted-foreground">MB</span>
        </div>
      </div>

      <div className="flex-1">
        <label className="flex items-center gap-2 text-sm font-medium mb-2">
          <Image className="h-4 w-4 text-purple-400" />
          WebP Target
        </label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0.1}
            max={50}
            step={0.1}
            value={settings.webpTargetMB}
            onChange={(e) =>
              onChange({ webpTargetMB: parseFloat(e.target.value) || 0.1 })
            }
            disabled={disabled}
            className="w-20 text-center"
          />
          <span className="text-sm text-muted-foreground">MB</span>
        </div>
      </div>
    </div>
  );
}
