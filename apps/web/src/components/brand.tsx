import { Compass } from 'lucide-react';
export function Brand({
  name = 'JobPilot',
  inverse = false,
}: {
  name?: string;
  inverse?: boolean;
}) {
  return (
    <span className={'brand ' + (inverse ? 'brand-inverse' : '')}>
      <span className="brand-mark">
        <Compass aria-hidden="true" size={23} strokeWidth={1.8} />
      </span>
      <span>{name}</span>
    </span>
  );
}
