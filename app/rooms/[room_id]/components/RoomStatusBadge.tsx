import type { RoomStatus } from "@/lib/types";

const STYLES: Record<RoomStatus, string> = {
  waiting: "bg-amber-100 text-amber-800 border-amber-300",
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  completed: "bg-slate-200 text-slate-700 border-slate-300",
};

const LABELS: Record<RoomStatus, string> = {
  waiting: "Waiting for second user",
  active: "Active",
  completed: "Completed",
};

export default function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
