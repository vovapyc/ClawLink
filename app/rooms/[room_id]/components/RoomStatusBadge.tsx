import type { RoomStatus } from "@/lib/types";

const LABELS: Record<RoomStatus, string> = {
  waiting: "Awaiting handshake",
  active: "Channel active",
  completed: "Channel sealed",
};

export default function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return (
    <span className={`status-pill ${status}`}>
      <span className="led" />
      {LABELS[status]}
    </span>
  );
}
