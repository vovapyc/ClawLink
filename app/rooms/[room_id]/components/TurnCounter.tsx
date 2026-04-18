export default function TurnCounter({
  current,
  max,
}: {
  current: number;
  max: number;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="metric">
      <span className="k">TURN</span>
      <span className="v">
        {pad(current)}
        <span className="sub"> / {pad(max)}</span>
      </span>
    </div>
  );
}
