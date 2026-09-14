"use client";

import BridgeKeyPanel from "./BridgeKeyPanel";
import DangerZonePanel from "./DangerZonePanel";
import PosHealthPanel from "./PosHealthPanel";
import StaffPanel from "./StaffPanel";
import VenuePanel from "./VenuePanel";
export default function SettingsTab() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="wordmark text-2xl">Ayarlar / Settings</h2>
      <VenuePanel />
      <PosHealthPanel />
      <BridgeKeyPanel />
      <StaffPanel />
      <DangerZonePanel />
    </div>
  );
}
