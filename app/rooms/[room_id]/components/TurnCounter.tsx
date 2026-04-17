export default function TurnCounter({ current, max }: { current: number; max: number }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
      Turn {current} / {max}
    </span>
  );
}
